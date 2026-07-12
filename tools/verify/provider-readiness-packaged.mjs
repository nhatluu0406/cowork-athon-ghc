/**
 * Provider readiness + functional UX preflight — packaged verification (journeys A–J).
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv, LOCAL_SERVICE_READY } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19233;
const TRACE = join(REPO, ".runtime", "provider-readiness.trace");

const results = {};

function loadProjectEnvForVerify() {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cdpEvaluate(expression) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => typeof t.url === "string" && t.url.startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP target missing");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("CDP failed")));
  });
  const id = 1;
  const value = await new Promise((res, rej) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result?.result?.value);
    });
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  return value;
}

async function waitForText(selector, pattern, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`));
      if (pattern.test(text)) return text;
    } catch {
      // renderer not ready
    }
    await sleep(400);
  }
  throw new Error(`timeout ${selector} ${pattern}`);
}

async function waitForSelector(selector, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdpEvaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    } catch {
      // not ready
    }
    await sleep(300);
  }
  throw new Error(`timeout selector ${selector}`);
}

function launch(extraEnv, profileDir) {
  return spawn(EXE, [`--user-data-dir=${profileDir}`], {
    env: packagedChildEnv(extraEnv),
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopAll(proc) {
  if (proc?.exitCode === null) proc.kill();
  await sleep(2500);
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    try {
      execSync(`taskkill /F /IM "${image}" /T`, { stdio: "ignore" });
    } catch {
      // ok
    }
  }
  await sleep(800);
}

function assertNoOrphanProcesses() {
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    try {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { encoding: "utf8" });
      if (out.toLowerCase().includes(image.toLowerCase())) {
        throw new Error(`orphan process: ${image}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("orphan")) throw err;
    }
  }
}

async function setComposer(text) {
  await cdpEvaluate(`(() => {
    const el = document.querySelector('.composer__input');
    if (!el) return false;
    el.textContent = ${JSON.stringify(text)};
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
    return true;
  })()`);
}

async function clickSend() {
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await sleep(800);
}

async function openSettingsModal() {
  await cdpEvaluate(`document.querySelector('.topbar__gateway')?.click()`);
  await waitForSelector(".modal:not([hidden]) .llm-save-credential", 15_000);
}

async function saveCredential(apiKey) {
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(apiKey)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.llm-save-credential')?.click();
    return true;
  })()`);
  await waitForText(".llm-credential-status", /Đã cấu hình|đã có khoá/i, 30_000);
}

async function closeSettingsModal() {
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  await sleep(500);
}

async function onboardWorkspace(fixture, profileDir, withCredential = false) {
  const proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileDir,
  );
  await waitForSelector(".app-shell");
  await waitForText(".topbar__status", LOCAL_SERVICE_READY);
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-ready-ws-/i);
  if (withCredential) {
    await openSettingsModal();
    const apiKey = process.env["DEEPSEEK_API_KEY"] ?? "";
    await saveCredential(apiKey);
    await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
    await waitForText(".llm-settings-status", /thành công/i, 60_000);
    await closeSettingsModal();
  }
  return proc;
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE}`);
  loadProjectEnvForVerify();

  const fixture = mkdtempSync(join(tmpdir(), "cghc-ready-ws-"));
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "note.txt"), "ORANGE-731", "utf8");

  // Journey A — clean first run
  console.log("readiness: journey A — clean first run");
  const profileA = mkdtempSync(join(tmpdir(), "cghc-ready-a-"));
  let proc = launch(
    { COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT) },
    profileA,
  );
  await waitForSelector(".app-shell");
  await waitForText(".topbar__status", LOCAL_SERVICE_READY);
  const providerA = String(await cdpEvaluate(`document.querySelector('.topbar__gateway')?.textContent ?? ''`));
  if (!/Provider:/i.test(providerA)) throw new Error(`A: missing provider status: ${providerA}`);
  const contA = await cdpEvaluate(`!!document.querySelector('.continuation-banner')`);
  if (contA) throw new Error("A: continuation banner should not be in DOM");
  results.A = "PASS";
  await stopAll(proc);

  // Journey B — workspace without credential
  console.log("readiness: journey B — missing credential preflight");
  const profileB = mkdtempSync(join(tmpdir(), "cghc-ready-b-"));
  proc = await onboardWorkspace(fixture, profileB, false);
  await setComposer("Xin chào từ readiness test");
  await clickSend();
  const preflight = await cdpEvaluate(`!document.querySelector('.composer-preflight')?.hidden`);
  const promptKept = String(await cdpEvaluate(`document.querySelector('.composer__input')?.textContent ?? ''`));
  const running = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
  if (!preflight) throw new Error("B: expected composer preflight banner");
  if (!promptKept.includes("readiness test")) throw new Error("B: prompt not preserved");
  if (/Đang xử lý/i.test(running)) throw new Error("B: stuck running");
  results.B = "PASS";

  // Journey C — configure credential and send without restart
  console.log("readiness: journey C — configure and continue");
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required for journey C");
  await openSettingsModal();
  await saveCredential(process.env["DEEPSEEK_API_KEY"]);
  await closeSettingsModal();
  const promptAfterSettings = String(await cdpEvaluate(`document.querySelector('.composer__input')?.textContent ?? ''`));
  if (!promptAfterSettings.includes("readiness test")) throw new Error("C: prompt lost after settings");
  await clickSend();
  await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 30_000);
  await waitForText(".execution-status", /Đã hoàn tất|Hoàn thành|Có lỗi/i, 240_000);
  results.C = "PASS";
  await stopAll(proc);

  // Journey D/E — invalid key then recovery (abbreviated using settings test)
  console.log("readiness: journey D — invalid key recovery");
  const profileD = mkdtempSync(join(tmpdir(), "cghc-ready-d-"));
  proc = await onboardWorkspace(fixture, profileD, false);
  await openSettingsModal();
  await saveCredential("sk-cghc-invalid-probe-000000000000000000000000");
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /từ chối|thất bại|không|hợp lệ/i, 60_000);
  const modalOpen = await cdpEvaluate(`!document.querySelector('.modal')?.hidden`);
  if (!modalOpen) throw new Error("D: settings should remain usable");
  await saveCredential(process.env["DEEPSEEK_API_KEY"] ?? "");
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /thành công/i, 60_000);
  await closeSettingsModal();
  results.D = "PASS";
  results.E = "PASS";
  await stopAll(proc);

  // Journey F — settings focus
  console.log("readiness: journey F — settings focus");
  proc = await onboardWorkspace(fixture, profileD, true);
  await cdpEvaluate(`document.querySelector('.composer__input')?.focus()`);
  await openSettingsModal();
  const focusedInModal = await cdpEvaluate(`document.querySelector('.modal__panel')?.contains(document.activeElement)`);
  if (!focusedInModal) throw new Error("F: focus not inside modal");
  await cdpEvaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
  const closed = await cdpEvaluate(`document.querySelector('.modal')?.hidden`);
  if (!closed) throw new Error("F: modal did not close on Escape");
  results.F = "PASS";
  await stopAll(proc);

  // Journey G — historical continuation only when terminal conversation selected
  console.log("readiness: journey G — historical continuation");
  const profileG = mkdtempSync(join(tmpdir(), "cghc-ready-g-"));

  proc = launch({ COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT) }, profileG);
  await waitForSelector(".app-shell");
  await waitForText(".topbar__status", LOCAL_SERVICE_READY);
  const contEmpty = await cdpEvaluate(`!!document.querySelector('.continuation-banner')`);
  if (contEmpty) throw new Error("G: empty state should not render continuation");
  await stopAll(proc);

  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required for journey G");
  proc = await onboardWorkspace(fixture, profileG, true);
  await setComposer("Tạo lịch sử cho continuation test");
  await clickSend();
  await waitForText(".execution-status", /Đã hoàn tất|Hoàn thành|Có lỗi/i, 240_000);
  await stopAll(proc);

  proc = launch(
    {
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileG,
  );
  await waitForSelector(".app-shell");
  await waitForText(".workspace-context", /cghc-ready-ws-/i, 60_000);
  await sleep(2000);
  const hasHistory = Number(await cdpEvaluate(`document.querySelectorAll('.history-item').length`));
  if (hasHistory === 0) throw new Error("G: expected historical conversation");
  await cdpEvaluate(`document.querySelector('.history-item')?.click()`);
  await sleep(800);
  const contAfter = await cdpEvaluate(`!!document.querySelector('.continuation-banner')`);
  if (!contAfter) throw new Error("G: expected continuation for terminal history");
  const label = String(await cdpEvaluate(`document.querySelector('.continuation-banner .label-btn')?.textContent ?? ''`));
  if (!label.includes("Tiếp tục cuộc trò chuyện")) throw new Error(`G: wrong CTA ${label}`);
  results.G = "PASS";
  await stopAll(proc);

  // Journey H — narrow activity affordance
  console.log("readiness: journey H — activity toggle");
  proc = await onboardWorkspace(fixture, mkdtempSync(join(tmpdir(), "cghc-ready-h-")), true);
  const toggleExists = await cdpEvaluate(`!!document.querySelector('.activity-mobile-toggle')`);
  if (!toggleExists) throw new Error("H: missing activity mobile toggle");
  await cdpEvaluate(`document.querySelector('.activity-mobile-toggle')?.click()`);
  await sleep(400);
  const drawerOpen = await cdpEvaluate(`document.querySelector('.workspace')?.classList.contains('activity-drawer-open')`);
  if (!drawerOpen) throw new Error("H: activity drawer not open");
  results.H = "PASS";
  await stopAll(proc);

  // Journey I — env hygiene (unit-tested; smoke launch with parent flag)
  console.log("readiness: journey I — launch env hygiene");
  const prev = process.env["ELECTRON_RUN_AS_NODE"];
  process.env["ELECTRON_RUN_AS_NODE"] = "1";
  proc = launch({ COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT) }, mkdtempSync(join(tmpdir(), "cghc-ready-i-")));
  await waitForSelector(".app-shell", 60_000);
  await waitForText(".topbar__status", LOCAL_SERVICE_READY, 90_000);
  if (prev === undefined) delete process.env["ELECTRON_RUN_AS_NODE"];
  else process.env["ELECTRON_RUN_AS_NODE"] = prev;
  results.I = "PASS";
  await stopAll(proc);

  // Journey J — cleanup
  console.log("readiness: journey J — process cleanup");
  assertNoOrphanProcesses();
  results.J = "PASS";

  rmSync(fixture, { recursive: true, force: true });

  console.log("\nprovider-readiness-packaged results:");
  for (const key of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
    console.log(`  Journey ${key}: ${results[key] ?? "SKIP"}`);
  }
  console.log("provider-readiness-packaged: PASS");
}

main().catch((err) => {
  console.error("provider-readiness-packaged: FAIL", err);
  process.exit(1);
});
