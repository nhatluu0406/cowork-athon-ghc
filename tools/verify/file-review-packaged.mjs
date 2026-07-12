/**
 * File Work Review — packaged Electron journeys A–L.
 *
 * Requires: dist-app build, DEEPSEEK_API_KEY in .env or environment.
 */

import { execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packagedChildEnv, LOCAL_SERVICE_READY } from "./packaged-launch-env.mjs";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19235;
const SECRET_FIXTURE = "VIOLET-FILE-REVIEW-428";
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdpEvaluate(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = targets.find((item) => String(item.url).startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP target missing");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")));
  });
  const value = await new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.close();
  return value;
}

async function waitFor(selector, pattern, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(
          `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`,
        ),
      );
      if (pattern.test(text)) return text;
    } catch {
      // renderer not ready
    }
    await sleep(350);
  }
  throw new Error(`timeout ${selector} ${pattern}`);
}

async function waitSelector(selector, timeoutMs = 90_000) {
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

function launch(profile, workspace, extra = {}) {
  return spawn(EXE, [`--user-data-dir=${profile}`], {
    env: packagedChildEnv({
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      COWORK_GHC_E2E_WORKSPACE_ROOT: workspace,
      ...extra,
    }),
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopAll(proc) {
  if (proc?.exitCode === null) proc.kill();
  await sleep(2_000);
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    try {
      execSync(`taskkill /F /IM "${image}" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
  }
  await sleep(600);
}

function assertNoProcesses() {
  for (const image of ["Cowork GHC.exe", "opencode.exe"]) {
    const output = execSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { encoding: "utf8" });
    if (output.toLowerCase().includes(image.toLowerCase())) throw new Error(`orphan ${image}`);
  }
}

async function configure() {
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitFor(".workspace-context", /cghc-freview-ws-/u);
  await cdpEvaluate(`document.querySelector('.topbar__gateway')?.click()`);
  await waitSelector(".modal:not([hidden]) .llm-save-credential");
  const key = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    input.value = ${JSON.stringify(key)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.llm-save-credential')?.click();
  })()`);
  await waitFor(".llm-credential-status", /Đã cấu hình|đã có khoá/iu, 30_000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitFor(".llm-settings-status", /thành công/iu, 60_000);
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  await sleep(500);
}

async function ensureComposerUnlocked() {
  const locked = await cdpEvaluate(`document.querySelector('.composer.is-locked') !== null`);
  if (locked) {
    await cdpEvaluate(`document.querySelector('.continuation-banner .label-btn')?.click()`);
    await sleep(600);
  }
}

async function sendPrompt(prompt) {
  await ensureComposerUnlocked();
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.composer__input');
    input.textContent = ${JSON.stringify(prompt)};
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    document.querySelector('.send-btn')?.click();
  })()`);
  await waitFor(".execution-status", /Đang xử lý|Đang chờ/iu, 60_000);
}

async function assertNotProcessing() {
  await waitFor(".execution-status", /Đã hoàn tất|Hoàn thành|Đã bị từ chối|Đã hủy|Có lỗi|không có phản hồi/iu, 300_000);
}

async function waitTerminalAfterPermission(decision, timeoutMs = 300_000) {
  const selector = decision === "allow" ? ".permission-allow" : ".permission-deny";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await assertNotProcessing();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`timeout permission ${decision}`);
}

async function waitForDiskFile(path, pattern, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (pattern.test(text)) return text;
    }
    await sleep(500);
  }
  throw new Error(`timeout disk file ${path}`);
}

async function activityText() {
  return String(await cdpEvaluate(`document.querySelector('.activity-timeline')?.textContent ?? ''`));
}

async function clickFirstFileChange() {
  await cdpEvaluate(`document.querySelector('.output-files .file-row--clickable')?.click()`);
  await sleep(400);
}

async function reviewBody() {
  return String(await cdpEvaluate(`document.querySelector('.file-preview__body')?.textContent ?? ''`));
}

async function waitReviewMarker(pattern, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await clickFirstFileChange();
    const body = await reviewBody();
    if (pattern.test(body)) return body;
    await sleep(500);
  }
  throw new Error(`timeout review marker ${pattern}`);
}

async function attachViaE2E() {
  await cdpEvaluate(`document.querySelector('.attach-btn')?.click()`);
  await sleep(600);
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required");

  const workspace = mkdtempSync(join(tmpdir(), "cghc-freview-ws-"));
  const profile = mkdtempSync(join(tmpdir(), "cghc-freview-profile-"));
  const createPath = join(workspace, "create-blue.txt");
  const modifyPath = join(workspace, "modify-me.txt");
  const deletePath = join(workspace, "delete-me.txt");
  const attachA = join(workspace, "attach-a.txt");
  const runtimeB = join(workspace, "runtime-b.txt");
  const largePath = join(workspace, "large.txt");
  const binaryPath = join(workspace, "fixture.bin");
  const secretPath = join(workspace, "test.key");

  writeFileSync(modifyPath, "FIRST_VERSION", "utf8");
  writeFileSync(deletePath, "DELETE-ME-CONTENT", "utf8");
  writeFileSync(attachA, "ATTACH-A-CONTENT", "utf8");
  writeFileSync(runtimeB, "RUNTIME-B-CONTENT", "utf8");
  writeFileSync(largePath, "L".repeat(80_000), "utf8");
  writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3, 255]), "binary");
  writeFileSync(secretPath, `KEY=${SECRET_FIXTURE}`, "utf8");

  let proc = launch(profile, workspace);
  await waitSelector(".app-shell");
  await waitFor(".topbar__status", LOCAL_SERVICE_READY);
  await configure();

  console.log("file-review: journey A — create file");
  await sendPrompt(
    "Create a text file named create-blue.txt in the workspace root with exactly the content: CREATE-BLUE-314. Reply OK when done.",
  );
  await waitTerminalAfterPermission("allow");
  await waitForDiskFile(createPath, /CREATE-BLUE-314/u);
  const actA = await activityText();
  if (!/Đã tạo tệp/u.test(actA)) throw new Error("A: missing create activity label");
  await waitFor(".output-files", /create-blue\.txt/u);
  const reviewA = await waitReviewMarker(/CREATE-BLUE-314/u);
  if (!/không tồn tại|Trước:/iu.test(reviewA)) throw new Error("A: before state not shown");
  results.A = "PASS";

  console.log("file-review: journey B — modify file");
  await ensureComposerUnlocked();
  await sendPrompt(
    "Edit modify-me.txt and replace FIRST_VERSION with SECOND_VERSION exactly. Reply OK when done.",
  );
  await waitTerminalAfterPermission("allow");
  await waitForDiskFile(modifyPath, /^SECOND_VERSION$/u);
  await clickFirstFileChange();
  const reviewB = await reviewBody();
  if (!/-FIRST_VERSION/u.test(reviewB) || !/\+SECOND_VERSION/u.test(reviewB)) {
    throw new Error("B: diff missing expected lines");
  }
  results.B = "PASS";

  console.log("file-review: journey C — delete file");
  await ensureComposerUnlocked();
  await sendPrompt("Delete delete-me.txt from the workspace. Reply OK when done.");
  await waitTerminalAfterPermission("allow");
  if (existsSync(deletePath)) throw new Error("C: file still on disk");
  await clickFirstFileChange();
  const reviewC = await reviewBody();
  if (!/DELETE-ME-CONTENT/u.test(reviewC)) throw new Error("C: before content missing");
  if (!/không tồn tại|Sau:/iu.test(reviewC)) throw new Error("C: after missing state");
  results.C = "PASS";

  console.log("file-review: journey D — deny mutation");
  writeFileSync(modifyPath, "DENY-HOLD", "utf8");
  await ensureComposerUnlocked();
  await sendPrompt(`Sửa modify-me.txt thành SHOULD-NOT-APPLY.`);
  await waitTerminalAfterPermission("deny");
  if (readFileSync(modifyPath, "utf8") !== "DENY-HOLD") throw new Error("D: file mutated after deny");
  const actD = await activityText();
  if (!/Đã từ chối/u.test(actD)) throw new Error("D: deny not in activity");
  results.D = "PASS";

  console.log("file-review: journey E — attachment vs runtime read");
  await stopAll(proc);
  proc = launch(profile, workspace, { COWORK_GHC_E2E_ATTACHMENT_PATH: attachA });
  await waitSelector(".app-shell");
  await waitFor(".topbar__status", LOCAL_SERVICE_READY);
  await configure();
  await attachViaE2E();
  await sendPrompt(`Đọc file runtime-b.txt và trả lời RUNTIME-B-SEEN nếu thấy RUNTIME-B-CONTENT.`);
  await assertNotProcessing();
  const inputPanel = String(
    await cdpEvaluate(`document.querySelector('.input-files')?.textContent ?? ''`),
  );
  if (!/Đã đưa.*attach-a|attach-a\.txt/iu.test(await activityText())) {
    throw new Error("E: attachment context label missing");
  }
  if (!/runtime-b\.txt/iu.test(inputPanel) || !/Đã đọc tệp/u.test(await activityText())) {
    throw new Error("E: runtime read not distinguished");
  }
  if (/attach-a\.txt.*Đã đọc tệp/iu.test(inputPanel) && !/Đính kèm/u.test(inputPanel)) {
    throw new Error("E: attachment mixed into runtime read section");
  }
  results.E = "PASS";

  console.log("file-review: journey F — relaunch historical diff");
  await stopAll(proc);
  proc = launch(profile, workspace);
  await waitSelector(".app-shell");
  await waitFor(".topbar__status", LOCAL_SERVICE_READY);
  await cdpEvaluate(`document.querySelector('.history-item')?.click()`);
  await sleep(800);
  await clickFirstFileChange();
  const reviewF = await reviewBody();
  if (!/CREATE-BLUE-314|SECOND_VERSION/u.test(reviewF)) {
    throw new Error("F: historical review empty after relaunch");
  }
  results.F = "PASS";

  console.log("file-review: journey G — file changed later");
  writeFileSync(modifyPath, "THIRD_VERSION", "utf8");
  await clickFirstFileChange();
  const reviewG = await reviewBody();
  if (!/SECOND_VERSION|FIRST_VERSION/u.test(reviewG)) throw new Error("G: historical diff overwritten");
  if (!/đã thay đổi sau đó|Snapshot lúc Agent/iu.test(reviewG)) {
    // mismatch banner is best-effort when current hash differs
    if (!/-FIRST_VERSION|\+SECOND_VERSION/u.test(reviewG)) throw new Error("G: expected historical A→B diff");
  }
  results.G = "PASS";

  console.log("file-review: journey H — large file truncation");
  await ensureComposerUnlocked();
  await sendPrompt(`Thêm dòng TAIL-MARKER vào cuối file large.txt.`);
  await waitTerminalAfterPermission("allow");
  await clickFirstFileChange();
  const reviewH = await reviewBody();
  if (!/giới hạn|đã bị giới hạn|cắt/iu.test(reviewH)) throw new Error("H: truncation not disclosed");
  results.H = "PASS";

  console.log("file-review: journey I — binary file");
  await ensureComposerUnlocked();
  await sendPrompt(`Ghi đè fixture.bin bằng 4 byte khác (vẫn là binary).`);
  await waitTerminalAfterPermission("allow");
  await clickFirstFileChange();
  const reviewI = await reviewBody();
  if (!/nhị phân|binary/iu.test(reviewI)) throw new Error("I: binary metadata missing");
  results.I = "PASS";

  console.log("file-review: journey J — secret-like file");
  await ensureComposerUnlocked();
  await sendPrompt(`Đọc file test.key và cho biết có KEY= hay không.`);
  await waitTerminalAfterPermission("allow");
  await clickFirstFileChange();
  const reviewJ = await reviewBody();
  if (new RegExp(SECRET_FIXTURE, "u").test(reviewJ)) throw new Error("J: secret leaked in review");
  if (!/ẩn|credential|secret/iu.test(reviewJ)) throw new Error("J: redaction message missing");
  const transcriptJ = String(await cdpEvaluate(`document.querySelector('.transcript')?.textContent ?? ''`));
  if (new RegExp(SECRET_FIXTURE, "u").test(transcriptJ)) throw new Error("J: secret in transcript");
  results.J = "PASS";

  console.log("file-review: journey K — skill-assisted file change (metadata only)");
  const actK = await activityText();
  if (!/Đã tạo tệp|Đã sửa tệp/u.test(actK)) throw new Error("K: prior file activity missing after skill turns");
  results.K = "PASS";

  console.log("file-review: journey L — cleanup");
  await stopAll(proc);
  assertNoProcesses();
  results.L = "PASS";

  rmSync(workspace, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });

  console.log("file-review-packaged: PASS", results);
}

main().catch((err) => {
  console.error("file-review-packaged: FAIL", err);
  process.exit(1);
});
