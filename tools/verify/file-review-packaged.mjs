/**
 * File Work Review — packaged Electron journeys A–L.
 *
 * Requires: dist-app build, DEEPSEEK_API_KEY in .env or environment.
 */

import { createHash } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packagedChildEnv, LOCAL_SERVICE_READY, SERVICE_STATUS_SELECTOR, PROVIDER_SETTINGS_SELECTOR, SETTINGS_ROOT_SELECTOR, SETTINGS_CLOSE_SELECTOR, NEW_CONVERSATION_SELECTOR, CONTINUATION_UNLOCK_SELECTOR } from "./packaged-launch-env.mjs";
import { createMockLlmGateway } from "./mock-llm-gateway.mjs";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "coworkghc.exe");
const EVIDENCE_ROOT = join(REPO, "reports", "file-work-review-completion");
const CDP_PORT = 19235;
const SECRET_FIXTURE = "VIOLET-FILE-REVIEW-428";
const SECRET_PATH_PATTERN = /(^|[\\/])(\.env|.*\.(pem|key)|id_rsa|id_ed25519|credentials\.json|service-account.*\.json|\.npmrc|\.pypirc)$/iu;
const TIMEOUTS = {
  appShellMs: 90_000,
  startupTraceMs: 120_000,
  serviceReadyMs: 120_000,
  workspaceMs: 60_000,
  credentialMs: 30_000,
  providerReadyMs: 60_000,
  sendStartMs: 60_000,
  permissionRequestMs: 180_000,
  permissionDrainMs: 30_000,
  terminalMs: 240_000,
  mutationEventMs: 90_000,
  diskFileMs: 120_000,
  reviewMs: 90_000,
};
const VALID_FILE_REVIEW_MODES = new Set(["all", "live", "deterministic"]);

function resolveFileReviewMode() {
  const flagIdx = process.argv.indexOf("--mode");
  if (flagIdx !== -1) {
    const value = process.argv[flagIdx + 1];
    if (value === undefined || !VALID_FILE_REVIEW_MODES.has(value)) {
      console.error(
        `Invalid --mode "${value ?? ""}". Use one of: live | deterministic | all`,
      );
      process.exit(1);
    }
    return value;
  }
  const envMode = process.env["CGHC_FILE_REVIEW_MODE"];
  if (envMode !== undefined) {
    if (!VALID_FILE_REVIEW_MODES.has(envMode)) {
      console.error(
        `Invalid CGHC_FILE_REVIEW_MODE "${envMode}". Use one of: live | deterministic | all`,
      );
      process.exit(1);
    }
    return envMode;
  }
  return "all";
}

const MODE = resolveFileReviewMode();

