/**
 * Multi-turn conversation packaged verification.
 *
 * Journeys (combined, ≤4 successful live completions):
 *  A — three-turn context (ORANGE-731) in one Cowork conversation
 *  B — file create on turn 3 (partial file continuity)
 *  D — relaunch restores last conversation + send turn 4
 *
 * Deny/cancel recovery in same conversation: covered by unit tests + release-regression.
 *
 * Live inference budget: ≤4 successful completions.
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv, LOCAL_SERVICE_READY } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19228;
const TRACE = join(REPO, ".runtime", "multi-turn-packaged.trace");
const MEMORY_CODE = "ORANGE-731";
const FIXTURE_FILE = "mt-continuity.txt";
const FIXTURE_CONTENT = "MT_CONTINUITY_OK";

let liveSuccessCount = 0;

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

function resetTrace() {
  rmSync(TRACE, { force: true });
  writeFileSync(TRACE, "", "utf8");
}

async function waitForTrace(marker, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(TRACE) && marker.test(readFileSync(TRACE, "utf8"))) return;
    await sleep(200);
  }
  throw new Error(`timeout trace ${marker}`);
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

async function waitForText(selector, pattern, timeoutMs = 180_000) {
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
  throw new Error(`timeout ${selector} ${pattern}`);
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
  throw new Error(`timeout selector ${selector}`);
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

function launch(extraEnv, profileDir) {
  return spawn(EXE, [`--user-data-dir=${profileDir}`], { env: packagedChildEnv(extraEnv), stdio: "ignore", windowsHide: true });
}

async function stopAll(proc) {
  if (proc?.exitCode === null) proc.kill();
  await sleep(3000);
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    try {
      execSync(`taskkill /F /IM "${image}" /T`, { stdio: "ignore" });
    } catch {
      // ok
    }
  }
  await sleep(1000);
}

async function onboard(fixture, profileDir) {
  resetTrace();
  const proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileDir,
  );
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".app-shell");
  await waitForText(".topbar__status", /Đã kết nối local service/i);
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-mt-ws-/i);
  await cdpEvaluate(`document.querySelector('.topbar__gateway')?.click()`);
  await waitForSelector(".llm-save-credential");
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(apiKey)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.llm-save-credential')?.click();
    return true;
  })()`);
  await waitForText(".llm-credential-status", /Đã cấu hình|đã có khoá/i, 30_000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /thành công/i, 60_000);
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  return proc;
}

async function waitForCompleted(timeoutMs = 240_000) {
  await waitForText(
    ".execution-status",
    /Đã hoàn tất|Hoàn thành|Đã bị từ chối|Đã hủy|Có lỗi|không có phản hồi cuối/i,
    timeoutMs,
  );
  await assertNotProcessing();
}

async function assertNotProcessing() {
  const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
  if (/Đang xử lý/i.test(status)) throw new Error(`still processing: ${status}`);
  if (/Internal boundary error/i.test(status)) throw new Error(`boundary error: ${status}`);
}

async function lastAssistantText() {
  return String(
    await cdpEvaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll('.msg--assistant .msg__text'));
      const last = nodes[nodes.length - 1];
      return last?.textContent?.trim() ?? '';
    })()`),
  );
}

async function assistantMessageCount() {
  return Number(
    await cdpEvaluate(`document.querySelectorAll('.msg--assistant .msg__text').length`),
  );
}

async function waitAssistantText(pattern, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await lastAssistantText();
    if (pattern.test(text)) return text;
    await sleep(500);
  }
  throw new Error(`timeout assistant text ${pattern}`);
}

async function waitTerminalAfterPermission(decision, timeoutMs = 240_000) {
  const selector = decision === "allow" ? ".permission-allow" : ".permission-deny";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await assertNotProcessing();
      const text = await lastAssistantText();
      if (text.length > 0) return text;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`timeout permission ${decision}`);
}

async function sendPrompt(prompt) {
  await setComposer(prompt);
  const before = await assistantMessageCount();
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 60_000);
  return before;
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required");

  const fixture = mkdtempSync(join(tmpdir(), "cghc-mt-ws-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-mt-profile-"));

  let proc = await onboard(fixture, profileDir);

  console.log("multi-turn: journey A turn 1 — remember code");
  await sendPrompt(`Hãy nhớ mã kiểm tra là ${MEMORY_CODE}. Chỉ xác nhận đã nhớ.`);
  await waitForCompleted();
  liveSuccessCount += 1;

  console.log("multi-turn: journey A turn 2 — recall code (same conversation)");
  await sendPrompt("Mã kiểm tra vừa rồi là gì? Trả lời ngắn gọn.");
  await waitForCompleted();
  const turn2 = await waitAssistantText(new RegExp(MEMORY_CODE.replace("-", "\\-")));
  console.log(`multi-turn: turn 2 recalled code (${turn2.length} chars)`);
  liveSuccessCount += 1;

  console.log("multi-turn: journey A turn 3 — related follow-up (same conversation, no tools)");
  await sendPrompt(`Viết lại mã kiểm tra ${MEMORY_CODE} và thêm dấu chấm than ở cuối.`);
  await waitForCompleted();
  const turn3 = await waitAssistantText(new RegExp(MEMORY_CODE.replace("-", "\\-")));
  console.log(`multi-turn: turn 3 follow-up (${turn3.length} chars)`);
  liveSuccessCount += 1;

  const msgCountBeforeRelaunch = await assistantMessageCount();
  if (msgCountBeforeRelaunch < 3) throw new Error(`expected ≥3 assistant messages, got ${msgCountBeforeRelaunch}`);

  console.log("multi-turn: journey D — relaunch + last conversation restore");
  await stopAll(proc);
  proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileDir,
  );
  await waitForSelector(".app-shell");
  await waitForText(".workspace-context", /cghc-mt-ws-/i);
  await sleep(2000);
  await assertNotProcessing();
  const restoredMsgs = await assistantMessageCount();
  if (restoredMsgs < 3) {
    throw new Error(`relaunch did not restore transcript (assistant msgs=${restoredMsgs})`);
  }

  console.log("multi-turn: journey B + D turn 4 — file create after relaunch");
  await sendPrompt(`Tạo file ${FIXTURE_FILE} với nội dung ${FIXTURE_CONTENT}.`);
  await waitTerminalAfterPermission("allow");
  const filePath = join(fixture, FIXTURE_FILE);
  const fileDeadline = Date.now() + 30_000;
  while (Date.now() < fileDeadline) {
    if (existsSync(filePath) && readFileSync(filePath, "utf8").includes(FIXTURE_CONTENT)) break;
    await sleep(500);
  }
  if (!existsSync(filePath)) throw new Error(`fixture file missing: ${filePath}`);
  liveSuccessCount += 1;

  if (liveSuccessCount > 4) throw new Error(`live budget exceeded: ${liveSuccessCount}`);

  await stopAll(proc);
  rmSync(fixture, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(TRACE, { force: true });

  console.log(`multi-turn-packaged: PASS live_success=${liveSuccessCount}`);
}

main().catch(async (e) => {
  try {
    const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
    const assistant = await lastAssistantText().catch(() => "");
    console.error(`debug status=${status} assistantLen=${assistant.length}`);
  } catch {
    // ignore
  }
  console.error("multi-turn-packaged: FAIL", e instanceof Error ? e.message : e);
  try {
    execSync(`cmd /c "echo.| call scripts\\stop.bat"`, { cwd: REPO, stdio: "ignore" });
  } catch {
    /* ok */
  }
  process.exit(1);
});
