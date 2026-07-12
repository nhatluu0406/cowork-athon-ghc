/**
 * Capture UI v2 screenshots from an already-running packaged app.
 *
 * The app must be started with COWORK_GHC_REMOTE_DEBUG_PORT. The script only drives the
 * packaged renderer over CDP and talks to the local service through the preload bootstrap.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const OUT_DIR = join(REPO, "reports", "ui-v2");
const CDP_PORT = Number(process.env["COWORK_GHC_REMOTE_DEBUG_PORT"] ?? "19227");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function target() {
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
  await sleep(250);
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  if (!shot?.data) throw new Error(`No screenshot data for ${filename}`);
  writeFileSync(join(OUT_DIR, filename), Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${join(OUT_DIR, filename)}`);
}

const repoLiteral = JSON.stringify(REPO);

await withCdp(async (call) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await call("Runtime.enable");
  await call("Page.enable");
  await waitFor(
    call,
    `(() => !!document.querySelector('.app-shell') && !!window.coworkShell)()`,
  );
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
  await call("Page.navigate", { url: "app://cowork/index.html" });
  await waitFor(call, `(() => !!document.querySelector('.workspace-tree__row'))()`);

  await capture(call, "cowork-main-1920.png", 1920, 1080);
  await capture(call, "cowork-main-1366.png", 1366, 768);
  await capture(call, "cowork-main-900.png", 900, 768);
  await evaluate(call, `(() => { const sidebar = document.querySelector('.sidebar'); if (sidebar) sidebar.scrollTop = sidebar.scrollHeight; })()`);
  await sleep(200);
  await capture(call, "workspace-navigator.png", 1920, 1080);
  await evaluate(call, `(() => { const sidebar = document.querySelector('.sidebar'); if (sidebar) sidebar.scrollTop = 0; })()`);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="gateway"]')?.click())()`);
  await waitFor(call, `(() => /Chờ tích hợp D4/.test(document.body.textContent ?? ''))()`);
  await capture(call, "gateway-awaiting-integration.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="knowledge-graph"]')?.click())()`);
  await waitFor(call, `(() => /Chờ tích hợp D3/.test(document.body.textContent ?? ''))()`);
  await capture(call, "knowledge-graph-awaiting-integration.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[aria-label="Mở cài đặt"]')?.click())()`);
  await waitFor(call, `(() => !!document.querySelector('.modal:not([hidden]) .modal__title'))()`);
  await capture(call, "settings.png", 1366, 768);
});