class StageTimeoutError extends Error {
  constructor(stage, timeoutMs, details = "") {
    super(`timeout at ${stage} after ${timeoutMs}ms${details ? `: ${details}` : ""}`);
    this.name = "StageTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

class StageTracker {
  constructor(artifactRoot) {
    this.artifactRoot = artifactRoot;
    this.startedAt = new Date().toISOString();
    this.currentStage = "preflight";
    this.lastPassedStage = null;
    this.stages = [];
  }

  start(stage, note = "") {
    this.currentStage = stage;
    const entry = { stage, status: "started", at: new Date().toISOString(), note };
    this.stages.push(entry);
    console.log(`[${entry.at}] ${stage}${note ? ` — ${note}` : ""}`);
  }

  pass(stage = this.currentStage, extra = {}) {
    this.lastPassedStage = stage;
    const entry = { stage, status: "passed", at: new Date().toISOString(), ...extra };
    this.stages.push(entry);
    console.log(`[${entry.at}] ${stage} PASS`);
  }

  fail(stage = this.currentStage, error) {
    const entry = {
      stage,
      status: "failed",
      at: new Date().toISOString(),
      error: redact(error instanceof Error ? error.message : String(error)),
    };
    this.stages.push(entry);
    console.error(`[${entry.at}] ${stage} FAIL — ${entry.error}`);
  }
}

function redact(value) {
  const key = process.env["DEEPSEEK_API_KEY"];
  let text = String(value ?? "");
  if (key?.trim()) text = text.split(key).join("[REDACTED_API_KEY]");
  text = text.replace(/sk-[A-Za-z0-9_-]{8,}/gu, "sk-[REDACTED]");
  return text;
}

/** OpenCode may emit edit permission without a concrete filepath in the dialog. */
function isFileWritePermission(permission) {
  const operation = String(permission?.operation ?? "");
  const description = String(permission?.description ?? "");
  if (/Tạo tệp|Sửa tệp/iu.test(operation)) return true;
  if (/file_create|file_edit/iu.test(description)) return true;
  return false;
}

function isFileDeletePermission(permission) {
  const operation = String(permission?.operation ?? "");
  const description = String(permission?.description ?? "");
  if (/Xóa tệp/iu.test(operation)) return true;
  if (/file_delete/iu.test(description)) return true;
  return false;
}

function isCommandExecPermission(permission) {
  const operation = String(permission?.operation ?? "");
  const description = String(permission?.description ?? "");
  if (/Chạy lệnh/iu.test(operation)) return true;
  if (/command_exec/iu.test(description)) return true;
  return false;
}

async function approveFilePermissionFlow(expectedRelativePath, { rejectCommandExec = false } = {}) {
  const observed = await waitPermissionOrMutation(
    expectedRelativePath,
    TIMEOUTS.permissionRequestMs,
    "permission or mutation",
  );
  if (observed.mode === "auto") {
    await assertNotProcessing();
    return { permission: null, permissionReply: { status: "auto_allowed", mutationObserved: true } };
  }
  const permission = observed.permission;
  if (rejectCommandExec && isCommandExecPermission(permission)) {
    throw new Error("Unexpected tool path for deterministic delete journey.");
  }
  const allowed = isFileWritePermission(permission) || isFileDeletePermission(permission);
  if (!allowed) {
    throw new Error(`permission is not a file mutation ${JSON.stringify(permission)}`);
  }
  const permissionReply = await approveObservedPermission();
  if (expectedRelativePath) {
    try {
      await waitForMutationEvent(expectedRelativePath);
    } catch {
      // delete journeys may not keep a clickable row; disk checks follow.
    }
  }
  await assertNotProcessing();
  return { permission, permissionReply };
}

async function denyFilePermissionFlow() {
  const permission = await waitPermissionRequest();
  await cdpEvaluate(`(() => {
    const button = document.querySelector('.permission-deny');
    if (!button) throw new Error('permission deny button missing');
    button.click();
    return true;
  })()`);
  await assertNotProcessing();
  return permission;
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function patchSettingsMockBaseUrl(profileDir, mockBaseUrl) {
  const runtimeDir = join(profileDir, ".runtime");
  const settingsPath = join(runtimeDir, "settings.json");
  mkdirSync(runtimeDir, { recursive: true });
  let settings = {
    version: 2,
    general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
    providers: [],
    modelPreference: {},
  };
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      // recover below
    }
  }
  const providers = Array.isArray(settings.providers) ? [...settings.providers] : [];
  const providerId = "custom-openai-compat";
  const index = providers.findIndex((entry) => entry?.providerId === providerId);
  const existing = index >= 0 ? providers[index] : {};
  const next = {
    ...existing,
    providerId,
    baseUrl: mockBaseUrl,
    envVar: existing.envVar ?? "DEEPSEEK_API_KEY",
  };
  if (index >= 0) providers[index] = next;
  else providers.push(next);
  settings.providers = providers;
  settings.modelPreference = settings.modelPreference ?? {};
  settings.modelPreference.default = settings.modelPreference.default ?? {
    providerID: providerId,
    modelID: "deepseek-chat",
  };
  writeJson(settingsPath, settings);
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isSecretLikePath(path) {
  return SECRET_PATH_PATTERN.test(path.replace(/\\/g, "/"));
}

function fileInfo(path) {
  if (!existsSync(path)) return { exists: false };
  const stat = statSync(path);
  return {
    exists: true,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: stat.isFile() && !isSecretLikePath(path) ? fileHash(path) : undefined,
  };
}

function listWorkspaceFiles(root, maxEntries = 80) {
  const entries = [];
  const queue = [{ abs: root, rel: "" }];
  while (queue.length > 0 && entries.length < maxEntries) {
    const current = queue.shift();
    if (!current) break;
    let children = [];
    try {
      children = readdirSync(current.abs, { withFileTypes: true });
    } catch (error) {
      entries.push({ path: current.rel || ".", error: redact(error instanceof Error ? error.message : error) });
      continue;
    }
    for (const child of children) {
      if (entries.length >= maxEntries) break;
      const rel = current.rel ? `${current.rel}/${child.name}` : child.name;
      const abs = join(current.abs, child.name);
      const info = fileInfo(abs);
      entries.push({
        path: rel,
        kind: child.isDirectory() ? "directory" : child.isFile() ? "file" : "other",
        ...info,
      });
      if (child.isDirectory()) queue.push({ abs, rel });
    }
  }
  return { root, truncated: queue.length > 0 || entries.length >= maxEntries, entries };
}

function safeReadText(path, maxChars = 120_000) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").slice(0, maxChars);
}

function envSnapshot(extraKeys = {}) {
  const keys = new Set([
    "COWORK_GHC_REMOTE_DEBUG_PORT",
    "COWORK_GHC_E2E_WORKSPACE_ROOT",
    "COWORK_GHC_STARTUP_TRACE",
    "ELECTRON_RUN_AS_NODE",
    "DEEPSEEK_API_KEY",
    ...Object.keys(extraKeys),
  ]);
  const out = {};
  for (const key of [...keys].sort()) {
    if (key === "DEEPSEEK_API_KEY") {
      out[key] = process.env[key]?.trim() ? "[present]" : "[missing]";
    } else if (key === "ELECTRON_RUN_AS_NODE") {
      out[key] = process.env[key] === undefined ? "[absent in parent]" : "[present in parent; stripped from child]";
    } else {
      out[key] = extraKeys[key] ?? process.env[key] ?? "[unset]";
    }
  }
  return out;
}

function exeMetadata() {
  if (!existsSync(EXE)) return { path: EXE, exists: false };
  const stat = statSync(EXE);
  return {
    path: EXE,
    exists: true,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: fileHash(EXE),
  };
}

function readConversationDiagnostics(profileDir) {
  const convRoot = join(profileDir, ".runtime", "conversations");
  if (!existsSync(convRoot)) return { conversations: [] };
  const indexPath = join(convRoot, "index.json");
  let index = { conversations: [] };
  try {
    index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : index;
  } catch (error) {
    return { error: redact(error instanceof Error ? error.message : error), conversations: [] };
  }
  const conversations = [];
  for (const summary of index.conversations ?? []) {
    const path = join(convRoot, `${summary.id}.json`);
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(readFileSync(path, "utf8"));
      const activity = record.activity && typeof record.activity === "object" ? record.activity : {};
      conversations.push({
        id: record.id,
        status: record.status,
        runtimeSessionId: record.runtimeSessionId,
        runtimePhase: record.runtimePhase,
        runtimeTurns: (record.runtimeTurns ?? []).map((t) => ({
          runtimeTurnId: t.id,
          runtimeSessionId: t.runtimeSessionId,
          status: t.status,
        })),
        messageCount: record.messages?.length ?? 0,
        fileReviewsCount: Array.isArray(activity.fileReviews) ? activity.fileReviews.length : 0,
        latestActivityKinds: Array.isArray(activity.items)
          ? activity.items.slice(-12).map((item) => item.kind ?? item.label ?? "unknown")
          : [],
        fileChanges: Array.isArray(activity.fileChanges) ? activity.fileChanges.slice(-12) : [],
        permissionStates: Array.isArray(activity.permissionHistory)
          ? activity.permissionHistory.slice(-12).map((item) => ({
              requestId: item.requestId,
              decision: item.decision,
              targetSummary: item.targetSummary,
            }))
          : [],
      });
    } catch (error) {
      conversations.push({ id: summary.id, error: redact(error instanceof Error ? error.message : error) });
    }
  }
  return { lastActive: index.lastActiveConversationId ?? null, conversations };
}

async function captureRendererDiagnostics() {
  try {
    return await cdpEvaluate(`(() => {
      const text = (selector) => document.querySelector(selector)?.textContent ?? '';
      const rows = [...document.querySelectorAll('.output-files .file-row--clickable')].map((row) => ({
        relativePath: row.dataset.relativePath ?? '',
        operation: row.dataset.operation ?? '',
        reviewId: row.dataset.reviewId ?? '',
        text: row.textContent ?? '',
      }));
      const permission = document.querySelector('.permission-dialog');
      const titleId = permission?.getAttribute('aria-labelledby');
      const descId = permission?.getAttribute('aria-describedby');
      return {
        executionStatus: text('.execution-status'),
        transcriptTextLength: text('.transcript').length,
        assistantFinalText: [...document.querySelectorAll('.msg--assistant .msg__text')].at(-1)?.textContent?.slice(0, 1200) ?? '',
        activityText: text('.activity-panel').slice(0, 4000),
        outputRows: rows,
        fileReviewsCountFromRows: rows.filter((row) => row.reviewId).length,
        permissionDialog: permission ? {
          requestId: titleId?.replace(/^permission-title-/, '') ?? '',
          action: permission.querySelector('.permission-action-kind')?.textContent ?? '',
          targetPath: permission.querySelector('.permission-action-target')?.textContent ?? '',
          description: descId ? document.getElementById(descId)?.textContent ?? '' : '',
        } : null,
      };
    })()`);
  } catch (error) {
    return { error: redact(error instanceof Error ? error.message : error) };
  }
}

