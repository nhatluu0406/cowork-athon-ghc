/**
 * Capture pre-merge baseline layout screenshots (launch packaged app, CDP drive, stop).
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packagedChildEnv } from "./packaged-launch-env.mjs";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const OUT_DIR = join(REPO, "reports", "pre-merge-baseline");
const CDP_PORT = 19227;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopPackaged() {
  try {
    execSync(`taskkill /F /IM "Cowork GHC.exe" /T`, { stdio: "ignore" });
  } catch {
    // already stopped
  }
}

async function waitForCdp(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const found = list.find((item) => typeof item.url === "string" && item.url.startsWith("app://cowork"));
      if (found?.webSocketDebuggerUrl) return;
    } catch {
      // CDP not ready yet.
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for CDP on port ${CDP_PORT}`);
}

async function target() {
  await waitForCdp();
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const found = list.find((item) => typeof item.url === "string" && item.url.startsWith("app://cowork"));
  if (!found?.webSocketDebuggerUrl) throw new Error("Packaged renderer CDP target not found.");
  return found.webSocketDebuggerUrl;
}

async function withCdp(run) {
  const ws = new WebSocket(await target());
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    const slot = pending.get(msg.id);
    if (slot === undefined) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message ?? "CDP call failed"));
    else slot.resolve(msg.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    return await run(call);
  } finally {
    ws.close();
  }
}

async function evaluate(call, expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed.");
  }
  return result.result?.value;
}

async function waitFor(call, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(call, expression)) return;
    } catch {
      // Renderer still settling.
    }
    await sleep(350);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function capture(call, filename, width, height) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  if (!shot?.data) throw new Error(`No screenshot data for ${filename}`);
  writeFileSync(join(OUT_DIR, filename), Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${join(OUT_DIR, filename)}`);
}

async function resetLayout(call) {
  await evaluate(
    call,
    `(() => {
      const workspace = document.querySelector('.workspace');
      workspace?.classList.remove('sidebar-collapsed', 'activity-drawer-open');
      const panel = document.querySelector('.right-panel');
      panel?.classList.remove('right-panel--collapsed');
      panel?.setAttribute('aria-hidden', 'false');
      return true;
    })()`,
  );
}

await (async () => {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);
  stopPackaged();
  const proc = spawn(EXE, [], {
    env: packagedChildEnv({ COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT) }),
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await withCdp(async (call) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await call("Runtime.enable");
  await call("Page.enable");
  await waitFor(call, `(() => !!document.querySelector('.workspace'))()`);
  await resetLayout(call);
  await sleep(200);

  await capture(call, "expanded.png", 1920, 1080);

  await evaluate(call, `(() => document.querySelector('.sidebar-collapse')?.click())()`);
  await waitFor(call, `(() => document.querySelector('.workspace')?.classList.contains('sidebar-collapsed'))()`);
  await capture(call, "sidebar-collapsed.png", 1920, 1080);

  await resetLayout(call);
  await sleep(200);
  await evaluate(call, `(() => document.querySelector('.right-panel-topbar-toggle')?.click())()`);
  await waitFor(call, `(() => document.querySelector('.right-panel')?.classList.contains('right-panel--collapsed'))()`);
  await capture(call, "right-panel-collapsed.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('.sidebar-collapse')?.click())()`);
  await waitFor(call, `(() => document.querySelector('.workspace')?.classList.contains('sidebar-collapsed'))()`);
  await capture(call, "both-collapsed.png", 900, 768);
    });
  } finally {
    if (proc.exitCode === null) proc.kill();
    await sleep(1500);
    stopPackaged();
    const remaining = (() => {
      try {
        const out = execSync(`tasklist /FI "IMAGENAME eq Cowork GHC.exe" /NH`, { encoding: "utf8" });
        return out.split(/\r?\n/u).filter((line) => line.includes("Cowork GHC.exe")).length;
      } catch {
        return 0;
      }
    })();
    if (remaining > 0) throw new Error(`orphan Cowork GHC.exe processes: ${remaining}`);
    console.log("pre-merge-baseline-screenshots: process cleanup OK");
  }
})();
