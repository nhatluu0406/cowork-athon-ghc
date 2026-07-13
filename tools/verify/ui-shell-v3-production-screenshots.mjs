/**
 * Packaged UI Shell V3 production screenshots.
 * Launches win-unpacked app, drives renderer via CDP, writes reports/ui-shell-v3-production/.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagedChildEnv } from "./packaged-launch-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const OUT_DIR = join(REPO, "reports", "ui-shell-v3-production");
const CDP_PORT = 19228;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCdp(run) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => typeof t.url === "string" && t.url.startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("Renderer CDP target not found.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
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

async function waitFor(call, expression, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(call, expression)) return;
    } catch {
      // settling
    }
    await sleep(400);
  }
  throw new Error(`Timed out: ${expression}`);
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

const repoLiteral = JSON.stringify(REPO);

async function captureAll(call) {
  mkdirSync(OUT_DIR, { recursive: true });
  await call("Runtime.enable");
  await call("Page.enable");

  await waitFor(call, `(() => !!document.querySelector('.shell-frame'))()`);

  await evaluate(
    call,
    `(async () => {
      const bootstrap = await window.coworkShell.getBootstrap();
      if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken) return false;
      const headers = { authorization: 'Bearer ' + bootstrap.clientToken, 'content-type': 'application/json' };
      await fetch(bootstrap.serviceBaseUrl + '/v1/workspace/grant', {
        method: 'POST',
        headers,
        body: JSON.stringify({ rootPath: ${repoLiteral} }),
      });
      await fetch(bootstrap.serviceBaseUrl + '/v1/settings/active-workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ rootPath: ${repoLiteral} }),
      });
      return true;
    })()`,
  );

  await capture(call, "cowork-1920.png", 1920, 1080);
  await capture(call, "cowork-1366.png", 1366, 768);
  await capture(call, "cowork-900.png", 900, 768);

  await evaluate(call, `(() => document.querySelector('[data-work-mode="workspace"]')?.click())()`);
  await sleep(400);
  await capture(call, "workspace-empty.png", 1366, 768);

  await evaluate(call, `(() => {
    const rows = [...document.querySelectorAll('.workspace-tree__row--file')];
    const safe = rows.find((row) => {
      const path = row.title ?? '';
      if (/\.env/i.test(path) || /credential|secret|\.pem|\.key/i.test(path)) return false;
      return /README\.md$/i.test(path) || /\.md$/i.test(path);
    });
    (safe ?? rows.find((row) => !/\\.env/i.test(row.title ?? '')))?.click();
  })()`);
  await waitFor(call, `(() => !!document.querySelector('.workspace-preview__body')?.textContent)`);
  await sleep(300);
  await capture(call, "workspace-file.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="knowledge"]')?.click())()`);
  await waitFor(call, `(() => document.querySelector('.shell-frame')?.classList.contains('shell-frame--no-sidebar'))()`);
  await capture(call, "knowledge-base.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-knowledge-tab="graph"]')?.click())()`);
  await sleep(300);
  await capture(call, "knowledge-graph.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="gateway"]')?.click())()`);
  await waitFor(call, `(() => /Gateway/.test(document.body.textContent ?? ''))()`);
  await capture(call, "gateway.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="cowork"]')?.click())()`);
  await sleep(300);
  await capture(call, "provider-missing.png", 1366, 768);
  await evaluate(call, `(() => document.querySelector('.activity-mobile-toggle')?.click())()`);
  await sleep(400);
  await capture(call, "permission.png", 1366, 768);
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}. Run scripts\\build.bat first.`);

  const proc = spawn(EXE, [], {
    env: packagedChildEnv({ COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT) }),
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await sleep(4000);
    await withCdp(captureAll);
  } finally {
    if (proc.exitCode === null) proc.kill();
    await sleep(1500);
    try {
      execSync(`taskkill /F /IM "Cowork GHC.exe" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
    try {
      execSync(`taskkill /F /IM "opencode.exe" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
    console.log("process cleanup: OK");
  }
}

await main();