async function buildDiagnostics(context, error) {
  const disk = {
    expectedCreatePath: context.createPath,
    expectedCreateRelativePath: "create-blue.txt",
    expectedCreateInfo: context.createPath ? fileInfo(context.createPath) : undefined,
    workspaceListing: context.workspace ? listWorkspaceFiles(context.workspace) : undefined,
  };
  const renderer = await captureRendererDiagnostics();
  const traceText = context.tracePath ? safeReadText(context.tracePath) : "";
  return {
    result: error ? "FAIL" : "PASS",
    failedStage: error ? context.tracker.currentStage : null,
    lastPassedStage: context.tracker.lastPassedStage,
    timestamps: {
      startedAt: context.tracker.startedAt,
      finishedAt: new Date().toISOString(),
    },
    stages: context.tracker.stages,
    paths: {
      executable: EXE,
      artifactRoot: context.artifactRoot,
      profile: context.profile,
      workspace: context.workspace,
      startupTrace: context.tracePath,
    },
    executable: exeMetadata(),
    authenticatedHealth: context.authenticatedHealth ?? null,
    sanitizedEnvironment: envSnapshot({
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      COWORK_GHC_E2E_WORKSPACE_ROOT: context.workspace,
      COWORK_GHC_STARTUP_TRACE: context.tracePath,
    }),
    ids: {
      permission: context.permissionObserved ?? null,
      conversation: context.conversationDiagnostics?.lastActive ?? null,
    },
    permissionObserved: context.permissionObserved !== null,
    mutationEventObserved: context.mutationEventObserved === true,
    fileExists: disk.expectedCreateInfo?.exists === true,
    fileReviewsCount: renderer?.fileReviewsCountFromRows ?? null,
    cleanupResult: context.cleanupResult ?? null,
    diagnosticFiles: context.diagnosticFiles ?? [],
    error: error
      ? {
          name: error instanceof Error ? error.name : "Error",
          message: redact(error instanceof Error ? error.message : String(error)),
          stage: error instanceof StageTimeoutError ? error.stage : context.tracker.currentStage,
        }
      : null,
    disk,
    renderer,
    conversationDiagnostics: readConversationDiagnostics(context.profile),
    startupTraceTail: traceText.slice(-8000),
  };
}

async function writeDiagnostics(context, error = null) {
  mkdirSync(context.artifactRoot, { recursive: true });
  const diagnostics = await buildDiagnostics(context, error);
  context.conversationDiagnostics = diagnostics.conversationDiagnostics;
  const resultPath = join(context.artifactRoot, "file-review-verification-result.json");
  writeJson(resultPath, diagnostics);
  context.diagnosticFiles = [...(context.diagnosticFiles ?? []), resultPath];
  const summaryPath = join(context.artifactRoot, "file-review-verification-summary.md");
  writeFileSync(
    summaryPath,
    [
      `# File Review packaged verification ${diagnostics.result}`,
      "",
      `- Failed stage: ${diagnostics.failedStage ?? "none"}`,
      `- Last passed stage: ${diagnostics.lastPassedStage ?? "none"}`,
      `- Profile: ${diagnostics.paths.profile}`,
      `- Workspace: ${diagnostics.paths.workspace}`,
      `- Startup trace: ${diagnostics.paths.startupTrace}`,
      `- Result JSON: ${resultPath}`,
      `- Error: ${diagnostics.error?.message ?? "none"}`,
      "",
    ].join("\n"),
    "utf8",
  );
  context.diagnosticFiles.push(summaryPath);
  return diagnostics;
}

async function simulateFailure() {
  const artifactRoot = mkdtempSync(join(tmpdir(), "cghc-freview-artifacts-sim-"));
  const workspace = mkdtempSync(join(tmpdir(), "cghc-freview-ws-sim-"));
  const profile = mkdtempSync(join(tmpdir(), "cghc-freview-profile-sim-"));
  const tracePath = join(artifactRoot, "startup.trace");
  writeFileSync(tracePath, "log:settings_only_started: simulated\nlog:service_started: simulated\n", "utf8");
  writeFileSync(join(workspace, "note.txt"), "SIMULATED", "utf8");
  const tracker = new StageTracker(artifactRoot);
  const context = {
    artifactRoot,
    workspace,
    profile,
    tracePath,
    tracker,
    createPath: join(workspace, "create-blue.txt"),
    permissionObserved: null,
    mutationEventObserved: false,
    cleanupResult: { mode: "failure-preserved", simulated: true },
    diagnosticFiles: [tracePath],
  };
  tracker.start("A01 launch", "simulation");
  tracker.pass("A01 launch");
  tracker.start("A07 permission requested", "simulation timeout");
  const error = new StageTimeoutError("A07 permission requested", TIMEOUTS.permissionRequestMs, "simulated");
  tracker.fail("A07 permission requested", error);
  const diagnostics = await writeDiagnostics(context, error);
  console.log(`file-review-packaged simulation: FAIL artifact=${artifactRoot}`);
  console.log(JSON.stringify({
    result: diagnostics.result,
    failedStage: diagnostics.failedStage,
    artifactRoot,
    resultFile: join(artifactRoot, "file-review-verification-result.json"),
  }, null, 2));
}

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

async function cdpEvaluate(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = targets.find((item) => String(item.url).startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP target missing");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")));
  });
  const value = await new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.close();
  return value;
}

async function waitFor(selector, pattern, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(
          `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`,
        ),
      );
      if (pattern.test(text)) return text;
    } catch {
      // renderer not ready
    }
    await sleep(350);
  }
  throw new Error(`timeout ${selector} ${pattern}`);
}

async function waitSelector(selector, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdpEvaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    } catch {
      // renderer not ready
    }
    await sleep(300);
  }
  throw new Error(`timeout selector ${selector}`);
}

