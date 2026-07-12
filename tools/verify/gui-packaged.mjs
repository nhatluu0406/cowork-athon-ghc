/**
 * Packaged HuyTT12-GUI integration verification.
 *
 * Uses the real packaged app and the existing persisted provider/keyring settings. It does not
 * import credentials from `.env`; the renderer must never receive a raw provider secret.
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv, LOCAL_SERVICE_READY } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19225;
const TRACE = join(REPO, ".runtime", "gui-packaged.trace");
const FIXTURE_FILE = "cghc-gui-fixture.txt";
const FIXTURE_CONTENT = "CGHC_GUI_OK";

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

async function waitForTerminalWithPermission(pattern, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const allowed = await cdpEvaluate(`(() => {
        const allow = document.querySelector('.permission-allow');
        if (!allow) return false;
        allow.click();
        return true;
      })()`);
      if (allowed === true) console.log("gui: permission approved");
      const status = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
      if (pattern.test(status)) return status;
    } catch {
      // renderer not ready
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for execution status ${pattern}`);
}

function launch(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  
  delete env["DEEPSEEK_API_KEY"];
  return spawn(EXE, [], { env: packagedChildEnv(extraEnv), stdio: "ignore", windowsHide: true });
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

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}`);
  const fixture = mkdtempSync(join(tmpdir(), "cghc-gui-ws-"));
  mkdirSync(fixture, { recursive: true });
  resetTrace();

  console.log("gui: launch packaged app");
  const proc = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  });

  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".app-shell");
  await waitForText(".topbar__status", /Đã kết nối local service/i);
  await waitForSelector(".workspace-choose");
  console.log("gui: shell connected");

  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-gui-ws-/i);
  console.log("gui: workspace selected");

  await clickText("button", /Cài đặt/);
  await waitForSelector(".llm-test-connection");
  const summary = String(await cdpEvaluate(`document.querySelector('.llm-settings-summary')?.textContent ?? ''`));
  if (!/DeepSeek|deepseek-chat|Đã cấu hình/i.test(summary)) {
    throw new Error(`Provider/model settings not restored: ${summary}`);
  }
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitForText(".llm-settings-status", /thành công/i, 60_000);
  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  console.log("gui: provider/keyring connection OK");

  await clickText("button", /Bắt đầu phiên/);
  const traceAfterStart = await waitForTrace(/live_ready:|live_failed:/);
  if (/live_failed:/.test(traceAfterStart) && !/live_ready:/.test(traceAfterStart)) {
    throw new Error(`OpenCode live start failed: ${traceAfterStart}`);
  }
  await waitForText(".execution-status", /Phiên đã sẵn sàng/i);
  console.log("gui: OpenCode session ready");

  await setComposer("Reply with only the word PING.");
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".msg--assistant .msg__text", /PING/i, 180_000);
  console.log("gui: streaming response observed");

  const actionPrompt =
    `Create a text file named ${FIXTURE_FILE} in the workspace root with exactly the content: ${FIXTURE_CONTENT}. Reply OK when done.`;
  await setComposer(actionPrompt);
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForTerminalWithPermission(/Đã hoàn tất/i, 180_000);
  const fixturePath = join(fixture, FIXTURE_FILE);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(fixturePath) && readFileSync(fixturePath, "utf8").includes(FIXTURE_CONTENT)) break;
    await sleep(500);
  }
  if (!existsSync(fixturePath)) throw new Error(`Fixture file not created: ${fixturePath}`);
  await waitForText(".output-files", /cghc-gui-fixture/i, 30_000);
  console.log("gui: safe workspace action verified");

  await setComposer("Write a very long response with at least 200 numbered short lines. Do not create files.");
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitForText(".execution-status", /Đang xử lý/i, 60_000);
  await sleep(1200);
  const cancelVisible = await cdpEvaluate(`(() => {
    const btn = document.querySelector('.stop-btn');
    if (!btn || btn.hidden || btn.disabled) return false;
    btn.click();
    return true;
  })()`);
  if (cancelVisible !== true) throw new Error("Cancel button was not available during a running session.");
  await waitForText(".execution-status", /Đã hủy|Có lỗi xảy ra/i, 120_000);
  const cancelStatus = String(await cdpEvaluate(`document.querySelector('.execution-status')?.textContent ?? ''`));
  if (!/Đã hủy/i.test(cancelStatus)) throw new Error(`Cancellation did not reach cancelled state: ${cancelStatus}`);
  console.log("gui: cancellation verified");

  const pid = proc.pid;
  await stop(proc);
  const coworkLeft = countProcesses("Cowork GHC.exe");
  const opencodeLeft = countProcesses("opencode.exe");
  if (coworkLeft > 0 || opencodeLeft > 0) {
    throw new Error(`Orphan processes remain: cowork=${coworkLeft} opencode=${opencodeLeft}`);
  }

  rmSync(fixture, { recursive: true, force: true });
  rmSync(TRACE, { force: true });
  console.log(`gui: PASS pid=${pid} live requests=2 successful + 1 cancelled`);
}

main().catch((err) => {
  console.error("gui: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
