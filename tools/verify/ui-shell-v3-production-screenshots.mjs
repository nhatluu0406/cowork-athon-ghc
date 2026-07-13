/**
 * Packaged UI Shell V3 production screenshots.
 * Launches win-unpacked app, drives renderer via CDP, writes reports/ui-shell-v3-production-r2/.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagedChildEnv } from "./packaged-launch-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const OUT_DIR = join(REPO, "reports", "ui-shell-v3-production-r2");
const CDP_PORT = 19228;
const SAFE_TMP = "C:\\tmp";

function createSafeFixtureWorkspace() {
  mkdirSync(SAFE_TMP, { recursive: true });
  const root = mkdtempSync(join(SAFE_TMP, "cghc-ui-shell-v3-fixture-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "src", "README.md"),
    [
      "# README (safe UI fixture)",
      "",
      "Shell V3 production visual smoke.",
      "",
      "This fixture contains no credentials or private workspace data.",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "docs", "integration-readiness.md"),
    [
      "# Integration readiness",
      "",
      "Safe fixture content for packaged UI Shell V3 screenshots.",
    ].join("\n"),
  );
  return root;
}

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

async function assertStructure(call, label) {
  const result = await evaluate(
    call,
    `(() => {
      const visible = (selector) => {
        const el = document.querySelector(selector);
        if (!el || el.hidden) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const activeViews = ['cowork', 'workspace', 'knowledge', 'integration']
        .filter((name) => visible('[data-view="' + name + '"]'));
      const surface = document.querySelector('.product-rail__item[aria-current="page"]')?.dataset.surfaceId ?? '';
      const workMode = document.querySelector('.shell-frame')?.dataset.workMode ?? '';
      const sidebarVisible = visible('.contextual-sidebar');
      const inspectorVisible = visible('.inspector-shell');
      const shellRoots = document.querySelectorAll('.shell-frame').length;
      const legacyTextButton = [...document.querySelectorAll('button')]
        .some((button) => /Tiếp tục cuộc trò chuyện này/i.test(button.textContent ?? ''));
      const oldWorkspacePathCard = visible('.context-panel--cowork .workspace-context');
      const duplicateKnowledgeRail = [...document.querySelectorAll('.product-rail__item')]
        .some((button) => /Knowledge Graph/i.test(button.getAttribute('aria-label') ?? ''));
      const horizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const errors = [];
      if (shellRoots !== 1) errors.push('expected exactly one shell-frame');
      if (activeViews.length !== 1) errors.push('expected exactly one active view, got ' + activeViews.join(','));
      if (surface === 'cowork' && workMode === 'cowork' && activeViews[0] !== 'cowork') errors.push('cowork mode must show cowork view only');
      if (surface === 'cowork' && workMode === 'workspace' && activeViews[0] !== 'workspace') errors.push('workspace mode must show workspace view only');
      if (surface !== 'cowork' && sidebarVisible) errors.push('integration/knowledge surfaces must not show sidebar');
      if (surface !== 'cowork' && inspectorVisible) errors.push('integration/knowledge surfaces must not show inspector');
      if (legacyTextButton) errors.push('legacy continuation text button visible');
      if (oldWorkspacePathCard) errors.push('old workspace path card visible in Cowork sidebar');
      if (duplicateKnowledgeRail) errors.push('Knowledge Graph rail item visible');
      if (horizontalOverflow) errors.push('horizontal overflow');
      return { label: ${JSON.stringify(label)}, surface, workMode, activeViews, sidebarVisible, inspectorVisible, shellRoots, legacyTextButton, oldWorkspacePathCard, duplicateKnowledgeRail, horizontalOverflow, passed: errors.length === 0, errors };
    })()`,
  );
  if (!result?.passed) {
    throw new Error(`Structural assertion failed for ${label}: ${(result?.errors ?? []).join("; ")}`);
  }
  return result;
}

async function captureAll(call, fixtureRoot) {
  mkdirSync(OUT_DIR, { recursive: true });
  const structural = [];
  const fixtureLiteral = JSON.stringify(fixtureRoot);
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
        body: JSON.stringify({ rootPath: ${fixtureLiteral} }),
      });
      await fetch(bootstrap.serviceBaseUrl + '/v1/settings/active-workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ rootPath: ${fixtureLiteral} }),
      });
      return true;
    })()`,
  );
  await call("Page.reload", { ignoreCache: true });
  await waitFor(call, `(() => !!document.querySelector('.shell-frame'))()`);
  await sleep(800);

  structural.push(await assertStructure(call, "cowork-1920"));
  await capture(call, "cowork-1920.png", 1920, 1080);
  structural.push(await assertStructure(call, "cowork-1366"));
  await capture(call, "cowork-1366.png", 1366, 768);
  structural.push(await assertStructure(call, "cowork-900"));
  await capture(call, "cowork-900.png", 900, 768);

  await evaluate(call, `(() => document.querySelector('.topbar__inspector-toggle')?.click())()`);
  await sleep(300);
  structural.push(await assertStructure(call, "cowork-inspector"));
  await capture(call, "cowork-inspector.png", 1366, 768);
  await evaluate(call, `(() => document.querySelector('.topbar__inspector-toggle')?.click())()`);
  await sleep(300);

  await evaluate(call, `(() => document.querySelector('[data-work-mode="workspace"]')?.click())()`);
  await sleep(400);
  structural.push(await assertStructure(call, "workspace-empty"));
  await capture(call, "workspace-empty.png", 1366, 768);

  await evaluate(call, `(() => {
    const srcFolder = [...document.querySelectorAll('.workspace-tree__row--folder')]
      .find((row) => /(^|[\\\\/])src$/i.test(row.title ?? '') || /src/i.test(row.textContent ?? ''));
    srcFolder?.click();
  })()`);
  await sleep(400);
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
  structural.push(await assertStructure(call, "workspace-file"));
  await capture(call, "workspace-file.png", 1366, 768);
  structural.push(await assertStructure(call, "workspace-900"));
  await capture(call, "workspace-900.png", 900, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="knowledge"]')?.click())()`);
  await waitFor(call, `(() => document.querySelector('.shell-frame')?.classList.contains('shell-frame--no-sidebar'))()`);
  structural.push(await assertStructure(call, "knowledge-base"));
  await capture(call, "knowledge-base.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-knowledge-tab="graph"]')?.click())()`);
  await sleep(300);
  structural.push(await assertStructure(call, "knowledge-graph"));
  await capture(call, "knowledge-graph.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="gateway"]')?.click())()`);
  await waitFor(call, `(() => /Gateway/.test(document.body.textContent ?? ''))()`);
  structural.push(await assertStructure(call, "gateway"));
  await capture(call, "gateway.png", 1366, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="cowork"]')?.click())()`);
  await sleep(300);
  structural.push(await assertStructure(call, "provider-missing"));
  await capture(call, "provider-missing.png", 1366, 768);
  await evaluate(call, `(() => document.querySelector('.topbar__inspector-toggle')?.click())()`);
  await sleep(400);
  structural.push(await assertStructure(call, "permission"));
  await capture(call, "permission.png", 1366, 768);
  writeFileSync(join(OUT_DIR, "structural-state-check.json"), JSON.stringify({ generatedAt: new Date().toISOString(), structural }, null, 2));
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}. Run scripts\\build.bat first.`);
  mkdirSync(SAFE_TMP, { recursive: true });
  const profileDir = mkdtempSync(join(SAFE_TMP, "cghc-ui-shell-v3-profile-"));
  const fixtureRoot = createSafeFixtureWorkspace();

  const proc = spawn(EXE, [`--user-data-dir=${profileDir}`], {
    env: packagedChildEnv({
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      COWORK_GHC_E2E_WORKSPACE_ROOT: fixtureRoot,
    }),
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await sleep(4000);
    await withCdp((call) => captureAll(call, fixtureRoot));
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
