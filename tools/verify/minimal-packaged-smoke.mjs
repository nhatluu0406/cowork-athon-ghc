/**
 * Minimum packaged smoke after hardening — one successful connection test, clean shutdown.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const CDP_PORT = 19228;

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

function countProcesses(name) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, { encoding: "utf8" });
    return out.split(/\r?\n/u).filter((l) => l.toLowerCase().includes(name.toLowerCase())).length;
  } catch {
    return 0;
  }
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

async function waitFor(pattern, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(await cdpEvaluate(`document.querySelector('.topbar__status')?.textContent ?? ''`));
      if (pattern.test(text)) return;
    } catch {
      // renderer not ready
    }
    await sleep(500);
  }
  throw new Error(`timeout ${pattern}`);
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE}`);
  loadProjectEnvForVerify();
  const validKey = process.env["DEEPSEEK_API_KEY"]?.trim();
  if (!validKey) throw new Error("DEEPSEEK_API_KEY required");

  const fixture = mkdtempSync(join(tmpdir(), "cghc-min-ws-"));
  mkdirSync(fixture, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "cghc-min-profile-"));

  const proc = spawn(EXE, [`--user-data-dir=${profile}`], {
    cwd: REPO,
    env: {
      ...process.env,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    stdio: "ignore",
    windowsHide: true,
  });

  await sleep(10000);
  await waitFor(/Đã kết nối local service/i);
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await sleep(2000);
  await cdpEvaluate(`document.querySelector('.topbar__gateway')?.click()`);
  await sleep(2000);
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(validKey)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.llm-save-credential')?.click();
    return true;
  })()`);
  await sleep(3000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await sleep(5000);
  const status = String(await cdpEvaluate(`document.querySelector('.llm-settings-status')?.textContent ?? ''`));
  if (!/thành công/i.test(status) && !/Kết nối thành công/i.test(status)) {
    throw new Error(`connection test failed: ${status}`);
  }

  proc.kill();
  await sleep(3000);
  try {
    execSync(`cmd /c "echo.| call scripts\\stop.bat"`, { cwd: REPO, stdio: "ignore" });
  } catch {
    /* ok */
  }
  await sleep(2000);

  if (countProcesses("Cowork GHC.exe") > 0 || countProcesses("opencode.exe") > 0) {
    throw new Error("orphan processes after minimal smoke");
  }

  rmSync(fixture, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
  console.log("minimal-packaged-smoke: PASS");
}

main().catch((e) => {
  console.error("minimal-packaged-smoke: FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
