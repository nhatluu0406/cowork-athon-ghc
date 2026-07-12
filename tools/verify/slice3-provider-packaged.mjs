/**
 * Packaged Slice 3 verification: provider/model settings + credential + test connection.
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19222;
const TRACE = join(REPO, ".runtime", "slice3-provider-packaged.trace");

/** Load project-root `.env` into this process only (verification harness). Never logs values. */
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

async function waitForSelector(selector, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const found = await cdpEvaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (found === true) return;
    } catch {
      // not ready
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForVisibleImport(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const visible = await cdpEvaluate(
        `(() => { const b = document.querySelector('.llm-import-env'); return !!b && b.hidden === false; })()`,
      );
      if (visible === true) return;
    } catch {
      // not ready
    }
    await sleep(300);
  }
  throw new Error("Timed out waiting for visible .llm-import-env");
}

function launch(extraEnv = {}, userDataDir) {
  const env = { ...process.env, ...extraEnv };
  
  const args = userDataDir ? [`--user-data-dir=${userDataDir}`] : [];
  return spawn(EXE, args, { env: packagedChildEnv(extraEnv), stdio: "ignore", windowsHide: true });
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
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) {
    throw new Error("DEEPSEEK_API_KEY must be set in the environment for bounded live verification.");
  }

  const fixture = mkdtempSync(join(tmpdir(), "cghc-ws-s3-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-profile-s3-"));
  resetTrace();

  console.log("slice3: launch with workspace + env import enabled");
  let proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      COWORK_GHC_ALLOW_ENV_IMPORT: "1",
    },
    profileDir,
  );
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".llm-test-connection");
  await waitForSelector(".workspace-choose");
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await sleep(1500);
  await waitForVisibleImport();
  await cdpEvaluate(`document.querySelector('.llm-import-env')?.click()`);
  await sleep(2000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await sleep(8000);
  const status = String(await cdpEvaluate(`document.querySelector('.llm-settings-status')?.textContent ?? ''`));
  if (!/thành công/i.test(status)) {
    throw new Error(`Expected connection success, got: ${status}`);
  }
  console.log("slice3: live test connection OK");

  await stop(proc);
  resetTrace();

  console.log("slice3: relaunch without DEEPSEEK_API_KEY in env");
  const relaunchEnv = { ...process.env };
  delete relaunchEnv["DEEPSEEK_API_KEY"];
  proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileDir,
  );
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".llm-settings-summary");
  const summary = String(await cdpEvaluate(`document.querySelector('.llm-settings-summary')?.textContent ?? ''`));
  if (!/Đã cấu hình/.test(summary) || !/deepseek-chat/i.test(summary)) {
    throw new Error(`restore failed: ${summary}`);
  }
  console.log("slice3: restore OK");

  const pid = proc.pid;
  await stop(proc);
  console.log(`slice3: stopped pid ${pid}`);
  rmSync(fixture, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(TRACE, { force: true });
  console.log("slice3: PASS");
}

main().catch((err) => {
  console.error("slice3: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
