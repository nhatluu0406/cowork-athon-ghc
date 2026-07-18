/**
 * Packaged provider recovery verification (invalid key / model / base URL).
 * Uses isolated profile — does not touch the Product Owner keyring entry.
 *
 * Live budget: at most 3 provider API calls (invalid key, invalid model, valid recovery).
 */

import { spawn, execSync } from "node:child_process";
import { packagedChildEnv, LOCAL_SERVICE_READY } from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "coworkghc.exe");
const CDP_PORT = 19227;
const TRACE = join(REPO, ".runtime", "provider-recovery.trace");
const INVALID_KEY = "sk-cghc-invalid-probe-000000000000000000000000";
const INVALID_MODEL = "cghc-invalid-model-00000";
const BAD_BASE_URL = "https://192.0.2.1/v1";
const VALID_BASE_URL = "https://api.deepseek.com/v1";

let liveRequestCount = 0;

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countProcesses(imageName) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, { encoding: "utf8" });
    return out.split(/\r?\n/u).filter((line) => line.toLowerCase().includes(imageName.toLowerCase())).length;
  } catch {
    return 0;
  }
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
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  ws.close();
  return result;
}

async function waitForText(selector, pattern, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = String(
      await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`),
    );
    if (pattern.test(text)) return text;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${selector} to match ${pattern}`);
}

async function openSettings() {
  await cdpEvaluate(`document.querySelector('.topbar__gateway')?.click()`);
  await waitForText(".llm-settings-title", /Cài đặt nhà cung cấp/i);
}

async function clickTestConnection() {
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
}

async function saveCredential(secret) {
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(secret)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await cdpEvaluate(`document.querySelector('.llm-save-credential')?.click()`);
  await waitForText(".llm-settings-status", /Đã lưu khoá API/i);
}

async function setBaseUrl(url) {
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-base-url');
    if (!input) return false;
    input.value = ${JSON.stringify(url)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitForText(".llm-settings-status", /Đã lưu base URL|bị từ chối|không hợp lệ/i, 30_000);
}

async function setInvalidModel() {
  await cdpEvaluate(`(() => {
    const sel = document.querySelector('.llm-model-select');
    if (!sel) return false;
    let opt = Array.from(sel.options).find((o) => o.value === ${JSON.stringify(INVALID_MODEL)});
    if (!opt) {
      opt = document.createElement('option');
      opt.value = ${JSON.stringify(INVALID_MODEL)};
      opt.textContent = 'invalid-model';
      sel.append(opt);
    }
    sel.value = ${JSON.stringify(INVALID_MODEL)};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitForText(".llm-settings-status", /Đã lưu mô hình/i);
}

async function restoreValidModel() {
  await cdpEvaluate(`(() => {
    const sel = document.querySelector('.llm-model-select');
    if (!sel) return false;
    sel.value = 'deepseek-chat';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitForText(".llm-settings-status", /Đã lưu mô hình/i);
}

function launch(env, profileDir) {
  return spawn(EXE, [`--user-data-dir=${profileDir}`], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stop(proc) {
  if (proc && !proc.killed) {
    proc.kill();
    await sleep(3000);
  }
  try {
    execSync(`cmd /c "echo.| call scripts\\stop.bat"`, { cwd: REPO, stdio: "ignore", timeout: 60_000 });
  } catch {
    // best effort
  }
  await sleep(2000);
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}`);
  loadProjectEnvForVerify();
  const validKey = process.env["DEEPSEEK_API_KEY"]?.trim();
  if (!validKey) throw new Error("DEEPSEEK_API_KEY required in .env for isolated profile verification.");

  const fixture = mkdtempSync(join(tmpdir(), "cghc-recovery-ws-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-recovery-profile-"));
  rmSync(TRACE, { force: true });
  writeFileSync(TRACE, "", "utf8");

  const proc = launch({
    COWORK_GHC_STARTUP_TRACE: TRACE,
    COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
    COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
  }, profileDir);

  await sleep(8000);
  await waitForText(".topbar__status", /Đã kết nối local service/i, 90_000);

  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-recovery-ws-/i);

  await openSettings();
  await saveCredential(validKey);
  await setBaseUrl(VALID_BASE_URL);
  await restoreValidModel();

  console.log("recovery: invalid API key");
  await saveCredential(INVALID_KEY);
  await clickTestConnection();
  const authErr = await waitForText(".llm-settings-status", /Xác thực bị từ chối/i);
  if (/sk-[a-z0-9]{8,}/i.test(authErr)) throw new Error("Credential leaked in auth error");
  liveRequestCount += 1;

  console.log("recovery: restore valid key");
  await saveCredential(validKey);

  console.log("recovery: invalid model");
  await setInvalidModel();
  await clickTestConnection();
  const modelErr = await waitForText(".llm-settings-status", /Mô hình không được/i);
  if (/sk-[a-z0-9]{8,}/i.test(modelErr)) throw new Error("Credential leaked in model error");
  liveRequestCount += 1;
  await restoreValidModel();

  console.log("recovery: invalid base URL");
  await setBaseUrl(BAD_BASE_URL);
  await clickTestConnection();
  const urlErr = await waitForText(
    ".llm-settings-status",
    /Không kết nối được tới base URL|không phản hồi kịp thời|tạm thời không khả dụng/i,
    90_000,
  );
  if (/Kết nối thành công/i.test(urlErr)) throw new Error("invalid base URL should not succeed");

  console.log("recovery: restore valid URL and succeed");
  await setBaseUrl(VALID_BASE_URL);
  await clickTestConnection();
  await waitForText(".llm-settings-status", /Kết nối thành công/i);
  liveRequestCount += 1;

  const workspace = String(
    await cdpEvaluate(`document.querySelector('.workspace-context')?.textContent ?? ''`),
  );
  if (!/cghc-recovery-ws-/i.test(workspace)) throw new Error("Workspace context lost after recovery");

  await cdpEvaluate(`document.querySelector('.modal .icon-btn')?.click()`);
  await stop(proc);

  const coworkLeft = countProcesses("coworkghc.exe");
  const opencodeLeft = countProcesses("opencode.exe");
  if (coworkLeft > 0 || opencodeLeft > 0) {
    throw new Error(`Orphans after close: cowork=${coworkLeft} opencode=${opencodeLeft}`);
  }

  rmSync(fixture, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(TRACE, { force: true });

  console.log(`provider-recovery-packaged: PASS live_requests=${liveRequestCount}`);
}

main().catch((err) => {
  console.error("provider-recovery-packaged: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
