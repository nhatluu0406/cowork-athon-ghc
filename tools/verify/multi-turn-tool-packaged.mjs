/**
 * Multi-turn tool regression — packaged verification.
 *
 * Journey A (one conversation): create → modify → read multi-turn-fixture.txt
 * Journey B (separate conversation): deny file create → text recovery turn
 * Relaunch: restore transcripts, verify file state, no running turn
 *
 * Live budget: ≤4 successful completions (A: 3, B recovery: 1).
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv, LOCAL_SERVICE_READY } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19229;
const TRACE = join(REPO, ".runtime", "multi-turn-tool.trace");

const FIXTURE_A = "multi-turn-fixture.txt";
const VERSION_1 = "FIRST_VERSION";
const VERSION_2 = "SECOND_VERSION";
const DENY_FILE = "denied-fixture.txt";
const RECOVERY_TOKEN = "RECOVERY_OK";

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

function assertNoOwnedProcesses() {
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    try {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { encoding: "utf8" });
      if (/\.exe/i.test(out) && !/No tasks/i.test(out)) {
        throw new Error(`process still running: ${image}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("process still running")) throw err;
    }
  }
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
  await waitForText(".workspace-context", /cghc-mtt-ws-/i);
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

async function assertNotProcessing() {
  const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
  if (/Đang xử lý/i.test(status)) throw new Error(`still processing: ${status}`);
  if (/Internal boundary error/i.test(status)) throw new Error(`boundary error: ${status}`);
}

async function waitForCompleted(timeoutMs = 240_000) {
  await waitForText(
    ".execution-status",
    /Đã hoàn tất|Hoàn thành|Đã bị từ chối|Đã hủy|Có lỗi|không có phản hồi cuối/i,
    timeoutMs,
  );
  await assertNotProcessing();
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
  return Number(await cdpEvaluate(`document.querySelectorAll('.msg--assistant .msg__text').length`));
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
      const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
      if (/Có lỗi/i.test(status)) throw new Error(`terminal error: ${status}`);
      const text = await lastAssistantText();
      if (text.length === 0) throw new Error("assistant empty");
      if (decision === "deny" && !/Đã bị từ chối|Đã hủy|Đã hoàn tất/i.test(status)) {
        throw new Error(`unexpected deny status: ${status}`);
      }
      return text;
    } catch (err) {
      if (err instanceof Error && /terminal error|boundary error/i.test(err.message)) throw err;
    }
    await sleep(500);
  }
  throw new Error(`timeout permission ${decision}`);
}

async function sendPrompt(prompt) {
  await setComposer(prompt);
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 60_000);
}

function waitForFileContent(filePath, expected, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (!existsSync(filePath)) {
        if (Date.now() >= deadline) reject(new Error(`file missing: ${filePath}`));
        else setTimeout(check, 500);
        return;
      }
      const content = readFileSync(filePath, "utf8");
      if (content.includes(expected)) resolve(content);
      else if (Date.now() >= deadline) reject(new Error(`file content mismatch: got ${content.slice(0, 80)}`));
      else setTimeout(check, 500);
    };
    check();
  });
}

async function panelText(selector) {
  return String(await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`));
}

function readConversationDiagnostics(profileDir) {
  const convRoot = join(profileDir, ".runtime", "conversations");
  if (!existsSync(convRoot)) return { conversations: [] };
  const indexPath = join(convRoot, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { conversations: [] };
  const records = [];
  for (const summary of index.conversations ?? []) {
    const path = join(convRoot, `${summary.id}.json`);
    if (!existsSync(path)) continue;
    const record = JSON.parse(readFileSync(path, "utf8"));
    records.push({
      id: record.id,
      status: record.status,
      runtimeSessionId: record.runtimeSessionId,
      runtimeTurns: (record.runtimeTurns ?? []).map((t) => ({
        runtimeSessionId: t.runtimeSessionId,
        status: t.status,
      })),
      messageCount: record.messages?.length ?? 0,
    });
  }
  return { lastActive: index.lastActiveConversationId ?? null, conversations: records };
}

function logDiagnostics(label, profileDir) {
  const diag = readConversationDiagnostics(profileDir);
  const redacted = diag.conversations.map((c) => ({
    id: c.id.slice(0, 8),
    status: c.status,
    turns: c.runtimeTurns.length,
        turnIds: c.runtimeTurns.map((t) => t.runtimeSessionId.slice(0, 12)),
    turnStatuses: c.runtimeTurns.map((t) => t.status),
    messages: c.messageCount,
  }));
  console.log(`${label}: convs=${redacted.length} lastActive=${diag.lastActive?.slice(0, 8) ?? "none"}`);
  for (const c of redacted) {
    console.log(`  conv=${c.id} status=${c.status} turns=${c.turns} msgs=${c.messages} turnIds=${c.turnIds.join(",")}`);
  }
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required");

  const fixture = mkdtempSync(join(tmpdir(), "cghc-mtt-ws-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-mtt-profile-"));
  const fileA = join(fixture, FIXTURE_A);
  const fileDeny = join(fixture, DENY_FILE);

  let proc = await onboard(fixture, profileDir);
  const convCountStart = Number(await cdpEvaluate(`document.querySelectorAll('.history-item').length`));

  console.log("tool-regression: journey A turn 1 — create file");
  const assistantsBeforeT1 = await assistantMessageCount();
  await sendPrompt(`Tạo file ${FIXTURE_A} với nội dung ${VERSION_1}.`);
  await waitTerminalAfterPermission("allow");
  await waitForFileContent(fileA, VERSION_1);
  const outputAfterT1 = await panelText(".output-files");
  if (!outputAfterT1.includes(FIXTURE_A)) throw new Error("turn 1: file not in output panel");
  const assistantsAfterT1 = await assistantMessageCount();
  if (assistantsAfterT1 !== assistantsBeforeT1 + 1) throw new Error("turn 1: duplicate assistant message");
  liveSuccessCount += 1;
  logDiagnostics("after A1", profileDir);

  console.log("tool-regression: journey A turn 2 — modify file (same conversation)");
  const assistantsBeforeT2 = await assistantMessageCount();
  await sendPrompt(`Ghi đè file ${FIXTURE_A} với nội dung ${VERSION_2}.`);
  await waitTerminalAfterPermission("allow");
  await waitForFileContent(fileA, VERSION_2);
  if (readFileSync(fileA, "utf8").includes(VERSION_1) && !readFileSync(fileA, "utf8").includes(VERSION_2)) {
    throw new Error("turn 2: file still has FIRST_VERSION");
  }
  const assistantsAfterT2 = await assistantMessageCount();
  if (assistantsAfterT2 !== assistantsBeforeT2 + 1) throw new Error("turn 2: unexpected assistant message count");
  liveSuccessCount += 1;
  logDiagnostics("after A2", profileDir);

  const diagA2 = readConversationDiagnostics(profileDir);
  const convA = diagA2.conversations[0];
  if (!convA || convA.runtimeTurns.length < 2) {
    throw new Error("turn 2: expected ≥2 runtime turns on conversation A");
  }
  const turnIdsA = convA.runtimeTurns.map((t) => t.runtimeSessionId);
  if (new Set(turnIdsA).size !== turnIdsA.length) throw new Error("turn 2: duplicate runtime turn ids");

  console.log("tool-regression: journey A turn 3 — read file (same conversation)");
  await sendPrompt(`Nội dung hiện tại của ${FIXTURE_A} là gì?`);
  await waitForCompleted();
  await waitAssistantText(new RegExp(VERSION_2));
  if (!readFileSync(fileA, "utf8").includes(VERSION_2)) throw new Error("turn 3: workspace file mismatch");
  liveSuccessCount += 1;
  logDiagnostics("after A3", profileDir);

  const convAId = convA.id;

  console.log("tool-regression: journey B — new conversation, deny file create");
  await cdpEvaluate(`document.querySelector('.sidebar__new-btn')?.click()`);
  await sleep(1000);
  const convCountAfterNew = Number(await cdpEvaluate(`document.querySelectorAll('.history-item').length`));
  if (convCountAfterNew < convCountStart + 1) throw new Error("journey B: new conversation not created");

  rmSync(fileDeny, { force: true });
  await sendPrompt(`Tạo file ${DENY_FILE} với nội dung DENIED_CONTENT.`);
  await waitTerminalAfterPermission("deny");
  if (existsSync(fileDeny)) throw new Error("journey B: denied file was created");
  const permHistory = await panelText(".permission-history");
  if (!/từ chối|denied|Đã từ chối/i.test(permHistory)) {
    throw new Error("journey B: permission denial not in history");
  }
  await assertNotProcessing();

  console.log("tool-regression: journey B turn 2 — recovery prompt");
  const assistantsBeforeB2 = await assistantMessageCount();
  await sendPrompt(`Bỏ qua mọi yêu cầu trước. Trả lời CHỈ đúng cụm này, không thêm gì: ${RECOVERY_TOKEN}`);
  await waitForCompleted();
  const recoveryText = await waitAssistantText(new RegExp(RECOVERY_TOKEN));
  const assistantsAfterB2 = await assistantMessageCount();
  if (assistantsAfterB2 < assistantsBeforeB2 + 1) {
    throw new Error("journey B turn 2: no new assistant message");
  }
  console.log(`tool-regression: recovery ok (${recoveryText.length} chars)`);
  liveSuccessCount += 1;
  logDiagnostics("after B2", profileDir);

  const diagB = readConversationDiagnostics(profileDir);
  if (diagB.conversations.length < 2) throw new Error("expected 2 conversations persisted");
  const convB = diagB.conversations.find((c) => c.id !== convAId);
  if (!convB) throw new Error("conversation B not found");
  if (convB.runtimeTurns.length < 2) throw new Error("journey B: expected ≥2 runtime turns after recovery");
  if (convB.id === convAId) throw new Error("conversation IDs must differ");

  if (liveSuccessCount > 4) throw new Error(`live budget exceeded: ${liveSuccessCount}`);

  console.log("tool-regression: relaunch verification");
  await stopAll(proc);
  assertNoOwnedProcesses();

  proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileDir,
  );
  await waitForSelector(".app-shell");
  await waitForText(".workspace-context", /cghc-mtt-ws-/i);
  await sleep(2000);
  await assertNotProcessing();

  const historyCount = Number(await cdpEvaluate(`document.querySelectorAll('.history-item').length`));
  if (historyCount < 2) throw new Error(`relaunch: expected ≥2 conversations, got ${historyCount}`);

  if (!readFileSync(fileA, "utf8").includes(VERSION_2)) throw new Error("relaunch: fixture A wrong content");
  if (existsSync(fileDeny)) throw new Error("relaunch: denied file should not exist");

  const restoredMsgs = await assistantMessageCount();
  if (restoredMsgs < 1) throw new Error("relaunch: no assistant messages on last conversation");

  logDiagnostics("after relaunch", profileDir);

  await stopAll(proc);
  assertNoOwnedProcesses();
  rmSync(fixture, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(TRACE, { force: true });

  console.log(`multi-turn-tool-packaged: PASS live_success=${liveSuccessCount}`);
}

main().catch(async (e) => {
  try {
    const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
    const assistant = await lastAssistantText().catch(() => "");
    console.error(`debug status=${status} assistantLen=${assistant.length}`);
  } catch {
    // ignore
  }
  console.error("multi-turn-tool-packaged: FAIL", e instanceof Error ? e.message : e);
  try {
    execSync(`cmd /c "echo.| call scripts\\stop.bat"`, { cwd: REPO, stdio: "ignore" });
  } catch {
    /* ok */
  }
  process.exit(1);
});
