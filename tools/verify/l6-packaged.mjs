/**
 * L6 packaged acceptance (CGHC-028 slices 5A–5E) — uses dist-app/win-unpacked/Cowork GHC.exe.
 *
 * Live inference budget: at most 3 successful completions (short deterministic prompts).
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19226;
const TRACE = join(REPO, ".runtime", "l6-packaged.trace");
const FIXTURE_APPROVE = "cghc-l6-approve.txt";
const FIXTURE_DENY = "cghc-l6-deny.txt";
const FIXTURE_CONTENT = "CGHC_L6_OK";

let liveSuccessCount = 0;

function loadProjectEnvForVerify() {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetTrace() {
  rmSync(TRACE, { force: true });
  writeFileSync(TRACE, "", "utf8");
}

async function waitForTrace(marker, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(TRACE)) {
      const text = readFileSync(TRACE, "utf8");
      if (marker.test(text)) return text;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for trace ${marker}`);
}

async function cdpEvaluate(expression) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => typeof t.url === "string" && t.url.startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("Renderer CDP target not found.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      if (msg.error) reject(new Error(msg.error.message ?? "CDP evaluate failed"));
      else resolve(msg.result?.result?.value);
    });
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  ws.close();
  return result;
}

async function waitForSelector(selector, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdpEvaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    } catch {
      // renderer not ready
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${selector}`);
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
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${selector} to match ${pattern}`);
}

async function clickText(selector, pattern) {
  const clicked = await cdpEvaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const node = nodes.find((n) => ${pattern}.test(n.textContent || ''));
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error(`No ${selector} matching ${pattern}`);
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

function launch(extraEnv = {}, userDataDir) {
  const env = { ...process.env, ...extraEnv };
  delete env["ELECTRON_RUN_AS_NODE"];
  delete env["DEEPSEEK_API_KEY"];
  const args = userDataDir ? [`--user-data-dir=${userDataDir}`] : [];
  return spawn(EXE, args, { env, stdio: "ignore", windowsHide: true });
}

async function stop(proc) {
  if (proc.exitCode === null) proc.kill();
  await sleep(3000);
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    try {
      execSync(`taskkill /F /IM "${image}" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
  }
  await sleep(1000);
}

function countProcesses(image) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { encoding: "utf8" });
    return out.split(/\r?\n/u).filter((line) => line.includes(image)).length;
  } catch {
    return 0;
  }
}

async function waitForTerminalAfterPermission(decision, terminalPattern, timeoutMs = 240_000) {
  const selector = decision === "allow" ? ".permission-allow" : ".permission-deny";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await cdpEvaluate(`(() => {
        const btn = document.querySelector(${JSON.stringify(selector)});
        if (btn) btn.click();
        return true;
      })()`);
      const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
      if (terminalPattern.test(status)) return status;
    } catch {
      // renderer not ready
    }
    await sleep(500);
  }
  const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
  throw new Error(`Timed out after permission ${decision}; status=${status}`);
}

async function onboardCleanProfile(fixture, profileDir) {
  console.log("l6: clean-profile onboarding");
  resetTrace();
  const proc = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  }, profileDir);

  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".app-shell");
  await waitForText(".topbar__status", /Đã kết nối local service/i);
  await waitForSelector(".workspace-choose");
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-l6-ws-/i);

  await clickText("button", /Cài đặt/);
  await waitForSelector(".llm-save-credential");
  await sleep(2000);
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(apiKey)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await cdpEvaluate(`document.querySelector('.llm-save-credential')?.click()`);
  await waitForText(".llm-credential-status", /Đã cấu hình/i, 30_000);
  await waitForSelector(".llm-test-connection");
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /thành công/i, 60_000);
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);

  await clickText("button", /Bắt đầu phiên/);
  const traceAfterStart = await waitForTrace(/live_ready:|live_failed:/);
  if (/live_failed:/.test(traceAfterStart) && !/live_ready:/.test(traceAfterStart)) {
    throw new Error(`OpenCode live start failed: ${traceAfterStart}`);
  }
  await waitForText(".execution-status", /Phiên đã sẵn sàng/i);
  console.log("l6: clean-profile onboarding PASS");
  return proc;
}

async function sendAndWaitComplete(prompt, assistantPattern) {
  await setComposer(prompt);
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý/i, 60_000);
  await waitForText(".msg--assistant .msg__text", assistantPattern, 180_000);
  await waitForText(".execution-status", /Đã hoàn tất|Có lỗi|Đã hủy|Bị từ chối/i, 180_000);
  liveSuccessCount += 1;
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}`);
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) {
    throw new Error("DEEPSEEK_API_KEY required in .env for isolated profile verification.");
  }

  const fixture = mkdtempSync(join(tmpdir(), "cghc-l6-ws-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-l6-profile-"));

  const proc = await onboardCleanProfile(fixture, profileDir);

  console.log("l6: streaming PING");
  await sendAndWaitComplete("Reply with only the word PING.", /PING/i);

  console.log("l6: permission approve journey");
  const approvePrompt =
    `Create a text file named ${FIXTURE_APPROVE} in the workspace root with exactly the content: ${FIXTURE_CONTENT}. Reply OK when done.`;
  await setComposer(approvePrompt);
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 60_000);
  await waitForTerminalAfterPermission("allow", /Đã hoàn tất|Hoàn thành/i);
  const approvePath = join(fixture, FIXTURE_APPROVE);
  const approveDeadline = Date.now() + 30_000;
  while (Date.now() < approveDeadline) {
    if (existsSync(approvePath) && readFileSync(approvePath, "utf8").includes(FIXTURE_CONTENT)) break;
    await sleep(500);
  }
  if (!existsSync(approvePath)) throw new Error(`Approve path missing: ${approvePath}`);
  liveSuccessCount += 1;
  console.log("l6: permission approve PASS");

  console.log("l6: permission deny journey");
  const denyPath = join(fixture, FIXTURE_DENY);
  rmSync(denyPath, { force: true });
  const denyPrompt =
    `Create a text file named ${FIXTURE_DENY} in the workspace root with content DENIED. Reply OK when done.`;
  await setComposer(denyPrompt);
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 60_000);
  await waitForTerminalAfterPermission("deny", /Đã hoàn tất|Có lỗi|Bị từ chối|Đã hủy/i);
  await sleep(3000);
  if (existsSync(denyPath)) throw new Error(`Deny path should not exist: ${denyPath}`);
  liveSuccessCount += 1;
  console.log("l6: permission deny PASS");

  console.log("l6: provider error recovery (missing credential)");
  const validKey = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`document.querySelector('.topbar__gateway')?.click()`);
  await waitForSelector(".llm-delete-credential");
  await cdpEvaluate(`document.querySelector('.llm-delete-credential')?.click()`);
  await waitForText(".llm-settings-status", /Đã xoá khoá API/i, 30_000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /Xác thực|thất bại|credential|khoá|Authentication|chưa/i, 60_000);
  const errText = String(await cdpEvaluate(`document.querySelector('.llm-settings-status')?.textContent ?? ''`));
  if (/sk-[a-z0-9]{8,}/i.test(errText)) throw new Error("Credential leaked in error text");
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(validKey)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await cdpEvaluate(`document.querySelector('.llm-save-credential')?.click()`);
  await waitForText(".llm-settings-status", /Đã lưu khoá API/i, 30_000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /thành công/i, 60_000);
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  console.log("l6: provider error recovery PASS");

  console.log("l6: active-session interruption");
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  await setComposer("Write at least 50 short numbered lines. Do not create files.");
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý/i, 60_000);
  await sleep(1500);
  proc.kill();
  await sleep(4000);
  let coworkLeft = countProcesses("Cowork GHC.exe");
  let opencodeLeft = countProcesses("opencode.exe");
  if (coworkLeft > 0 || opencodeLeft > 0) {
    await stop(proc);
    throw new Error(`Orphans after kill: cowork=${coworkLeft} opencode=${opencodeLeft}`);
  }
  console.log("l6: interruption cleanup PASS");

  console.log("l6: relaunch after interruption");
  const proc2 = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  }, profileDir);
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".app-shell");
  await waitForText(".workspace-context", /cghc-l6-ws-/i);
  const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
  if (/Đang chạy|Đang xử lý/i.test(status)) throw new Error(`Stale running state after relaunch: ${status}`);
  await stop(proc2);
  console.log("l6: relaunch PASS");

  console.log("l6: Windows lifecycle scripts");
  const initRc = execSync(`cmd /c "${join(REPO, "scripts", "init.bat")}" <nul`, { encoding: "utf8", timeout: 120_000 });
  if (!/init: OK/i.test(initRc) && !existsSync(join(REPO, "node_modules"))) {
    throw new Error("init.bat did not report OK");
  }
  execSync(`cmd /c "${join(REPO, "scripts", "stop.bat")}" <nul`, { encoding: "utf8", timeout: 60_000 });
  console.log("l6: lifecycle scripts PASS");

  rmSync(fixture, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(TRACE, { force: true });

  console.log(`l6: PASS live_success=${liveSuccessCount}`);
}

main().catch((err) => {
  console.error("l6: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
