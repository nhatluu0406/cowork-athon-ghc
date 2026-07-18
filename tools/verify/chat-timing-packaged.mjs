/**
 * Packaged check: create → reopen completed conversation → send/approve → one reply.
 * Also measures turn-timing permission harness latency (verboseLogging).
 */

import { spawn, execSync } from "node:child_process";
import {
  packagedChildEnv,
  LOCAL_SERVICE_READY,
  SERVICE_STATUS_SELECTOR,
  PROVIDER_SETTINGS_SELECTOR,
  SETTINGS_CLOSE_SELECTOR,
  NEW_CONVERSATION_SELECTOR,
} from "./packaged-launch-env.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "coworkghc.exe");
const CDP_PORT = 19241;
const TRACE = join(REPO, ".runtime", "chat-timing.trace");
const FILE = "timing-fixture.txt";
const V1 = "TIMING_CREATE_OK";
const V2 = "TIMING_MODIFY_OK";

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
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
  ws.close();
  return value;
}

async function waitForText(selector, pattern, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(`(() => {
          const nodes = document.querySelectorAll(${JSON.stringify(selector)});
          return Array.from(nodes).map((n) => n.textContent ?? '').join(' | ');
        })()`),
      );
      if (pattern.test(text)) return text;
    } catch {
      // not ready
    }
    await sleep(200);
  }
  throw new Error(`timeout ${selector} ${pattern}`);
}

async function waitForSelector(selector, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdpEvaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    } catch {
      // not ready
    }
    await sleep(100);
  }
  throw new Error(`timeout selector ${selector}`);
}

async function waitForTrace(marker, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(TRACE) && marker.test(readFileSync(TRACE, "utf8"))) return;
    await sleep(100);
  }
  throw new Error(`timeout trace ${marker}`);
}

function launch(extraEnv, profileDir) {
  return spawn(EXE, [`--user-data-dir=${profileDir}`], {
    env: packagedChildEnv(extraEnv),
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopAll(proc) {
  if (proc?.exitCode === null) proc.kill();
  await sleep(2000);
  for (const image of ["coworkghc.exe", "opencode.exe"]) {
    try {
      execSync(`taskkill /F /IM "${image}" /T`, { stdio: "ignore" });
    } catch {
      // ok
    }
  }
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

async function waitTurnStarted(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const started = await cdpEvaluate(`(() => {
      const thinking = document.querySelector('.thinking');
      if (thinking && thinking.hidden === false) return true;
      const runtime = document.querySelector('.status-bar__runtime')?.textContent ?? '';
      return /Đang chạy|Chờ quyền/iu.test(runtime);
    })()`);
    if (started === true) return;
    await sleep(50);
  }
  throw new Error("timeout turn started");
}

async function sendPrompt(prompt) {
  await setComposer(prompt);
  const sendReady = await cdpEvaluate(`(() => {
    const btn = document.querySelector('.send-btn');
    return !!btn && !btn.disabled;
  })()`);
  if (!sendReady) throw new Error("send button disabled — composer locked or not ready");
  await cdpEvaluate(`document.querySelector('.send-btn')?.click()`);
  await waitTurnStarted();
}

async function assistantMessageCount() {
  return Number(await cdpEvaluate(`document.querySelectorAll('.msg--assistant .msg__text').length`));
}

/** Fail-fast: click Allow as soon as the permission card is actionable. */
async function waitTerminalAfterPermission(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let approved = false;
  let sawPermission = false;
  let sawRunning = false;
  while (Date.now() < deadline) {
    const snap = await cdpEvaluate(`(() => {
      const dialog = document.querySelector('.permission-dialog');
      const btn = document.querySelector('.permission-dialog .permission-allow, .permission-allow');
      if (dialog) {
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          btn.click();
          return { state: 'clicked' };
        }
        return { state: 'permission-pending' };
      }
      const thinking = document.querySelector('.thinking');
      const runtime = document.querySelector('.status-bar__runtime')?.textContent ?? '';
      if ((thinking && thinking.hidden === false) || /Đang chạy|Chờ quyền/iu.test(runtime)) {
        return { state: 'running' };
      }
      const nodes = Array.from(document.querySelectorAll('.msg--assistant .msg__text'));
      const last = nodes[nodes.length - 1];
      return {
        state: 'idle',
        assistant: last?.textContent?.trim() ?? '',
      };
    })()`);

    if (snap?.state === "clicked") {
      approved = true;
      sawPermission = true;
      await sleep(50);
      continue;
    }
    if (snap?.state === "permission-pending") {
      sawPermission = true;
      await sleep(50);
      continue;
    }
    if (snap?.state === "running") {
      sawRunning = true;
      await sleep(50);
      continue;
    }
    const assistant = String(snap?.assistant ?? "");
    if (assistant.length === 0) {
      await sleep(50);
      continue;
    }
    if (approved) return assistant;
    // Permission never appeared — turn finished without a gate.
    if (sawRunning && !sawPermission) return assistant;
    // Permission was shown but not yet approved; keep polling.
    await sleep(50);
  }
  throw new Error("timeout permission allow");
}

function waitForFileContent(filePath, expected, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (!existsSync(filePath)) {
        if (Date.now() >= deadline) reject(new Error(`file missing: ${filePath}`));
        else setTimeout(check, 100);
        return;
      }
      const content = readFileSync(filePath, "utf8");
      if (content.includes(expected)) resolve(content);
      else if (Date.now() >= deadline) reject(new Error(`file content mismatch: ${content.slice(0, 80)}`));
      else setTimeout(check, 100);
    };
    check();
  });
}

