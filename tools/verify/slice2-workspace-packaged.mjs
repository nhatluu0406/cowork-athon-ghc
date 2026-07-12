/**
 * Packaged Slice 2 verification: workspace selection + persistence.
 *
 * Exercises the real packaged app through the renderer button → IPC picker seam → service grant
 * → settings persistence → relaunch restore. When `COWORK_GHC_E2E_WORKSPACE_ROOT` is set the
 * native dialog is bypassed with a dedicated temp fixture (verification only).
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19222;
const TRACE = join(REPO, ".runtime", "slice2-workspace-packaged.trace");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function winSettingsPath() {
  const appData = process.env["APPDATA"];
  if (!appData) throw new Error("APPDATA is required for packaged settings verification.");
  // Electron userData follows package.json `name` (cowork-ghc), not productName.
  return join(appData, "cowork-ghc", ".runtime", "settings.json");
}

function sameWinPath(a, b) {
  try {
    return normalizePath(realpathSync(a)) === normalizePath(realpathSync(b));
  } catch {
    return normalizePath(a) === normalizePath(b);
  }
}

function normalizePath(p) {
  return p.replace(/\//g, "\\").toLowerCase();
}

async function waitForSettingsActive(matchPath, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const settingsPath = winSettingsPath();
  while (Date.now() < deadline) {
    if (existsSync(settingsPath)) {
      const doc = JSON.parse(readFileSync(settingsPath, "utf8"));
      const root = doc.activeWorkspace?.rootPath;
      if (root && sameWinPath(root, matchPath)) return doc;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for settings.activeWorkspace=${matchPath}`);
}

async function waitForTrace(marker, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(TRACE)) {
      const text = readFileSync(TRACE, "utf8");
      const match = text.match(marker);
      if (match) return match[0];
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for trace marker ${marker}`);
}

async function cdpEvaluate(expression) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => typeof t.url === "string" && t.url.startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("Packaged renderer CDP target not found.");

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

async function waitForChooseButton(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const found = await cdpEvaluate(`!!document.querySelector('.workspace-choose')`);
      if (found === true) return;
    } catch {
      // Renderer may not be ready yet.
    }
    await sleep(300);
  }
  throw new Error("Timed out waiting for workspace choose button");
}

async function waitForDomStatus(match, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(`document.querySelector('.workspace-status')?.textContent ?? ''`),
      );
      if (match.test(text)) return text;
    } catch {
      // Renderer may not be ready yet.
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for workspace status ${match}`);
}

function launch(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env["ELECTRON_RUN_AS_NODE"];
  return spawn(EXE, [], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stop(proc) {
  if (proc.exitCode !== null) return;
  proc.kill();
  await sleep(2000);
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}`);

  const fixtureA = mkdtempSync(join(tmpdir(), "cghc-ws-a-"));
  const fixtureB = mkdtempSync(join(tmpdir(), "cghc-ws-b-"));
  mkdirSync(fixtureA, { recursive: true });
  mkdirSync(fixtureB, { recursive: true });

  const settingsPath = winSettingsPath();

  console.log("slice2: launch packaged app with fixture A");
  let proc = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_E2E_WORKSPACE_ROOT: fixtureA,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  });
  await waitForTrace(/service_started:/);
  await waitForChooseButton();
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForDomStatus(/Đang hoạt động:/);
  await waitForSettingsActive(fixtureA);
  console.log("slice2: activation persisted fixture A");

  await stop(proc);

  console.log("slice2: relaunch without picker env to verify restore");
  rmSync(TRACE, { force: true });
  proc = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  });
  await waitForTrace(/service_started:/);
  await waitForChooseButton();
  const restoredStatus = await waitForDomStatus(new RegExp(fixtureA.replace(/\\/g, "\\\\")));
  if (!restoredStatus.includes("Đang hoạt động")) {
    throw new Error("restored workspace not shown as active");
  }
  await waitForSettingsActive(fixtureA);
  console.log("slice2: restore on relaunch OK");

  console.log("slice2: change workspace to fixture B");
  proc.kill();
  await sleep(2000);
  rmSync(TRACE, { force: true });
  proc = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_E2E_WORKSPACE_ROOT: fixtureB,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  });
  await waitForTrace(/service_started:/);
  await waitForChooseButton();
  await waitForDomStatus(new RegExp(fixtureA.replace(/\\/g, "\\\\")));
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForDomStatus(new RegExp(fixtureB.replace(/\\/g, "\\\\")));
  await waitForSettingsActive(fixtureB);
  console.log("slice2: workspace change persisted fixture B");

  const pid = proc.pid;
  await stop(proc);

  const orphans = ["Cowork GHC.exe", "opencode.exe"]
    .map((name) => {
      try {
        return spawn("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        return null;
      }
    });
  await Promise.all(orphans.map((p) => (p ? new Promise((r) => p.on("close", () => r())) : Promise.resolve())));
  console.log(`slice2: stopped packaged root pid ${pid}`);

  rmSync(fixtureA, { recursive: true, force: true });
  rmSync(fixtureB, { recursive: true, force: true });
  console.log("slice2: PASS");
}

main().catch((err) => {
  console.error("slice2: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
