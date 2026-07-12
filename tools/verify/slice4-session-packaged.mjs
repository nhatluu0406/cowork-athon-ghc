/**
 * Packaged Slice 4 verification: one minimal OpenCode live session through the GUI.
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19224;
const TRACE = join(REPO, ".runtime", "slice4-session-packaged.trace");
const FIXTURE_FILE = "cghc-fixture.txt";
const FIXTURE_CONTENT = "CGHC_SLICE4_OK";

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

async function waitForSelector(selector, timeoutMs = 120_000) {
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

async function waitForText(selector, pattern, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`),
      );
      if (pattern.test(text)) return text;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${selector} to match ${pattern}`);
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
  try {
    execSync('taskkill /F /IM "opencode.exe" /T', { stdio: "ignore" });
  } catch {
    // none
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
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) {
    throw new Error("DEEPSEEK_API_KEY must be set for live OpenCode verification.");
  }

  const fixture = mkdtempSync(join(tmpdir(), "cghc-ws-s4-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-profile-s4-"));
  resetTrace();

  console.log("slice4: launch + onboard workspace/provider");
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
  await waitForSelector(".session-start-btn");
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await sleep(1500);
  await waitForSelector(".llm-import-env");
  await cdpEvaluate(`document.querySelector('.llm-import-env')?.click()`);
  await sleep(2000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await sleep(8000);
  const connStatus = String(
    await cdpEvaluate(`document.querySelector('.llm-settings-status')?.textContent ?? ''`),
  );
  if (!/thành công/i.test(connStatus)) {
    throw new Error(`Provider connectivity failed: ${connStatus}`);
  }

  console.log("slice4: start live session");
  await cdpEvaluate(`document.querySelector('.session-start-btn')?.click()`);
  const traceAfterStart = await waitForTrace(/live_ready:|live_failed:/);
  if (/live_failed:/.test(traceAfterStart) && !/live_ready:/.test(traceAfterStart)) {
    throw new Error(`OpenCode live start failed: ${traceAfterStart}`);
  }
  await waitForText(".session-panel-status", /sẵn sàng/i, 120_000);

  console.log("slice4: send PING prompt");
  await cdpEvaluate(`document.querySelector('.session-prompt-input').value = 'Reply with only the word PING.'`);
  await cdpEvaluate(`document.querySelector('.session-send-btn')?.click()`);
  await waitForText(".session-stream-output", /PING/i, 180_000);
  console.log("slice4: streaming output observed");

  console.log("slice4: safe workspace action");
  await cdpEvaluate(`document.querySelector('.session-start-btn')?.click()`);
  await waitForText(".session-panel-status", /sẵn sàng/i, 120_000);
  const actionPrompt =
    `Create a text file named ${FIXTURE_FILE} in the workspace root with exactly the content: ${FIXTURE_CONTENT}. Reply OK when done.`;
  await cdpEvaluate(
    `document.querySelector('.session-prompt-input').value = ${JSON.stringify(actionPrompt)}`,
  );
  await cdpEvaluate(`document.querySelector('.session-send-btn')?.click()`);
  await waitForText(".session-panel-status", /hoàn tất/i, 180_000);
  const fixturePath = join(fixture, FIXTURE_FILE);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(fixturePath)) {
      const body = readFileSync(fixturePath, "utf8");
      if (body.includes(FIXTURE_CONTENT)) break;
    }
    await sleep(500);
  }
  if (!existsSync(fixturePath)) throw new Error(`Fixture file not created: ${fixturePath}`);
  console.log("slice4: fixture file verified");

  const pid = proc.pid;
  await stop(proc);
  const coworkLeft = countProcesses("Cowork GHC.exe");
  const opencodeLeft = countProcesses("opencode.exe");
  if (coworkLeft > 0 || opencodeLeft > 0) {
    throw new Error(`Orphan processes remain: cowork=${coworkLeft} opencode=${opencodeLeft}`);
  }
  console.log(`slice4: stopped pid ${pid}, no orphans`);

  rmSync(join(fixture, FIXTURE_FILE), { force: true });
  rmSync(fixture, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(TRACE, { force: true });
  console.log("slice4: PASS (live requests: 2 successful inference)");
}

main().catch((err) => {
  console.error("slice4: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