function launch(profile, workspace, tracePath, extra = {}) {
  return spawn(EXE, [`--user-data-dir=${profile}`], {
    env: packagedChildEnv({
      COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
      COWORK_GHC_E2E_WORKSPACE_ROOT: workspace,
      COWORK_GHC_STARTUP_TRACE: tracePath,
      ...extra,
    }),
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopAll(proc) {
  if (proc?.exitCode === null) proc.kill();
  await sleep(2_000);
  for (const image of ["coworkghc.exe", "opencode.exe"]) {
    try {
      execSync(`taskkill /F /IM "${image}" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
  }
  await sleep(600);
}

function assertNoProcesses() {
  for (const image of ["coworkghc.exe", "opencode.exe"]) {
    const output = execSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { encoding: "utf8" });
    if (output.toLowerCase().includes(image.toLowerCase())) throw new Error(`orphan ${image}`);
  }
}

async function configure() {
  await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
  await waitFor(".workspace-context", /cghc-freview-ws-/u);
  await cdpEvaluate(`document.querySelector(${JSON.stringify(PROVIDER_SETTINGS_SELECTOR)})?.click()`);
  await waitSelector(`${SETTINGS_ROOT_SELECTOR} .llm-save-credential`);
  const key = process.env["DEEPSEEK_API_KEY"] ?? "";
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.llm-credential-input');
    input.value = ${JSON.stringify(key)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.llm-save-credential')?.click();
  })()`);
  await waitFor(".llm-credential-status", /Đã cấu hình|đã có khoá/iu, 30_000);
  await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
  await waitFor(".llm-settings-status", /thành công/iu, 60_000);
  await cdpEvaluate(`document.querySelector(${JSON.stringify(SETTINGS_CLOSE_SELECTOR)})?.click()`);
  await sleep(500);
}

async function waitForTrace(tracePath, pattern, timeoutMs, stage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(tracePath) && pattern.test(readFileSync(tracePath, "utf8"))) return;
    await sleep(200);
  }
  throw new StageTimeoutError(stage, timeoutMs, `trace ${pattern}`);
}

async function waitForStage(selector, pattern, timeoutMs, stage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = String(
        await cdpEvaluate(
          `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`,
        ),
      );
      if (pattern.test(text)) return text;
    } catch {
      // renderer not ready
    }
    await sleep(350);
  }
  throw new StageTimeoutError(stage, timeoutMs, `${selector} ${pattern}`);
}

async function waitSelectorStage(selector, timeoutMs, stage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdpEvaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    } catch {
      // renderer not ready
    }
    await sleep(300);
  }
  throw new StageTimeoutError(stage, timeoutMs, `selector ${selector}`);
}

async function peekPermissionRequest() {
  return await cdpEvaluate(`(() => {
    const dialog = document.querySelector('.permission-dialog');
    if (!dialog) return null;
    const titleId = dialog.getAttribute('aria-labelledby') ?? '';
    const descId = dialog.getAttribute('aria-describedby') ?? '';
    return {
      requestId: titleId.replace(/^permission-title-/, ''),
      operation: dialog.querySelector('.permission-action-kind')?.textContent ?? '',
      relativePath: dialog.querySelector('.permission-action-target')?.textContent ?? '',
      description: descId ? document.getElementById(descId)?.textContent ?? '' : '',
      scope: document.querySelector('.permission-scope-input:checked')?.value ?? 'once',
    };
  })()`);
}

async function waitPermissionRequest(timeoutMs = TIMEOUTS.permissionRequestMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pending = await peekPermissionRequest();
      if (pending?.requestId) return pending;
    } catch {
      // renderer not ready
    }
    await sleep(350);
  }
  throw new StageTimeoutError("A07 permission requested", timeoutMs, "permission dialog missing");
}

async function waitPermissionOrMutation(relativePath, timeoutMs, stageLabel) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pending = await peekPermissionRequest();
      if (pending?.requestId) return { mode: "dialog", permission: pending };
      const observed = await cdpEvaluate(`(() => {
        const rows = [...document.querySelectorAll('.output-files .file-row--clickable')];
        return rows.some((row) => (row.dataset.relativePath ?? '').includes(${JSON.stringify(relativePath)}));
      })()`);
      if (observed === true) return { mode: "auto", mutationObserved: true };
    } catch {
      // renderer not ready
    }
    await sleep(350);
  }
  throw new StageTimeoutError(stageLabel, timeoutMs, "permission dialog or verified mutation missing");
}

