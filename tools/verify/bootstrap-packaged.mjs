/**
 * Packaged bootstrap verification: default userData, no OpenCode/DeepSeek calls.
 *
 * Confirms the settings-only service starts and the renderer can reach the connected state
 * when persisted onboarding settings would previously force a failing live boot.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19223;
const TRACE = join(REPO, ".runtime", "bootstrap-packaged.trace");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetTrace() {
  rmSync(TRACE, { force: true });
  writeFileSync(TRACE, "", "utf8");
}

async function waitForTrace(marker, timeoutMs = 90_000) {
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
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });
  ws.close();
  return result;
}

async function waitForConnected(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(`document.querySelector('.readiness-status')?.textContent ?? ''`),
      );
      if (/Đã kết nối local service/i.test(text)) return text;
    } catch {
      // renderer not ready
    }
    await sleep(300);
  }
  let detail = "";
  try {
    detail = String(
      await cdpEvaluate(`document.querySelector('.readiness-detail')?.textContent ?? ''`),
    );
  } catch {
    // ignore
  }
  throw new Error(`Timed out waiting for connected readiness UI. Detail: ${detail}`);
}

function launch() {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return spawn(EXE, [], {
    env: {
      ...env,
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stop(proc) {
  if (proc.exitCode !== null) return;
  proc.kill();
  await sleep(3000);
  try {
    execSync('taskkill /F /IM "Cowork GHC.exe" /T', { stdio: "ignore" });
  } catch {
    // already stopped
  }
  await sleep(1000);
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}`);
  resetTrace();

  console.log("bootstrap: launch packaged app (default userData)");
  let proc = launch();
  const trace = await waitForTrace(/settings_only_started:|service_started:/);
  if (/live_failed|service_start_failed/.test(trace) && !/settings_only_started:/.test(trace)) {
    throw new Error("Service failed without settings-only bootstrap");
  }
  await waitForConnected();
  console.log("bootstrap: renderer connected");

  const hasWorkspace = await cdpEvaluate(`!!document.querySelector('.workspace-choose')`);
  const hasLlm = await cdpEvaluate(`!!document.querySelector('.llm-test-connection')`);
  if (hasWorkspace !== true || hasLlm !== true) {
    throw new Error("Feature UI did not mount after connected readiness");
  }
  console.log("bootstrap: feature UI mounted");

  await stop(proc);
  resetTrace();

  console.log("bootstrap: relaunch once");
  proc = launch();
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForConnected();
  console.log("bootstrap: relaunch connected");

  const pid = proc.pid;
  await stop(proc);
  console.log(`bootstrap: stopped pid ${pid}`);
  rmSync(TRACE, { force: true });
  console.log("bootstrap: PASS");
}

main().catch((err) => {
  console.error("bootstrap: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
