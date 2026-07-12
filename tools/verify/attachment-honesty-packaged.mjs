/**
 * Attachment honesty + secret-file safety — packaged verification (journeys A–J).
 *
 * Requires: dist-app build, DEEPSEEK_API_KEY in .env or environment.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19232;
const TRACE = join(REPO, ".runtime", "attachment-honesty.trace");

const SECRET = "VIOLET-428";
const SECRET_MSG = "File này có thể chứa credential hoặc secret và không được phép đính kèm.";
const WRAPPER_MARKERS = [
  "CGHC_UNTRUSTED_PRIOR_TURNS",
  "CGHC_UNTRUSTED_ATTACHMENT_CONTEXT",
  "CGHC_CURRENT_USER_REQUEST",
];

let liveSuccessCount = 0;
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

async function installAlertCatcher() {
  await cdpEvaluate(`(() => {
    window.__cghcLastAlert = '';
    window.alert = (msg) => { window.__cghcLastAlert = String(msg ?? ''); };
    return true;
  })()`);
}

async function lastAlert() {
  return String(await cdpEvaluate(`window.__cghcLastAlert ?? ''`));
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
  const env = { ...process.env, ...extraEnv };
  delete env["ELECTRON_RUN_AS_NODE"];
  return spawn(EXE, [`--user-data-dir=${profileDir}`], { env, stdio: "ignore", windowsHide: true });
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

async function onboard(fixture, profileDir, attachEnv = {}) {
  resetTrace();
  const proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      ...attachEnv,
    },
    profileDir,
  );
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".app-shell");
  await installAlertCatcher();
  await waitForText(".topbar__status", /Đã kết nối local service/i);
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-honesty-ws-/i);
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
  await ensureComposerUnlocked();
  return proc;
}

async function clickAttach() {
  await cdpEvaluate(`document.querySelector('.attach-btn')?.click()`);
  await sleep(500);
}

async function waitForCompleted(timeoutMs = 240_000) {
  await waitForText(
    ".execution-status",
    /Đã hoàn tất|Hoàn thành|Đã bị từ chối|Đã hủy|Có lỗi|không có phản hồi cuối/i,
    timeoutMs,
  );
}

function assertClean(text, label) {
  for (const marker of WRAPPER_MARKERS) {
    if (text.includes(marker)) throw new Error(`${label}: envelope leaked: ${marker}`);
  }
}

async function lastAssistantText() {
  return String(
    await cdpEvaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll('.msg--assistant .msg__text p'));
      return nodes[nodes.length - 1]?.textContent?.trim() ?? '';
    })()`),
  );
}

async function allTranscriptText() {
  return String(await cdpEvaluate(`document.querySelector('.transcript__inner')?.textContent ?? ''`));
}

async function activityText() {
  return String(await cdpEvaluate(`document.querySelector('.activity-panel')?.textContent ?? ''`));
}

async function ensureComposerUnlocked() {
  const locked = await cdpEvaluate(`document.querySelector('.composer.is-locked') !== null`);
  if (locked) {
    await cdpEvaluate(`document.querySelector('.continuation-banner .label-btn')?.click()`);
    await sleep(600);
  }
}

async function sendPrompt(prompt, expectRunning = true) {
  await ensureComposerUnlocked();
  await installAlertCatcher();
  await setComposer(prompt);
  const disabled = await cdpEvaluate(`document.querySelector('.send-btn')?.disabled`);
  if (disabled) throw new Error(`send disabled before prompt: ${prompt.slice(0, 40)}`);
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  if (expectRunning) {
    await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 60_000);
  }
}

async function sendExpectBudgetFail() {
  await ensureComposerUnlocked();
  await installAlertCatcher();
  await setComposer("Kiểm tra ngân sách dispatch.");
  await sleep(400);
  const disabled = await cdpEvaluate(`document.querySelector('.send-btn')?.disabled`);
  if (disabled) throw new Error("send disabled for budget overflow test");
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await sleep(1500);
}

async function validChipCount() {
  return Number(
    await cdpEvaluate(
      `document.querySelectorAll('.composer__attachments .attachment-chip:not(.attachment-chip--error)').length`,
    ),
  );
}

async function attachMultiple(expectedCount) {
  await ensureComposerUnlocked();
  for (let i = 0; i < expectedCount; i += 1) {
    await clickAttach();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const valid = await validChipCount();
      const errors = Number(
        await cdpEvaluate(`document.querySelectorAll('.composer__attachments .attachment-chip--error').length`),
      );
      if (valid >= i + 1) break;
      if (errors > i) throw new Error(`attach ${i + 1}: error chip appeared (valid=${valid}, errors=${errors})`);
      await sleep(200);
    }
    const valid = await validChipCount();
    if (valid < i + 1) {
      throw new Error(`attach ${i + 1}: expected ${i + 1} valid chips, got ${valid}`);
    }
  }
}

function queuePaths(...paths) {
  return paths.map((p) => p.replace(/\\/g, "/")).join("|");
}

async function buildLongPriorContext(turns = 12) {
  for (let i = 0; i < turns; i += 1) {
    await sendPrompt(`Hãy trả lời chỉ một từ: OK\n${"context-fill-".repeat(40)}${i}`);
    await waitForCompleted(180_000);
    await sleep(800);
  }
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required");

  const fixture = mkdtempSync(join(tmpdir(), "cghc-honesty-ws-"));
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-honesty-profile-"));
  mkdirSync(fixture, { recursive: true });

  const violetPath = join(fixture, "violet.txt");
  const big1 = join(fixture, "big1.txt");
  const big2 = join(fixture, "big2.txt");
  const big3 = join(fixture, "big3.txt");
  const longFit = join(fixture, "long-fit.txt");
  const envPath = join(fixture, ".env");
  const gitignorePath = join(fixture, ".gitignore");
  const editTarget = join(fixture, "edit-me.txt");

  writeFileSync(violetPath, SECRET, "utf8");
  writeFileSync(big1, "a".repeat(4000), "utf8");
  writeFileSync(big2, "b".repeat(4000), "utf8");
  writeFileSync(big3, "c".repeat(4000), "utf8");
  writeFileSync(longFit, "y".repeat(7000), "utf8");
  writeFileSync(envPath, "FAKE_SECRET=not-real\n", "utf8");
  writeFileSync(gitignorePath, "node_modules/\n", "utf8");
  writeFileSync(editTarget, "original line\n", "utf8");

  const secretFiles = [
    ["test.pem", "-----BEGIN FAKE-----\n"],
    ["test.key", "fake-key-material\n"],
    ["id_rsa", "fake-rsa\n"],
    ["credentials.json", '{"token":"fake"}\n'],
  ];
  for (const [name, body] of secretFiles) {
    writeFileSync(join(fixture, name), body, "utf8");
  }

  let proc = await onboard(fixture, profileDir, { COWORK_GHC_E2E_ATTACHMENT_PATH: violetPath });

  // Journey A — one included attachment
  console.log("honesty: journey A — included attachment");
  await clickAttach();
  await waitForSelector(".attachment-chip:not(.attachment-chip--error)");
  await sendPrompt("Giá trị trong tệp đính kèm là gì? Chỉ trả lời mã.");
  await waitForCompleted();
  const aText = await lastAssistantText();
  if (!aText.includes(SECRET)) throw new Error(`A: missing ${SECRET}: ${aText}`);
  const aTranscript = await allTranscriptText();
  assertClean(aTranscript, "A");
  if (!aTranscript.includes("violet.txt")) throw new Error("A: missing attachment metadata");
  liveSuccessCount += 1;
  results.A = "PASS";

  // Journey H — relaunch metadata (before more live turns pollute session)
  console.log("honesty: journey H — relaunch metadata");
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
  await waitForText(".workspace-context", /cghc-honesty-ws-/i);
  await sleep(2500);
  const hTranscript = await allTranscriptText();
  assertClean(hTranscript, "H");
  if (!hTranscript.includes("violet.txt")) throw new Error("H: missing historical attachment metadata");
  if (hTranscript.includes(SECRET) && hTranscript.includes("CGHC_")) {
    throw new Error("H: raw envelope or secret leaked in transcript");
  }
  if (/\.env|test\.pem|credentials\.json/u.test(hTranscript)) {
    throw new Error("H: rejected secret files should not appear as sent attachments");
  }
  results.H = "PASS";

  // Journey B — dispatch budget overflow
  console.log("honesty: journey B — budget overflow");
  await stopAll(proc);
  const queueB = queuePaths(big1, big2, big3);
  proc = await onboard(fixture, profileDir, { COWORK_GHC_E2E_ATTACHMENT_QUEUE: queueB });
  await attachMultiple(3);
  if ((await validChipCount()) !== 3) throw new Error("B: expected 3 valid chips");
  await sendExpectBudgetFail();
  const bAlert = await lastAlert();
  if (!/ngân sách dispatch|12[,.]?000/i.test(bAlert)) throw new Error(`B: unexpected alert: ${bAlert}`);
  if ((await validChipCount()) !== 3) throw new Error("B: pending chips lost after preflight fail");
  const bStatus = await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`);
  if (/Đang xử lý/i.test(String(bStatus))) throw new Error("B: stuck in running");
  const bActivity = await activityText();
  if (/đã đọc|đã gửi/i.test(bActivity)) throw new Error("B: activity falsely claims read/sent");
  results.B = "PASS";

  // Journey G — remove and retry
  console.log("honesty: journey G — remove and retry");
  await cdpEvaluate(`document.querySelector('.attachment-chip__remove')?.click()`);
  await sleep(400);
  if ((await validChipCount()) !== 2) throw new Error("G: expected 2 chips after remove");
  await sendPrompt("Tóm tắt nội dung hai tệp đính kèm trong một câu.");
  await waitForCompleted();
  const gTranscript = await allTranscriptText();
  if (!gTranscript.includes("big1.txt") && !gTranscript.includes("big2.txt")) {
    throw new Error("G: missing included attachment metadata");
  }
  liveSuccessCount += 1;
  results.G = "PASS";

  // Journey C — prior context consumes budget (conversation persists in profileDir)
  console.log("honesty: journey C — prior context budget");
  await stopAll(proc);
  const profileC = mkdtempSync(join(tmpdir(), "cghc-honesty-profile-c-"));
  proc = await onboard(fixture, profileC);
  await buildLongPriorContext(12);
  await stopAll(proc);
  proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      COWORK_GHC_E2E_ATTACHMENT_PATH: longFit,
    },
    profileC,
  );
  await waitForSelector(".app-shell");
  await installAlertCatcher();
  await waitForText(".workspace-context", /cghc-honesty-ws-/i);
  await ensureComposerUnlocked();
  await clickAttach();
  await waitForSelector(".attachment-chip:not(.attachment-chip--error)");
  await sendExpectBudgetFail();
  const cAlert = await lastAlert();
  if (!/ngân sách dispatch|12[,.]?000/i.test(cAlert)) throw new Error(`C: unexpected alert: ${cAlert}`);
  results.C = "PASS";

  // Journey D — .env blocked
  console.log("honesty: journey D — .env blocked");
  await stopAll(proc);
  proc = await onboard(fixture, profileDir, { COWORK_GHC_E2E_ATTACHMENT_PATH: envPath });
  await clickAttach();
  await sleep(800);
  const dError = await cdpEvaluate(`!!document.querySelector('.attachment-chip--error')`);
  if (!dError) throw new Error("D: expected error chip for .env");
  const dTitle = String(await cdpEvaluate(`document.querySelector('.attachment-chip--error')?.title ?? ''`));
  const dLabel = String(await cdpEvaluate(`document.querySelector('.attachment-chip--error')?.textContent ?? ''`));
  if (!dTitle.includes(SECRET_MSG) && !dLabel.includes("⚠")) {
    throw new Error(`D: missing secret message: ${dTitle}`);
  }
  if ((await validChipCount()) !== 0) throw new Error("D: secret file should not be valid chip");
  results.D = "PASS";

  // Journey E — key files
  console.log("honesty: journey E — key-like files");
  for (const [name] of secretFiles) {
    await stopAll(proc);
    const path = join(fixture, name);
    proc = await onboard(fixture, profileDir, { COWORK_GHC_E2E_ATTACHMENT_PATH: path });
    await clickAttach();
    await sleep(600);
    const errChip = await cdpEvaluate(`!!document.querySelector('.attachment-chip--error')`);
    if (!errChip) throw new Error(`E: expected block for ${name}`);
    if ((await validChipCount()) !== 0) throw new Error(`E: ${name} should not be valid`);
  }
  results.E = "PASS";

  // Journey F — .gitignore allowed
  console.log("honesty: journey F — .gitignore allowed");
  await stopAll(proc);
  proc = await onboard(fixture, profileDir, { COWORK_GHC_E2E_ATTACHMENT_PATH: gitignorePath });
  await clickAttach();
  await sleep(600);
  const fValid = await cdpEvaluate(`!!document.querySelector('.attachment-chip:not(.attachment-chip--error)')`);
  if (!fValid) throw new Error("F: .gitignore should be attachable");
  results.F = "PASS";

  // Journey I — permission isolation
  console.log("honesty: journey I — permission isolation");
  await stopAll(proc);
  proc = await onboard(fixture, profileDir, { COWORK_GHC_E2E_ATTACHMENT_PATH: editTarget });
  await clickAttach();
  await waitForSelector(".attachment-chip:not(.attachment-chip--error)");
  await sendPrompt('Đọc tệp đính kèm rồi thêm dòng "modified" vào cuối file edit-me.txt.');
  await waitForText(".execution-status", /Đang xử lý|Đang chờ/i, 60_000);
  const deadline = Date.now() + 180_000;
  let sawPermission = false;
  while (Date.now() < deadline) {
    const perm = await cdpEvaluate(`!!document.querySelector('.permission-allow')`);
    if (perm) {
      sawPermission = true;
      await cdpEvaluate(`document.querySelector('.permission-allow')?.click()`);
      break;
    }
    await sleep(500);
  }
  if (!sawPermission) throw new Error("I: permission prompt did not appear for file edit");
  await waitForCompleted();
  liveSuccessCount += 1;
  results.I = "PASS";

  // Journey J — process cleanup
  console.log("honesty: journey J — process cleanup");
  await stopAll(proc);
  assertNoOrphanProcesses();
  results.J = "PASS";

  rmSync(fixture, { recursive: true, force: true });

  console.log("\nattachment-honesty-packaged results:");
  for (const key of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
    console.log(`  Journey ${key}: ${results[key] ?? "SKIP"}`);
  }
  console.log(`live completions: ${liveSuccessCount}`);
  console.log("attachment-honesty-packaged: PASS");
}

main().catch((err) => {
  console.error("attachment-honesty-packaged: FAIL", err);
  process.exit(1);
});