async function readTurnTiming() {
  return await cdpEvaluate(`window.__CGHC_LAST_TURN_TIMING__ ?? null`);
}

function permissionApproveMsFromTiming(report) {
  if (!report?.durationsMs) return null;
  const key = Object.keys(report.durationsMs).find((k) => k.includes("PERMISSION_SHOWN->PERMISSION_APPROVED"));
  return key !== undefined ? report.durationsMs[key] : null;
}

function summarizeTiming(label, report) {
  if (report == null) {
    console.log(`${label}: no timing report (verboseLogging may be off)`);
    return null;
  }
  console.log(`${label}: slowest=${report.slowest}`);
  console.log(`${label}: durations=${JSON.stringify(report.durationsMs)}`);
  console.log(`${label}: stages=${(report.marks ?? []).map((m) => m.stage).join(" -> ")}`);
  return report.slowest;
}

async function onboard(fixture, profileDir) {
  rmSync(TRACE, { force: true });
  writeFileSync(TRACE, "", "utf8");
  const proc = launch(
    {
      COWORK_GHC_STARTUP_TRACE: TRACE,
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixture,
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
    },
    profileDir,
  );
  await waitForTrace(/settings_only_started:|service_started:/);
  await waitForSelector(".app-shell");
  await waitForText(
    SERVICE_STATUS_SELECTOR,
    new RegExp(`(?:${LOCAL_SERVICE_READY.source})|(?:^|\\s)Sẵn sàng(?:\\s|$)`, "i"),
  );
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitForText(".workspace-context", /cghc-timing-ws-/i);
  await cdpEvaluate(`document.querySelector(${JSON.stringify(PROVIDER_SETTINGS_SELECTOR)})?.click()`);
  await waitForSelector(".provider-profiles");
  await cdpEvaluate(`document.querySelector('.provider-profiles__add')?.click()`);
  await sleep(100);
  await cdpEvaluate(`(() => {
    const presets = Array.from(document.querySelectorAll('.provider-profiles__preset'));
    const deepseek = presets.find((el) => /DeepSeek/i.test(el.textContent ?? ''));
    deepseek?.click();
    return !!deepseek;
  })()`);
  await waitForSelector(".provider-profiles__form-view:not([hidden]) .llm-credential-input");
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`(() => {
    const form = document.querySelector('.provider-profiles__form-view:not([hidden])');
    const input = form?.querySelector('.llm-credential-input');
    if (!input) return false;
    input.value = ${JSON.stringify(apiKey)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.querySelector('.llm-save-credential')?.click();
    return true;
  })()`);
  await waitForText(
    ".provider-profiles__form-view:not([hidden]) .llm-credential-status, .llm-settings-status",
    /Đã cấu hình|Đã lưu và xác minh|thành công/i,
    90_000,
  );
  await cdpEvaluate(`document.querySelector(${JSON.stringify(SETTINGS_CLOSE_SELECTOR)})?.click()`);
  const verbose = await cdpEvaluate(`(async () => {
    const bridge = window.coworkShell;
    if (!bridge?.getBootstrap) return { ok: false, reason: 'no-bridge' };
    const b = await bridge.getBootstrap();
    if (!b?.serviceBaseUrl || !b?.clientToken) return { ok: false, reason: 'no-bootstrap' };
    const res = await fetch(b.serviceBaseUrl + '/v1/settings/general', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer ' + b.clientToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ verboseLogging: true }),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, verbose: body?.data?.settings?.general?.verboseLogging ?? body?.settings?.general?.verboseLogging };
  })()`);
  console.log(`timing: verboseLogging enable => ${JSON.stringify(verbose)}`);
  return proc;
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);
  loadProjectEnvForVerify();
  if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required");

  const fixture = mkdtempSync(join(tmpdir(), "cghc-timing-ws-"));
  mkdirSync(fixture, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "cghc-timing-profile-"));
  const filePath = join(fixture, FILE);

  let proc = await onboard(fixture, profileDir);
  try {
    console.log("timing: create-file turn (seed old conversation)");
    const beforeCreate = await assistantMessageCount();
    await sendPrompt(`Tạo file ${FILE} với nội dung ${V1}.`);
    await waitTerminalAfterPermission();
    await waitForFileContent(filePath, V1);
    const afterCreate = await assistantMessageCount();
    if (afterCreate !== beforeCreate + 1) throw new Error(`create: expected +1 assistant, got ${beforeCreate}->${afterCreate}`);
    const createReport = await readTurnTiming();
    const createSlowest = summarizeTiming("create", createReport);
    const permMs = permissionApproveMsFromTiming(createReport);
    console.log(`timing: permission harness PERMISSION_SHOWN->PERMISSION_APPROVED = ${permMs ?? "n/a"}ms`);

    console.log("timing: open new chat then reopen completed conversation");
    await cdpEvaluate(`document.querySelector(${JSON.stringify(NEW_CONVERSATION_SELECTOR)})?.click()`);
    await sleep(300);
    await cdpEvaluate(`document.querySelector('.history-item__select, .history-item')?.click()`);
    await sleep(300);
    const sendEnabled = await cdpEvaluate(`(() => {
      const btn = document.querySelector('.send-btn');
      const locked = document.querySelector('.composer.is-locked');
      const banner = document.querySelector('.continuation-banner');
      return {
        sendDisabled: btn?.disabled === true,
        locked: !!locked,
        bannerVisible: !!(banner && !banner.hidden && banner.isConnected),
      };
    })()`);
    console.log(`timing: reopen composer state ${JSON.stringify(sendEnabled)}`);
    if (sendEnabled?.locked === true) throw new Error("reopen: composer still locked");
    if (sendEnabled?.bannerVisible === true) throw new Error("reopen: continuation banner still visible");

    console.log("timing: send on reopened conversation + approve file op");
    const beforeReopen = await assistantMessageCount();
    await sendPrompt(`Ghi đè file ${FILE} với nội dung ${V2}.`);
    await waitTerminalAfterPermission();
    await waitForFileContent(filePath, V2);
    const afterReopen = await assistantMessageCount();
    if (afterReopen !== beforeReopen + 1) {
      throw new Error(`reopen: expected exactly +1 assistant reply, got ${beforeReopen}->${afterReopen}`);
    }
    const reopenReport = await readTurnTiming();
    const reopenSlowest = summarizeTiming("reopen", reopenReport);
    const reopenPermMs = permissionApproveMsFromTiming(reopenReport);

    console.log(
      `timing: PASS; createSlowest=${createSlowest} reopenSlowest=${reopenSlowest} permMs create=${permMs} reopen=${reopenPermMs}`,
    );
  } finally {
    await stopAll(proc);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