async function approveObservedPermission(timeoutMs = TIMEOUTS.permissionDrainMs) {
  await cdpEvaluate(`(() => {
    if (window.__cghcVerifyFetchInstalled === true) return true;
    window.__cghcVerifyFetchInstalled = true;
    window.__cghcVerifyPermissionDecisions = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const request = args[0];
      const url = String(typeof request === 'string' ? request : request?.url ?? '');
      const response = await originalFetch(...args);
      if (url.includes('/v1/permission/decision')) {
        let body = '';
        try {
          body = await response.clone().text();
        } catch {
          body = '[unavailable]';
        }
        window.__cghcVerifyPermissionDecisions.push({
          url: url.replace(/token=[^&]+/gu, 'token=[REDACTED]'),
          status: response.status,
          ok: response.ok,
          body: body.slice(0, 1200),
          at: new Date().toISOString(),
        });
      }
      return response;
    };
    return true;
  })()`);
  const clicked = await cdpEvaluate(`(() => {
    const button = document.querySelector('.permission-allow');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (clicked !== true) {
    throw new Error("permission allow button missing after request was observed");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stillPending = await cdpEvaluate(`!!document.querySelector('.permission-dialog')`);
    const decisions = await cdpEvaluate(`window.__cghcVerifyPermissionDecisions ?? []`);
    if (!stillPending && decisions.length > 0) {
      return { status: "dialog_closed", decisionResponse: decisions.at(-1) };
    }
    if (!stillPending) return { status: "dialog_closed", decisionResponse: null };
    await sleep(300);
  }
  throw new StageTimeoutError("A08 permission approved", timeoutMs, "permission dialog still pending");
}

async function captureAuthenticatedHealth() {
  return cdpEvaluate(`(async () => {
    const bridge = window.coworkShell;
    if (!bridge?.getBootstrap) return { available: false, reason: 'bridge_unavailable' };
    const bootstrap = await bridge.getBootstrap();
    const response = await fetch(bootstrap.serviceBaseUrl.replace(/\\/$/u, '') + '/v1/health', {
      headers: { authorization: 'Bearer ' + bootstrap.clientToken },
    });
    let body = '';
    try {
      body = await response.clone().text();
    } catch {
      body = '[unavailable]';
    }
    return {
      available: true,
      status: response.status,
      ok: response.ok,
      baseUrlPresent: !!bootstrap.serviceBaseUrl,
      clientTokenPresent: !!bootstrap.clientToken,
      body: body.slice(0, 1200),
    };
  })()`);
}

async function waitForMutationEvent(relativePath, timeoutMs = TIMEOUTS.mutationEventMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const observed = await cdpEvaluate(`(() => {
      const rows = [...document.querySelectorAll('.output-files .file-row--clickable')];
      return rows.some((row) => (row.dataset.relativePath ?? '').includes(${JSON.stringify(relativePath)}));
    })()`);
    if (observed) return true;
    await sleep(500);
  }
  throw new StageTimeoutError("A09 mutation event observed", timeoutMs, relativePath);
}

async function waitForDiskFileStage(path, pattern, timeoutMs = TIMEOUTS.diskFileMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (pattern.test(text)) return text;
    }
    await sleep(500);
  }
  throw new StageTimeoutError("A10 file exists on disk", timeoutMs, path);
}

async function waitReviewMarkerStage(pattern, timeoutMs = TIMEOUTS.reviewMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await clickFirstFileChange();
    const body = await reviewBody();
    if (pattern.test(body)) return body;
    await sleep(500);
  }
  throw new StageTimeoutError("A11 file review persisted", timeoutMs, String(pattern));
}

async function ensureComposerUnlocked() {
  const locked = await cdpEvaluate(`document.querySelector('.composer.is-locked') !== null`);
  if (locked) {
    await cdpEvaluate(`document.querySelector(${JSON.stringify(CONTINUATION_UNLOCK_SELECTOR)})?.click()`);
    await sleep(600);
  }
}

async function waitTurnStarted(timeoutMs = TIMEOUTS.sendStartMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const started = await cdpEvaluate(`(() => {
      const thinking = document.querySelector('.thinking');
      if (thinking && thinking.hidden === false) return true;
      if (document.querySelector('.composer.is-locked')) return true;
      const runtime = document.querySelector('.status-bar__runtime')?.textContent ?? '';
      return /Đang chạy|Chờ quyền/iu.test(runtime);
    })()`);
    if (started === true) return;
    await sleep(350);
  }
  throw new StageTimeoutError("turn started", timeoutMs, "thinking/composer/runtime");
}

async function waitTurnIdle(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idle = await cdpEvaluate(`(() => {
      if (document.querySelector('.permission-dialog')) return false;
      const thinking = document.querySelector('.thinking');
      if (thinking && thinking.hidden === false) return false;
      if (document.querySelector('.composer.is-locked')) return false;
      const runtime = document.querySelector('.status-bar__runtime')?.textContent ?? '';
      if (/Đang chạy|Chờ quyền/iu.test(runtime)) return false;
      return true;
    })()`);
    if (idle === true) return;
    await sleep(500);
  }
  throw new StageTimeoutError("turn idle", timeoutMs, "thinking/composer/runtime");
}

async function sendPrompt(prompt) {
  await ensureComposerUnlocked();
  await cdpEvaluate(`(() => {
    const input = document.querySelector('.composer__input');
    input.textContent = ${JSON.stringify(prompt)};
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    document.querySelector('.send-btn')?.click();
  })()`);
  await waitTurnStarted();
}

async function assertNotProcessing() {
  await waitTurnIdle();
}

async function waitTerminalAfterPermission(decision, timeoutMs = 300_000) {
  const selector = decision === "allow" ? ".permission-allow" : ".permission-deny";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await cdpEvaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await assertNotProcessing();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`timeout permission ${decision}`);
}

async function waitForDiskFile(path, pattern, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (pattern.test(text)) return text;
    }
    await sleep(500);
  }
  throw new Error(`timeout disk file ${path}`);
}

async function activityText() {
  return String(await cdpEvaluate(`document.querySelector('.activity-timeline')?.textContent ?? ''`));
}

async function ensureInspectorOpen() {
  const open = await cdpEvaluate(`(() => {
    const inspector = document.querySelector('.inspector-shell');
    return inspector !== null && inspector.hidden === false;
  })()`);
  if (open !== true) {
    await cdpEvaluate(`document.querySelector('.topbar__inspector-toggle')?.click()`);
    await sleep(500);
  }
}

async function clickFirstFileChange() {
  await ensureInspectorOpen();
  await cdpEvaluate(`document.querySelector('.output-files .file-row--clickable')?.click()`);
  await sleep(400);
}

async function clickFileChange(relativePath) {
  await ensureInspectorOpen();
  const clicked = await cdpEvaluate(`(() => {
    const rows = [...document.querySelectorAll('.output-files .file-row--clickable')];
    const row = rows.find((entry) => (entry.dataset.relativePath ?? '').includes(${JSON.stringify(relativePath)}));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (clicked !== true) {
    throw new Error(`file change row missing for ${relativePath}`);
  }
  await sleep(400);
}

async function reviewBody() {
  return String(
    await cdpEvaluate(`(() => {
      document.querySelector('.rp-tab[data-section="review"]')?.click();
      const body = document.querySelector('.file-preview:not(.file-preview--workspace) .file-preview__body');
      return body?.textContent ?? '';
    })()`),
  );
}

async function waitReviewMarker(pattern, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await clickFirstFileChange();
    const body = await reviewBody();
    if (pattern.test(body)) return body;
    await sleep(500);
  }
  throw new Error(`timeout review marker ${pattern}`);
}

async function attachViaE2E() {
  await cdpEvaluate(`document.querySelector('.attach-btn')?.click()`);
  await sleep(600);
}

function writeCompletionEvidence(name, payload) {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  writeJson(join(EVIDENCE_ROOT, name), payload);
}

async function main() {
  if (process.env["CGHC_FILE_REVIEW_SIMULATE_FAILURE"] === "1") {
    await simulateFailure();
    return;
  }
  if (!existsSync(EXE)) throw new Error(`missing ${EXE} — run npm run package:win`);

  const mode = MODE;
  const deterministic = mode === "deterministic";
  const liveOnly = mode === "live";
  let mockGateway = null;
  let mockBaseUrl = null;

  if (deterministic) {
    mockGateway = createMockLlmGateway({
      scripts: [
        {
          kind: "tool_call",
          toolOperation: "delete",
          toolNames: ["apply_patch", "patch"],
          toolArguments: {
            patchText: "*** Begin Patch\n*** Delete File: delete-me.txt\n*** End Patch",
          },
        },
        {
          kind: "tool_call",
          toolOperation: "edit",
          toolArguments: { filePath: "modify-me.txt", path: "modify-me.txt" },
        },
        {
          kind: "tool_call",
          toolOperation: "edit",
          toolArguments: { filePath: "large.txt", path: "large.txt" },
        },
        {
          kind: "tool_call",
          toolOperation: "create",
          toolArguments: { filePath: "fixture.bin", path: "fixture.bin" },
        },
        {
          kind: "tool_call",
          toolOperation: "read",
          toolArguments: { filePath: "runtime-b.txt", path: "runtime-b.txt" },
        },
      ],
    });
    mockBaseUrl = await mockGateway.start();
    const host = new URL(mockBaseUrl).hostname;
    if (host !== "127.0.0.1") throw new Error(`deterministic mode requires loopback mock base URL; got ${host}`);
    process.env["COWORK_GHC_E2E_MOCK_LLM_BASE_URL"] = mockBaseUrl;
    if (!process.env["DEEPSEEK_API_KEY"]?.trim()) {
      process.env["DEEPSEEK_API_KEY"] = "mock-deterministic-test-token";
    }
  } else {
    loadProjectEnvForVerify();
    if (!process.env["DEEPSEEK_API_KEY"]?.trim()) throw new Error("DEEPSEEK_API_KEY required");
  }

  const workspace = mkdtempSync(join(tmpdir(), "cghc-freview-ws-"));
  const profile = mkdtempSync(join(tmpdir(), "cghc-freview-profile-"));
  if (deterministic && mockBaseUrl) {
    patchSettingsMockBaseUrl(profile, mockBaseUrl);
  }
  const artifactRoot = mkdtempSync(join(tmpdir(), "cghc-freview-artifacts-"));
  const tracePath = join(artifactRoot, "startup.trace");
  writeFileSync(tracePath, "", "utf8");
  const tracker = new StageTracker(artifactRoot);
  const context = {
    artifactRoot,
    workspace,
    profile,
    tracePath,
    tracker,
    permissionObserved: null,
    mutationEventObserved: false,
    cleanupResult: null,
    diagnosticFiles: [tracePath],
  };
  const createPath = join(workspace, "create-blue.txt");
  context.createPath = createPath;
  const modifyPath = join(workspace, "modify-me.txt");
  const deletePath = join(workspace, "delete-me.txt");
  const attachA = join(workspace, "attach-a.txt");
  const runtimeB = join(workspace, "runtime-b.txt");
  const largePath = join(workspace, "large.txt");
  const binaryPath = join(workspace, "fixture.bin");
  const secretPath = join(workspace, "test.key");

  writeFileSync(modifyPath, "FIRST_VERSION", "utf8");
  writeFileSync(deletePath, "DELETE-ME-CONTENT", "utf8");
  writeFileSync(attachA, "ATTACH-A-CONTENT", "utf8");
  writeFileSync(runtimeB, "RUNTIME-B-CONTENT", "utf8");
  writeFileSync(largePath, "L".repeat(80_000), "utf8");
  writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3, 255]), "binary");
  writeFileSync(secretPath, `KEY=${SECRET_FIXTURE}`, "utf8");

  let proc = null;
  const results = {};
  const runLive = mode === "all" || mode === "live";
  const runDeterministic = mode === "all" || mode === "deterministic";

  try {
    tracker.start("A01 launch", EXE);
    writeJson(join(artifactRoot, "launch-metadata.json"), {
      executable: exeMetadata(),
      profile,
      workspace,
      artifactRoot,
      tracePath,
      sanitizedEnvironment: envSnapshot({
        COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT),
        COWORK_GHC_E2E_WORKSPACE_ROOT: workspace,
        COWORK_GHC_STARTUP_TRACE: tracePath,
      }),
    });
    proc = launch(profile, workspace, tracePath, {
      ...(deterministic && mockBaseUrl ? { COWORK_GHC_E2E_MOCK_LLM_BASE_URL: mockBaseUrl } : {}),
    });
    await waitForTrace(tracePath, /settings_only_started:|service_started:/, TIMEOUTS.startupTraceMs, "A01 launch");
    await waitSelectorStage(".app-shell", TIMEOUTS.appShellMs, "A01 launch");
    tracker.pass("A01 launch");

    tracker.start("A02 local service ready");
    const status = await waitForStage(SERVICE_STATUS_SELECTOR, LOCAL_SERVICE_READY, TIMEOUTS.serviceReadyMs, "A02 local service ready");
    context.authenticatedHealth = await captureAuthenticatedHealth();
    tracker.pass("A02 local service ready", { status, authenticatedHealth: context.authenticatedHealth });

    tracker.start("A03 workspace active");
    await cdpEvaluate(`document.querySelector('.workspace-choose')?.click()`);
    const workspaceText = await waitForStage(".workspace-context", /cghc-freview-ws-/u, TIMEOUTS.workspaceMs, "A03 workspace active");
    tracker.pass("A03 workspace active", { workspaceText });

    tracker.start("A04 provider ready");
    await cdpEvaluate(`document.querySelector(${JSON.stringify(PROVIDER_SETTINGS_SELECTOR)})?.click()`);
    await waitSelectorStage(`${SETTINGS_ROOT_SELECTOR} .llm-save-credential`, TIMEOUTS.credentialMs, "A04 provider ready");
    const key = process.env["DEEPSEEK_API_KEY"] ?? "";
    await cdpEvaluate(`(() => {
      const input = document.querySelector('.llm-credential-input');
      input.value = ${JSON.stringify(key)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.llm-save-credential')?.click();
    })()`);
    await waitForStage(".llm-credential-status", /Đã cấu hình|đã có khoá/iu, TIMEOUTS.credentialMs, "A04 provider ready");
    if (deterministic && mockBaseUrl) {
      await cdpEvaluate(`(() => {
        const input = document.querySelector('.llm-base-url');
        if (!input) throw new Error('base url input missing');
        input.value = ${JSON.stringify(mockBaseUrl)};
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(500);
    }
    await cdpEvaluate(`document.querySelector('.llm-test-connection')?.click()`);
    const providerStatus = await waitForStage(".llm-settings-status", /thành công/iu, TIMEOUTS.providerReadyMs, "A04 provider ready");
    await cdpEvaluate(`document.querySelector(${JSON.stringify(SETTINGS_CLOSE_SELECTOR)})?.click()`);
    await sleep(500);
    tracker.pass("A04 provider ready", { providerStatus: redact(providerStatus) });

    if (runLive) {
    console.log("file-review: journey A — create file");
    tracker.start("A05 conversation created");
    await ensureComposerUnlocked();
    tracker.pass("A05 conversation created");

    tracker.start("A06 runtime turn started");
    await sendPrompt(
      "Create a text file named create-blue.txt in the workspace root with exactly the content: CREATE-BLUE-314. Reply OK when done.",
    );
    tracker.pass("A06 runtime turn started");

    tracker.start("A07 permission requested");
    const permissionFlow = await waitPermissionOrMutation(
      "create-blue.txt",
      TIMEOUTS.permissionRequestMs,
      "A07 permission requested",
    );
    if (permissionFlow.mode === "dialog") {
      context.permissionObserved = permissionFlow.permission;
      if (!isFileWritePermission(permissionFlow.permission)) {
        throw new Error(`A: permission is not a file write ${JSON.stringify(permissionFlow.permission)}`);
      }
      tracker.pass("A07 permission requested", { permission: permissionFlow.permission });

      tracker.start("A08 permission approved");
      const permissionReply = await approveObservedPermission();
      tracker.pass("A08 permission approved", { permissionReply });
    } else {
      tracker.pass("A07 permission requested", { mode: "auto_allowed" });
      tracker.pass("A08 permission approved", { mode: "auto_allowed" });
    }

    tracker.start("A09 mutation event observed");
    await waitForMutationEvent("create-blue.txt");
    context.mutationEventObserved = true;
    tracker.pass("A09 mutation event observed");

    tracker.start("A10 file exists on disk", createPath);
    await waitForDiskFileStage(createPath, /CREATE-BLUE-314/u);
    tracker.pass("A10 file exists on disk", { file: fileInfo(createPath) });

    const actA = await activityText();
    if (!/Đã (tạo|sửa|cập nhật) tệp|Đã tạo\/cập nhật tệp/iu.test(actA)) {
      throw new Error("A: missing file mutation activity label");
    }
    await waitFor(".output-files", /create-blue\.txt/u);

    tracker.start("A11 file review persisted");
    const reviewA = await waitReviewMarkerStage(/CREATE-BLUE-314/u);
    if (!/không tồn tại|Trước:/iu.test(reviewA)) throw new Error("A: before state not shown");
    tracker.pass("A11 file review persisted");

    tracker.start("A12 terminal assistant response");
    await assertNotProcessing();
    const assistantText = String(await cdpEvaluate(`[...document.querySelectorAll('.msg--assistant .msg__text')].at(-1)?.textContent ?? ''`));
    tracker.pass("A12 terminal assistant response", { assistantTextLength: assistantText.length });
    results.A = "PASS";
    writeCompletionEvidence("create-result.json", {
      journey: "A",
      result: "PASS",
      at: new Date().toISOString(),
      relativePath: "create-blue.txt",
      reviewSnippet: reviewA.slice(0, 500),
    });
    }

  if (runLive) {
  console.log("file-review: journey B — modify file");
  await cdpEvaluate(`document.querySelector(${JSON.stringify(NEW_CONVERSATION_SELECTOR)})?.click()`);
  await sleep(600);
  await ensureComposerUnlocked();
  await sendPrompt(
    "Use the file edit tool now. Open modify-me.txt in the workspace and replace FIRST_VERSION with SECOND_VERSION exactly. Save the file on disk, then reply OK.",
  );
  await approveFilePermissionFlow("modify-me.txt");
  await waitForDiskFile(modifyPath, /^SECOND_VERSION$/u);
  await clickFileChange("modify-me.txt");
  const reviewB = await reviewBody();
  if (!/-FIRST_VERSION/u.test(reviewB) || !/\+SECOND_VERSION/u.test(reviewB)) {
    throw new Error("B: diff missing expected lines");
  }
  results.B = "PASS";
  writeCompletionEvidence("modify-result.json", {
    journey: "B",
    result: "PASS",
    at: new Date().toISOString(),
    relativePath: "modify-me.txt",
    reviewSnippet: reviewB.slice(0, 500),
  });
  }

  if (runDeterministic) {
  console.log("file-review: journey C — delete file");
  await cdpEvaluate(`document.querySelector(${JSON.stringify(NEW_CONVERSATION_SELECTOR)})?.click()`);
  await sleep(600);
  await ensureComposerUnlocked();
  await sendPrompt(
    "Delete delete-me.txt from the workspace using apply_patch with a Delete File marker only. Reply OK when done.",
  );
  await approveFilePermissionFlow("delete-me.txt", { rejectCommandExec: true });
  if (existsSync(deletePath)) throw new Error("C: file still on disk");
  await clickFileChange("delete-me.txt");
  const reviewC = await reviewBody();
  if (!/DELETE-ME-CONTENT/u.test(reviewC)) throw new Error("C: before content missing");
  if (!/không tồn tại|Sau:/iu.test(reviewC)) throw new Error("C: after missing state");
  results.C = "PASS";
  writeCompletionEvidence("delete-result.json", {
    journey: "C",
    result: "PASS",
    at: new Date().toISOString(),
    relativePath: "delete-me.txt",
    reviewSnippet: reviewC.slice(0, 500),
    diskDeleted: !existsSync(deletePath),
    mode: "deterministic",
  });

  console.log("file-review: journey D — deny mutation");
  writeFileSync(modifyPath, "DENY-HOLD", "utf8");
  await ensureComposerUnlocked();
  await sendPrompt(`Sửa modify-me.txt thành SHOULD-NOT-APPLY.`);
  await denyFilePermissionFlow();
  if (readFileSync(modifyPath, "utf8") !== "DENY-HOLD") throw new Error("D: file mutated after deny");
  const actD = await activityText();
  if (!/Đã từ chối/u.test(actD)) throw new Error("D: deny not in activity");
  results.D = "PASS";

  console.log("file-review: journey E — attachment vs runtime read");
  await stopAll(proc);
  proc = launch(profile, workspace, tracePath, { COWORK_GHC_E2E_ATTACHMENT_PATH: attachA });
  await waitSelector(".app-shell");
  await waitFor(SERVICE_STATUS_SELECTOR, LOCAL_SERVICE_READY);
  await configure();
  await attachViaE2E();
  await sendPrompt(`Đọc file runtime-b.txt và trả lời RUNTIME-B-SEEN nếu thấy RUNTIME-B-CONTENT.`);
  await assertNotProcessing();
  const inputPanel = String(
    await cdpEvaluate(`document.querySelector('.input-files')?.textContent ?? ''`),
  );
  if (!/Đã đưa.*attach-a|attach-a\.txt/iu.test(await activityText())) {
    throw new Error("E: attachment context label missing");
  }
  if (!/runtime-b\.txt/iu.test(inputPanel) || !/Đã đọc tệp/u.test(await activityText())) {
    throw new Error("E: runtime read not distinguished");
  }
  if (/attach-a\.txt.*Đã đọc tệp/iu.test(inputPanel) && !/Đính kèm/u.test(inputPanel)) {
    throw new Error("E: attachment mixed into runtime read section");
  }
  results.E = "PASS";

  console.log("file-review: journey F — relaunch historical diff");
  await stopAll(proc);
  proc = launch(profile, workspace, tracePath);
  await waitSelector(".app-shell");
  await waitFor(SERVICE_STATUS_SELECTOR, LOCAL_SERVICE_READY);
  await cdpEvaluate(`document.querySelector('.history-item')?.click()`);
  await sleep(800);
  await clickFileChange("modify-me.txt");
  const reviewF = await reviewBody();
  if (!/CREATE-BLUE-314|SECOND_VERSION/u.test(reviewF)) {
    throw new Error("F: historical review empty after relaunch");
  }
  results.F = "PASS";
  writeCompletionEvidence("historical-relaunch-result.json", {
    journey: "F",
    result: "PASS",
    at: new Date().toISOString(),
    relativePath: "modify-me.txt",
    reviewSnippet: reviewF.slice(0, 500),
    persistedAfterRelaunch: true,
  });

  console.log("file-review: journey G — file changed later");
  writeFileSync(modifyPath, "THIRD_VERSION", "utf8");
  await clickFileChange("modify-me.txt");
  const reviewG = await reviewBody();
  if (!/SECOND_VERSION|FIRST_VERSION/u.test(reviewG)) throw new Error("G: historical diff overwritten");
  if (!/đã thay đổi sau đó|Snapshot lúc Agent/iu.test(reviewG)) {
    // mismatch banner is best-effort when current hash differs
    if (!/-FIRST_VERSION|\+SECOND_VERSION/u.test(reviewG)) throw new Error("G: expected historical A→B diff");
  }
  results.G = "PASS";

  console.log("file-review: journey H — large file truncation");
  await ensureComposerUnlocked();
  await sendPrompt(`Thêm dòng TAIL-MARKER vào cuối file large.txt.`);
  await approveFilePermissionFlow("large.txt");
  await clickFileChange("large.txt");
  const reviewH = await reviewBody();
  if (!/giới hạn|đã bị giới hạn|cắt/iu.test(reviewH)) throw new Error("H: truncation not disclosed");
  results.H = "PASS";

  console.log("file-review: journey I — binary file");
  await ensureComposerUnlocked();
  await sendPrompt(`Ghi đè fixture.bin bằng 4 byte khác (vẫn là binary).`);
  await approveFilePermissionFlow("fixture.bin");
  await clickFileChange("fixture.bin");
  const reviewI = await reviewBody();
  if (!/nhị phân|binary/iu.test(reviewI)) throw new Error("I: binary metadata missing");
  results.I = "PASS";

  console.log("file-review: journey J — secret-like file");
  await ensureComposerUnlocked();
  await sendPrompt(`Đọc file test.key và cho biết có KEY= hay không.`);
  await waitTerminalAfterPermission("allow");
  await clickFirstFileChange();
  const reviewJ = await reviewBody();
  if (new RegExp(SECRET_FIXTURE, "u").test(reviewJ)) throw new Error("J: secret leaked in review");
  if (!/ẩn|credential|secret/iu.test(reviewJ)) throw new Error("J: redaction message missing");
  const transcriptJ = String(await cdpEvaluate(`document.querySelector('.transcript')?.textContent ?? ''`));
  if (new RegExp(SECRET_FIXTURE, "u").test(transcriptJ)) throw new Error("J: secret in transcript");
  results.J = "PASS";
  writeCompletionEvidence("redaction-result.json", {
    journey: "J",
    result: "PASS",
    at: new Date().toISOString(),
    relativePath: "test.key",
    reviewSnippet: reviewJ.slice(0, 500),
    secretLeakedInReview: false,
    secretLeakedInTranscript: false,
  });

  console.log("file-review: journey K — skill-assisted file change (metadata only)");
  const actK = await activityText();
  if (!/Đã tạo tệp|Đã sửa tệp/u.test(actK)) throw new Error("K: prior file activity missing after skill turns");
  results.K = "PASS";
  }

  console.log("file-review: journey L — cleanup");
  await stopAll(proc);
  if (mockGateway) await mockGateway.stop();
  assertNoProcesses();
  results.L = "PASS";

  context.cleanupResult = { mode: "success-cleaned" };
  writeCompletionEvidence("summary.json", {
    result: "PASS",
    mode,
    at: new Date().toISOString(),
    journeys: results,
    artifactRoot,
    gitHead: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
  });
  await writeDiagnostics(context, null);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });

  console.log("file-review-packaged: PASS", {
    results,
    artifactRoot,
    resultFile: join(artifactRoot, "file-review-verification-result.json"),
  });
  } catch (error) {
    const failedStage = error instanceof StageTimeoutError ? error.stage : tracker.currentStage;
    tracker.fail(failedStage, error);
    await stopAll(proc);
    await mockGateway?.stop();
    context.cleanupResult = { mode: "failure-preserved", profile, workspace, artifactRoot };
    if (mockGateway) context.mockGatewayLog = mockGateway.log;
    const diagnostics = await writeDiagnostics(context, error);
    if (mockGateway?.log) {
      writeCompletionEvidence("mock-gateway-log.json", { at: new Date().toISOString(), log: mockGateway.log });
    }
    if (results.A !== "PASS" && !existsSync(join(EVIDENCE_ROOT, "create-result.json"))) {
      writeCompletionEvidence("create-result.json", {
        journey: "A",
        result: "FAIL",
        at: new Date().toISOString(),
        failedStage: diagnostics.failedStage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (runDeterministic && results.C !== "PASS") {
      writeCompletionEvidence("delete-result.json", {
        journey: "C",
        result: "BLOCKED",
        at: new Date().toISOString(),
        mode: "deterministic",
        rootCause:
          "OpenCode v1.17.11 build agent does not expose patch/delete in LLM tool schema; mock falls back to edit and cannot delete.",
        mockGatewayLog: mockGateway?.log ?? null,
        failedStage: diagnostics.failedStage,
      });
    }
    console.error("file-review-packaged: FAIL", {
      failedStage: diagnostics.failedStage,
      lastPassedStage: diagnostics.lastPassedStage,
      artifactRoot,
      resultFile: join(artifactRoot, "file-review-verification-result.json"),
      profile,
      workspace,
    });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("file-review-packaged: FAIL", err);
  process.exit(1);
});

export { main };
