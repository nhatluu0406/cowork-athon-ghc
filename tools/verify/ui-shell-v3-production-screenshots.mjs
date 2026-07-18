/**
 * Packaged UI Shell V3 commercial readiness screenshots.
 * Launches win-unpacked app, drives renderer via CDP, writes reports/ui-shell-v3-commercial-readiness/.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagedChildEnv } from "./packaged-launch-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const EXE = join(REPO, "dist-app", "win-unpacked", "coworkghc.exe");
const OUT_DIR = join(REPO, "reports", "ui-shell-v3-commercial-readiness");
const CDP_PORT = 19228;
const SAFE_TMP = "C:\\tmp";

function createSafeFixtureWorkspace() {
  mkdirSync(SAFE_TMP, { recursive: true });
  const root = mkdtempSync(join(SAFE_TMP, "cghc-ui-shell-v3-fixture-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs", "commercial-readiness", "very-long-folder-name-for-ellipsis"), { recursive: true });
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
  writeFileSync(
    join(root, "docs", "commercial-readiness", "very-long-folder-name-for-ellipsis", "workspace-long-path-preview.md"),
    [
      "# Workspace long path preview",
      "",
      "Safe fixture content for long path and ellipsis validation.",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "this-is-a-very-long-commercial-readiness-workspace-file-name-for-truncation-preview.md"),
    [
      "# Long visible fixture",
      "",
      "Safe fixture content for file-row truncation and workspace path preview.",
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
      const callId = id;
      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(new Error(`CDP call timed out: ${method}`));
      }, 60_000);
      pending.set(callId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(JSON.stringify({ id: callId, method, params }));
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
  console.log(`capture: ${filename} @ ${width}x${height}`);
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.bringToFront");
  await sleep(500);
  const shot = await captureCdpScreenshot(call, filename, width, height);
  writeFileSync(join(OUT_DIR, filename), Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${join(OUT_DIR, filename)}`);
}

async function captureCdpScreenshot(call, filename, width, height) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const shot = await call("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      });
      if (!shot?.data) throw new Error(`No screenshot data for ${filename}`);
      return shot;
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(`retry screenshot: ${filename} (${error instanceof Error ? error.message : String(error)})`);
      await sleep(1000);
    }
  }
  throw new Error(`No screenshot data for ${filename}`);
}

function captureWindowToPng(outputPath, width, height) {
  const scriptPath = join(SAFE_TMP, `cghc-capture-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
public class Win32Capture {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$script:targetHwnd = [IntPtr]::Zero
$callback = [EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32Capture]::IsWindowVisible($hWnd)) { return $true }
  $len = [Win32Capture]::GetWindowTextLength($hWnd)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [Win32Capture]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
  $title = $sb.ToString()
  [uint32]$procId = 0
  [Win32Capture]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($title -like '*Cowork GHC*' -or $proc.ProcessName -like '*Cowork*') {
    $script:targetHwnd = $hWnd
    return $false
  }
  return $true
}
[Win32Capture]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($script:targetHwnd -eq [IntPtr]::Zero) { throw 'Cowork GHC window not found' }
[Win32Capture]::SetWindowPos($script:targetHwnd, [IntPtr]::Zero, 40, 40, ${width}, ${height}, 0x0040) | Out-Null
[Win32Capture]::SetForegroundWindow($script:targetHwnd) | Out-Null
Start-Sleep -Milliseconds 200
$rect = New-Object RECT
[Win32Capture]::GetWindowRect($script:targetHwnd, [ref]$rect) | Out-Null
$w = [Math]::Max(1, $rect.Right - $rect.Left)
$h = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$bmp.Save(${JSON.stringify(outputPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()
`;
  writeFileSync(scriptPath, ps, "utf8");
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: "pipe" });
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {
      // temp helper already gone
    }
  }
}

async function clickSelector(call, selector) {
  await evaluate(call, `(() => document.querySelector(${JSON.stringify(selector)})?.click())()`);
}

async function hoverAt(call, x, y) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(350);
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
      const activeViews = ['cowork', 'workspace', 'knowledge', 'integration', 'settings']
        .filter((name) => visible('[data-view="' + name + '"]'));
      const surface = document.querySelector('.product-rail__item[aria-current="page"]')?.dataset.surfaceId ?? '';
      const workMode = document.querySelector('.shell-frame')?.dataset.workMode ?? '';
      const settingsOpen = activeViews[0] === 'settings';
      const sidebarVisible = visible('.contextual-sidebar');
      const inspectorVisible = visible('.inspector-shell');
      const shellRoots = document.querySelectorAll('.shell-frame').length;
      const legacyTextButton = [...document.querySelectorAll('button')]
        .some((button) => /Tiếp tục cuộc trò chuyện này/i.test(button.textContent ?? ''));
      const oldWorkspacePathCard = visible('.context-panel--cowork .workspace-context');
      const duplicateKnowledgeRail = [...document.querySelectorAll('.product-rail__item')]
        .some((button) => /Knowledge Graph/i.test(button.getAttribute('aria-label') ?? ''));
      const horizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const fauxWindowControls = document.querySelectorAll('.window-controls, .win-btn').length;
      const settingsButton = visible('.topbar__settings');
      const providerStatusButton = document.querySelector('.status-bar__provider')?.tagName === 'BUTTON';
      const tabs = [...document.querySelectorAll('.work-mode-tab')].map((tab) => tab.getBoundingClientRect().width);
      const equalTabs = tabs.length === 2 && Math.abs(tabs[0] - tabs[1]) <= 1;
      const errors = [];
      if (shellRoots !== 1) errors.push('expected exactly one shell-frame');
      // Workspace Companion intentionally keeps the Cowork conversation visible beside the
      // workspace editor, so workspace mode legitimately shows BOTH cowork and workspace views.
      // Every other mode must show exactly one active view.
      const workspaceCompanion = !settingsOpen && surface === 'cowork' && workMode === 'workspace';
      const activeSet = [...activeViews].sort().join(',');
      if (workspaceCompanion) {
        if (activeSet !== 'cowork,workspace') errors.push('workspace mode must show cowork + workspace companion views, got ' + activeViews.join(','));
      } else if (activeViews.length !== 1) {
        errors.push('expected exactly one active view, got ' + activeViews.join(','));
      }
      if (!settingsOpen && surface === 'cowork' && workMode === 'cowork' && activeViews[0] !== 'cowork') errors.push('cowork mode must show cowork view only');
      if (settingsOpen && (sidebarVisible || inspectorVisible)) errors.push('settings surface must not show sidebar or inspector');
      if (!settingsOpen && surface !== 'cowork' && sidebarVisible) errors.push('integration/knowledge surfaces must not show sidebar');
      if (!settingsOpen && surface !== 'cowork' && inspectorVisible) errors.push('integration/knowledge surfaces must not show inspector');
      if (legacyTextButton) errors.push('legacy continuation text button visible');
      if (oldWorkspacePathCard) errors.push('old workspace path card visible in Cowork sidebar');
      if (duplicateKnowledgeRail) errors.push('Knowledge Graph rail item visible');
      if (horizontalOverflow) errors.push('horizontal overflow');
      if (fauxWindowControls !== 0) errors.push('custom window controls visible in DOM');
      if (!settingsButton) errors.push('topbar settings button missing');
      if (!providerStatusButton) errors.push('status bar provider is not a button');
      if (!equalTabs && surface === 'cowork' && !settingsOpen) errors.push('work mode tabs are not equal width');
      return { label: ${JSON.stringify(label)}, surface, workMode, activeViews, settingsOpen, sidebarVisible, inspectorVisible, shellRoots, legacyTextButton, oldWorkspacePathCard, duplicateKnowledgeRail, horizontalOverflow, fauxWindowControls, settingsButton, providerStatusButton, equalTabs, passed: errors.length === 0, errors };
    })()`,
  );
  if (!result?.passed) {
    throw new Error(`Structural assertion failed for ${label}: ${(result?.errors ?? []).join("; ")}`);
  }
  return result;
}

async function captureAll(call, fixtureRoot) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of [
    "cowork-ready-1920.png",
    "cowork-ready-1366.png",
    "cowork-narrow.png",
    "cowork-inspector-open.png",
    "cowork-inspector-closed.png",
    "workspace.png",
    "workspace-long-path.png",
    "settings-provider.png",
    "settings-general.png",
    "provider-missing.png",
    "provider-untested.png",
    "rail-tooltip.png",
    "long-conversation-title.png",
    "titlebar-controls.png",
    "structural-state-check.json",
  ]) {
    try {
      unlinkSync(join(OUT_DIR, file));
    } catch {
      // No previous evidence to remove.
    }
  }
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

  structural.push(await assertStructure(call, "provider-missing"));
  await capture(call, "provider-missing.png", 1366, 768);

  await evaluate(
    call,
    `(async () => {
      const bootstrap = await window.coworkShell.getBootstrap();
      const headers = { authorization: 'Bearer ' + bootstrap.clientToken, 'content-type': 'application/json' };
      const providerId = 'custom-openai-compat';
      await fetch(bootstrap.serviceBaseUrl + '/v1/settings/providers/base-url', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ providerId, baseUrl: 'https://api.deepseek.com/v1' }),
      });
      await fetch(bootstrap.serviceBaseUrl + '/v1/settings/model/default', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ model: { providerID: providerId, modelID: 'deepseek-chat' } }),
      });
      await fetch(bootstrap.serviceBaseUrl + '/v1/settings/providers/credential', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ providerId, ref: { store: 'os', account: 'cghc-ui-r3-fake-provider-ref' } }),
      });
      const longTitle = 'Nháp thương mại với tiêu đề rất dài để kiểm tra truncation, tooltip và metadata phụ trong sidebar Cowork';
      const created = await fetch(bootstrap.serviceBaseUrl + '/v1/conversations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspacePath: ${fixtureLiteral}, title: longTitle }),
      }).then((r) => r.json());
      const conversationId = created?.data?.conversation?.id;
      if (conversationId) {
        await fetch(bootstrap.serviceBaseUrl + '/v1/conversations/' + encodeURIComponent(conversationId), {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ title: longTitle, lastActive: true }),
        });
      }
      return true;
    })()`,
  );
  await call("Page.reload", { ignoreCache: true });
  await waitFor(call, `(() => /DeepSeek/.test(document.body.textContent ?? ''))()`);
  await sleep(800);

  structural.push(await assertStructure(call, "provider-untested"));
  await capture(call, "provider-untested.png", 1366, 768);
  structural.push(await assertStructure(call, "cowork-ready-1920"));
  await capture(call, "cowork-ready-1920.png", 1920, 1080);
  await capture(call, "titlebar-controls.png", 1920, 1080);
  structural.push(await assertStructure(call, "cowork-ready-1366"));
  await capture(call, "cowork-ready-1366.png", 1366, 768);
  structural.push(await assertStructure(call, "long-conversation-title"));
  await capture(call, "long-conversation-title.png", 1366, 768);
  structural.push(await assertStructure(call, "cowork-narrow"));
  await capture(call, "cowork-narrow.png", 900, 768);

  await evaluate(call, `(() => document.querySelector('[data-surface-id="dispatch"]')?.focus())()`);
  await sleep(300);
  structural.push(await assertStructure(call, "rail-tooltip"));
  await capture(call, "rail-tooltip.png", 1366, 768);
  await evaluate(call, `(() => document.querySelector('.topbar__settings')?.focus())()`);

  await clickSelector(call, ".topbar__settings");
  await waitFor(call, `(() => {
    const el = document.querySelector('.settings-surface');
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  })()`);
  await sleep(300);
  structural.push(await assertStructure(call, "settings-provider"));
  await capture(call, "settings-provider.png", 1366, 768);
  await clickSelector(call, '[data-settings-tab="general"]');
  await sleep(250);
  structural.push(await assertStructure(call, "settings-general"));
  await capture(call, "settings-general.png", 1366, 768);
  await evaluate(call, `(() => document.querySelector('.settings-surface')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))()`);
  await sleep(300);

  await clickSelector(call, ".topbar__inspector-toggle");
  await sleep(300);
  structural.push(await assertStructure(call, "cowork-inspector-open"));
  await capture(call, "cowork-inspector-open.png", 1366, 768);
  await clickSelector(call, ".topbar__inspector-toggle");
  await sleep(300);
  structural.push(await assertStructure(call, "cowork-inspector-closed"));
  await capture(call, "cowork-inspector-closed.png", 1366, 768);

  await clickSelector(call, '[data-work-mode="workspace"]');
  await sleep(400);
  structural.push(await assertStructure(call, "workspace"));
  await capture(call, "workspace.png", 1366, 768);

  await evaluate(call, `(() => {
    const rows = [...document.querySelectorAll('.workspace-tree__row--file')];
    const safe = rows.find((row) => {
      const path = row.title ?? '';
      if (/\.env/i.test(path) || /credential|secret|\.pem|\.key/i.test(path)) return false;
      return /very-long-commercial-readiness/i.test(path) || /README\.md$/i.test(path) || /\.md$/i.test(path);
    });
    (safe ?? rows.find((row) => !/\\.env/i.test(row.title ?? '')))?.click();
  })()`);
  await waitFor(call, `(() => !!document.querySelector('.workspace-preview__body')?.textContent)`);
  await sleep(300);
  structural.push(await assertStructure(call, "workspace-long-path"));
  await capture(call, "workspace-long-path.png", 1366, 768);

  await clickSelector(call, '[data-surface-id="microsoft"]');
  await waitFor(call, `(() => {
    const el = document.querySelector('section.ms-surface');
    return !!el && !el.hidden;
  })()`);
  await sleep(400);
  structural.push(await assertMicrosoftAssistant(call, "microsoft-assistant"));
  await capture(call, "microsoft-assistant.png", 1366, 768);

  await clickSelector(call, ".ms-segmented__item:nth-of-type(2)");
  await waitFor(call, `(() => !!document.querySelector('.ms-connect__signin'))()`);
  await sleep(300);
  structural.push(await assertMicrosoftConnect(call, "microsoft-connect"));
  await capture(call, "microsoft-connect.png", 1366, 768);

  await clickSelector(call, '[data-surface-id="code"]');
  await waitFor(call, `(() => {
    const el = document.querySelector('section.cc-surface');
    return !!el && !el.hidden;
  })()`);
  await sleep(400);
  structural.push(await assertCodeSession(call, "code-session"));
  await capture(call, "code-session.png", 1366, 768);

  await clickSelector(call, ".cc-segmented__item:nth-of-type(2)");
  await waitFor(call, `(() => !!document.querySelector('.cc-onboarding'))()`);
  await sleep(300);
  structural.push(await assertCodeOnboarding(call, "code-onboarding"));
  await capture(call, "code-onboarding.png", 1366, 768);

  const gitHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  writeFileSync(join(OUT_DIR, "structural-state-check.json"), JSON.stringify({ generatedAt: new Date().toISOString(), gitHead, structural }, null, 2));
}

async function assertMicrosoftAssistant(call, label) {
  const result = await evaluate(
    call,
    `(() => {
      const errors = [];
      const surface = document.querySelector('section.ms-surface');
      if (!surface || surface.hidden) errors.push('ms-surface not visible');
      if (surface?.dataset?.view !== 'microsoft') errors.push('ms-surface dataset.view mismatch');
      const tabs = [...document.querySelectorAll('.ms-segmented__item')].map((el) => el.textContent?.trim());
      if (!tabs.includes('Trợ lý AI')) errors.push('assistant tab label missing');
      if (!tabs.includes('Kết nối')) errors.push('connect tab label missing');
      const cta = document.querySelector('.ms-assistant__connect-cta');
      if (!cta) errors.push('assistant connect CTA missing');
      return { label: ${JSON.stringify(label)}, passed: errors.length === 0, errors };
    })()`,
  );
  if (!result?.passed) throw new Error(`Structural assertion failed for ${label}: ${(result?.errors ?? []).join("; ")}`);
  return result;
}

async function assertMicrosoftConnect(call, label) {
<<<<<<< HEAD
=======
  // The connect card is wired (device-code + manual token fallback both call the real backend
  // client, per feat(ui): wire MS365 connect view to backend). With no env configured
  // (CGHC_MS365_CLIENT_ID / CGHC_MS365_TENANT unset), the device sign-in button renders enabled —
  // it only becomes disabled after being clicked and the backend reports a missing app
  // registration. We assert the button exists and is in one of those two honest states (enabled,
  // or disabled with the registration note visible) — never that a live connection occurred.
>>>>>>> 289d0e16b78787a318348a1937ff78bb81659277
  const result = await evaluate(
    call,
    `(() => {
      const errors = [];
      const signIn = document.querySelector('.ms-connect__signin');
      if (!signIn) errors.push('ms-connect__signin missing');
<<<<<<< HEAD
      else if (!signIn.disabled) errors.push('ms-connect__signin is not disabled');
      const bodyText = document.body.textContent ?? '';
      if (!bodyText.includes('Backend D2')) errors.push('page text missing "Backend D2" honesty note');
=======
      else if (signIn.disabled) {
        const note = document.querySelector('.ms-connect__note');
        const noteText = note?.textContent ?? '';
        if (note?.hidden || !noteText.trim()) errors.push('ms-connect__signin is disabled but no registration note is shown');
      }
      const manual = document.querySelector('.ms-connect__manual');
      if (!manual) errors.push('ms-connect__manual (token fallback) missing');
      else {
        if (!manual.querySelector('.ms-connect__manual-input')) errors.push('ms-connect__manual-input missing');
        if (!manual.querySelector('.ms-connect__manual-submit')) errors.push('ms-connect__manual-submit missing');
      }
      const bodyText = document.body.textContent ?? '';
      if (!bodyText.includes('Kết nối Microsoft 365')) errors.push('page text missing "Kết nối Microsoft 365" card title');
>>>>>>> 289d0e16b78787a318348a1937ff78bb81659277
      return { label: ${JSON.stringify(label)}, passed: errors.length === 0, errors };
    })()`,
  );
  if (!result?.passed) throw new Error(`Structural assertion failed for ${label}: ${(result?.errors ?? []).join("; ")}`);
  return result;
}

async function assertCodeSession(call, label) {
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
      const errors = [];
      const surface = document.querySelector('section.cc-surface');
      if (!surface || surface.hidden) errors.push('cc-surface not visible');
      if (surface?.dataset?.view !== 'code') errors.push('cc-surface dataset.view mismatch');
      if (!visible('.code-explorer')) errors.push('code-explorer not visible');
      if (!visible('.code-editor')) errors.push('code-editor not visible');
      if (!visible('.cc-panel')) errors.push('cc-panel not visible');
      const tabs = [...document.querySelectorAll('.cc-segmented__item')].map((el) => el.textContent?.trim());
      if (!tabs.includes('Phiên làm việc')) errors.push('session tab label missing');
      if (!tabs.includes('Cách hoạt động')) errors.push('how-it-works tab label missing');
      return { label: ${JSON.stringify(label)}, passed: errors.length === 0, errors };
    })()`,
  );
  if (!result?.passed) throw new Error(`Structural assertion failed for ${label}: ${(result?.errors ?? []).join("; ")}`);
  return result;
}

async function assertCodeOnboarding(call, label) {
  const result = await evaluate(
    call,
    `(() => {
      const errors = [];
      const onboarding = document.querySelector('.cc-onboarding');
      if (!onboarding) errors.push('cc-onboarding missing');
      const steps = document.querySelectorAll('.cc-onboarding__step');
      if (steps.length !== 4) errors.push('expected 4 cc-onboarding__step elements, got ' + steps.length);
      return { label: ${JSON.stringify(label)}, passed: errors.length === 0, errors };
    })()`,
  );
  if (!result?.passed) throw new Error(`Structural assertion failed for ${label}: ${(result?.errors ?? []).join("; ")}`);
  return result;
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
      execSync(`taskkill /F /IM "coworkghc.exe" /T`, { stdio: "ignore" });
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
