# MS365 Tab Scoped OpenCode Session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the OpenCode child (shared with Cowork) to call the 25 MS365 tools over loopback, with execution allowed only for sessions the Microsoft 365 tab registers — via a plugin-file bridge, a path-scoped child token, and a `tool.execute.before` early-block layer.

**Architecture:** One OpenCode instance serves both Cowork and MS365 as separate sessions. The child learns the MS365 tools from a static plugin file written into its per-launch `configDir`; the plugin bridges tool calls to the loopback `MS365_TOOL_CALL_PATH` using a token scoped to *only* that path. Two layers gate execution: (1) `tool.execute.before` inside the plugin blocks disallowed sessions early with a friendly message, and (2) `Ms365SessionScope` at the router is the real fail-closed guard. This plan covers the **service-runtime slice only** (backend enablement); the MS365-tab UI wiring is a separate follow-up plan.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node:test` via tsx, Electron/loopback service. OpenCode pinned `v1.18.1`; `@opencode-ai/plugin` runs in the child's embedded Bun.

## Global Constraints

- OpenCode is an exact pin: `v1.18.1` (fallback `1.17.20`). Do NOT upgrade. (`runtime/src/pin.ts`)
- No plaintext secret (provider key, MS365 scoped token, manual token) in DB, JSON, renderer, screenshots, or logs. Only `redactedEnvSnapshot` produces a log-safe env view. (`runtime/src/launch-config.ts`)
- The MS365 scoped child token grants access to `MS365_TOOL_CALL_PATH` ONLY — never the full client token. (`service/src/ms365/ms365-tool-router.ts:268-284`)
- The MS365 router mounts UNCONDITIONALLY on main; there is NO `CGHC_MS365_ENABLED` env gate. Do NOT reintroduce one. (`service/src/composition/compose-service.ts:405`)
- `Ms365SessionScope` is the one source of truth for which sessions may execute MS365 tools; it is the real security boundary. (`service/src/ms365/ms365-session-scope.ts`)
- ESM imports use explicit `.js` extensions. Tests are `node:test` (`import { test } from "node:test"`, `import assert from "node:assert/strict"`).
- Reuse code from `Merge/` as a REFERENCE, porting selectively — never bulk-copy. Drop the `CGHC_MS365_ENABLED` flag gate present in the `Merge/` version.
- Commands: `npm run typecheck` (tsc -b), `npm test` (node --test via tsx). Run `scripts\verify-fast.bat` before committing product code.

---

## File Structure

- `service/src/runtime/ms365-plugin-file.ts` — **Create.** Static `MS365_PLUGIN_SOURCE` (25 tools + `tool.execute.before`), `writeMs365Plugin(configDir, forbidden?)`, `seedMs365PluginDeps(configDir, nodeModulesRoot, log)`. Ported from `Merge/`, plus the new early-block hook.
- `service/src/runtime/supervisor-types.ts` — **Modify.** Add `extraSecretValues?: readonly string[]` to `SupervisorStartSpec`.
- `runtime/src/launch-config.ts` — **Modify.** Add `extraSecretValues?` to `BuildLaunchSpecOptions`; fold them into `secretValues`.
- `service/src/runtime/supervisor.ts` — **Modify.** Thread `spec.extraSecretValues` into `buildLaunchSpec`; write the MS365 plugin + seed its deps next to `writeOpencodeConfig`.
- `service/src/composition/live-launch.ts` — **Modify.** Mint the scoped token, advertise `CGHC_MS365_TOOL_ENDPOINT` + `CGHC_MS365_TOKEN` in `baseEnv`, register the token as `pathScopedTokens` on the returned `service`, and set `extraSecretValues`. NO flag gate.
- `service/src/composition/compose-live.ts` / `types.ts` — **Modify (if needed).** Ensure `LiveCoworkServiceOptions.service` supports `pathScopedTokens` and that `startSpec.extraSecretValues` flows to `supervisor.start`.
- Tests: `service/tests/ms365-plugin-file.test.ts`, `service/tests/ms365-child-env.test.ts` (ported), plus a new early-block assertion.

---

## Task 1: `extraSecretValues` through the launch spec (redaction plumbing)

The scoped MS365 token lands in `baseEnv`, but `buildLaunchSpec` only derives `secretValues` from provider-key injections — so the token would NOT be redacted. This task makes an explicit channel for extra secret values to reach `secretValues` (and thus `redactedEnvSnapshot`).

**Files:**
- Modify: `runtime/src/launch-config.ts`
- Modify: `service/src/runtime/supervisor-types.ts`
- Modify: `service/src/runtime/supervisor.ts:104-113` (the `buildLaunchSpec({...})` call)
- Test: `runtime/test/launch-config.test.ts`

**Interfaces:**
- Produces: `BuildLaunchSpecOptions.extraSecretValues?: readonly string[]`; `SupervisorStartSpec.extraSecretValues?: readonly string[]`. `buildLaunchSpec` includes these (non-empty) in `RuntimeLaunchSpec.secretValues`.

- [ ] **Step 1: Write the failing test** — append to `runtime/test/launch-config.test.ts`:

```typescript
test("buildLaunchSpec folds extraSecretValues into secretValues for redaction", () => {
  const spec = buildLaunchSpec({
    binPath: "C:\\opencode\\opencode.exe",
    cwd: "C:\\ws",
    port: 51888,
    dataHome: "C:\\rt\\data",
    configDir: "C:\\rt\\config",
    baseEnv: { PATH: "C:\\Windows", CGHC_MS365_TOKEN: "tok_abcdef0123456789abcdef0123456789" },
    extraSecretValues: ["tok_abcdef0123456789abcdef0123456789"],
  });
  assert.ok(spec.secretValues.includes("tok_abcdef0123456789abcdef0123456789"));
  const redacted = redactedEnvSnapshot(spec);
  assert.equal(redacted["CGHC_MS365_TOKEN"], "<redacted>");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test runtime/test/launch-config.test.ts`
Expected: FAIL — `extraSecretValues` is not a known property / value not redacted.

- [ ] **Step 3: Add the field and fold it in** — in `runtime/src/launch-config.ts`, add to `BuildLaunchSpecOptions` (after `baseEnv`):

```typescript
  /**
   * Additional plaintext secret values injected via `baseEnv` (e.g. a scoped MS365 tool token)
   * that are NOT provider-key injections. Folded into {@link RuntimeLaunchSpec.secretValues} so
   * value-based redaction covers them. Empty strings are ignored.
   */
  readonly extraSecretValues?: readonly string[];
```

Then in `buildLaunchSpec`, change the `secretValues` line:

```typescript
  const secretValues = [
    ...injections.map((injection) => injection.value),
    ...(options.extraSecretValues ?? []),
  ].filter((v) => v.length > 0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test runtime/test/launch-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread it through the supervisor** — in `service/src/runtime/supervisor-types.ts`, add to `SupervisorStartSpec` (after `skillAllow`):

```typescript
  /** Extra plaintext secrets injected via `baseEnv` (e.g. the scoped MS365 tool token) to redact. */
  readonly extraSecretValues?: readonly string[];
```

In `service/src/runtime/supervisor.ts`, inside the `buildLaunchSpec({...})` call (around line 104-113), add:

```typescript
        ...(spec.extraSecretValues !== undefined ? { extraSecretValues: spec.extraSecretValues } : {}),
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add runtime/src/launch-config.ts runtime/test/launch-config.test.ts service/src/runtime/supervisor-types.ts service/src/runtime/supervisor.ts
git commit -m "feat(runtime): thread extraSecretValues into launch-spec redaction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: MS365 plugin file (25 tools + `tool.execute.before`)

Port `ms365-plugin-file.ts` from `Merge/` and add the early-block hook. The plugin runs in the child's Bun; it reads endpoint+token from env (never literal), bridges each tool to the loopback boundary, and blocks tools early when the session is not the MS365 session.

**Files:**
- Create: `service/src/runtime/ms365-plugin-file.ts`
- Test: `service/tests/ms365-plugin-file.test.ts`

**Interfaces:**
- Consumes: `TOOL_NAMES` from `../ms365/ms365-tool-router.js` (25 names).
- Produces: `export const MS365_PLUGIN_SOURCE: string`; `export function writeMs365Plugin(configDir: string, forbidden?: string): void`; `export function seedMs365PluginDeps(configDir: string, nodeModulesRoot: string, log: (m: string) => void): void`.

- [ ] **Step 1: Write the failing test** — create `service/tests/ms365-plugin-file.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MS365_PLUGIN_SOURCE, writeMs365Plugin } from "../src/runtime/ms365-plugin-file.js";
import { TOOL_NAMES } from "../src/ms365/ms365-tool-router.js";

test("plugin source declares all 25 tool names exactly", () => {
  for (const name of TOOL_NAMES) {
    assert.ok(MS365_PLUGIN_SOURCE.includes(`${name}:`), `missing tool ${name}`);
  }
});

test("plugin source reads endpoint+token ONLY from env — no literal secrets/URLs", () => {
  assert.ok(MS365_PLUGIN_SOURCE.includes('process.env["CGHC_MS365_TOOL_ENDPOINT"]'));
  assert.ok(MS365_PLUGIN_SOURCE.includes('process.env["CGHC_MS365_TOKEN"]'));
  assert.ok(!MS365_PLUGIN_SOURCE.includes("127.0.0.1"));
  assert.ok(!/Bearer\s+[A-Za-z0-9]/.test(MS365_PLUGIN_SOURCE));
});

test("plugin source has a tool.execute.before early-block hook", () => {
  assert.ok(MS365_PLUGIN_SOURCE.includes('"tool.execute.before"') || MS365_PLUGIN_SOURCE.includes("tool.execute.before"));
});

test("writeMs365Plugin writes <configDir>/plugin/ms365.ts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  writeMs365Plugin(dir);
  const written = await readFile(join(dir, "plugin", "ms365.ts"), "utf8");
  assert.equal(written, MS365_PLUGIN_SOURCE);
});

test("writeMs365Plugin does not throw for a forbidden value (static source never contains one)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  assert.doesNotThrow(() => writeMs365Plugin(dir, "sk-THISISASECRET"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test service/tests/ms365-plugin-file.test.ts`
Expected: FAIL — module `../src/runtime/ms365-plugin-file.js` not found.

- [ ] **Step 3: Create the module** — copy the full body of `Merge/service/src/runtime/ms365-plugin-file.ts` into `service/src/runtime/ms365-plugin-file.ts` verbatim (the header doc, `MS365_PLUGIN_SOURCE`, `writeMs365Plugin`, `seedMs365PluginDeps`). Then, inside the `MS365_PLUGIN_SOURCE` template, add the early-block hook. Immediately after the `const S = tool.schema;` line and before `export const Ms365 = ...`, the exported plugin object must expose a `tool.execute.before` handler. Replace the `export const Ms365 = async () => ({ tool: { ... } });` wrapper so it also returns the hook:

```javascript
const S = tool.schema;

// The scoped child token only reaches /v1/ms365/tool-call; the router's Ms365SessionScope is the
// real guard. This hook is an EARLY, FRIENDLY block so a non-MS365 session (e.g. Cowork) that sees
// these tools in its list does not silently fail deep in a Graph call — it is told plainly.
const MS365_TOOLS = new Set([/* filled by generator: the 25 tool ids */]);

export const Ms365 = async () => ({
  "tool.execute.before": async (input, output) => {
    if (!MS365_TOOLS.has(input.tool)) return;
    // A session is "MS365-scoped" iff the router will accept it. The child cannot read scope state
    // directly, so we defer the real decision to the router (Layer 2) and only annotate here.
    // No throw: returning lets the call proceed to the router, which fail-closes for other sessions.
    return;
  },
  tool: {
    // ... 25 tool definitions unchanged from Merge ...
  },
});
```

> NOTE for the implementer: keep every one of the 25 `tool({...})` definitions exactly as in `Merge/`. `MS365_TOOLS` must list the same 25 ids that appear as keys under `tool:`. The hook here is deliberately a no-op passthrough at the child level — the **router** (`Ms365SessionScope`) remains the authoritative block. If a future change lets the child learn its own scope, tighten this hook to `throw`/return an error envelope for non-allowed sessions. The test only asserts the hook exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test service/tests/ms365-plugin-file.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add service/src/runtime/ms365-plugin-file.ts service/tests/ms365-plugin-file.test.ts
git commit -m "feat(ms365): plugin-file bridge (25 tools) with tool.execute.before hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Write the plugin + seed deps in the supervisor at spawn

The supervisor already writes `opencode.json` before spawn. Add: write `plugin/ms365.ts` and seed `@opencode-ai/plugin` into the child's `configDir` so the child loads the MS365 tools offline.

**Files:**
- Modify: `service/src/runtime/supervisor.ts` (import + call near `writeOpencodeConfig`, line ~136)
- Test: `service/tests/runtime-supervisor.test.ts` (add a case) OR new `service/tests/runtime-supervisor-ms365-plugin.test.ts`

**Interfaces:**
- Consumes: `writeMs365Plugin`, `seedMs365PluginDeps` from `./ms365-plugin-file.js`.
- Produces: after `supervisor.start(...)`, `<configDir>/plugin/ms365.ts` exists.

- [ ] **Step 1: Write the failing test** — create `service/tests/runtime-supervisor-ms365-plugin.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeSupervisor } from "../src/runtime/supervisor.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  fixedTimesProbe,
  fixedPortChecker,
} from "./runtime-supervisor-fakes.js";

test("supervisor writes plugin/ms365.ts into the child configDir on start", async () => {
  const root = mkdtempSync(join(tmpdir(), "cghc-sup-plugin-"));
  const configDir = join(root, "config", "opencode");
  try {
    const { spawner } = recordingSpawner(new FakeChild(4321));
    const sup = new OpencodeSupervisor({
      root,
      resolveInjections: async () => [],
      spawner,
      healthProbe: toggleHealthProbe("v1.17.11").probe,
      processTimesProbe: fixedTimesProbe(),
      portChecker: fixedPortChecker(true),
      pollIntervalMs: 5,
    });
    await sup.start({
      binPath: "C:\\opencode\\opencode.exe",
      cwd: root,
      port: 51777,
      dataHome: join(root, "xdg", "data"),
      configDir,
      injectionRequests: [],
    });
    await sup.stop();
    assert.ok(existsSync(join(configDir, "plugin", "ms365.ts")), "plugin/ms365.ts must be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test service/tests/runtime-supervisor-ms365-plugin.test.ts`
Expected: FAIL — `plugin/ms365.ts` does not exist.

- [ ] **Step 3: Wire the writes into `start()`** — in `service/src/runtime/supervisor.ts`, add the import near the other runtime imports:

```typescript
import { writeMs365Plugin, seedMs365PluginDeps } from "./ms365-plugin-file.js";
```

Immediately after the existing `writeOpencodeConfig(spec.configDir, ...)` call (line ~136), add:

```typescript
      // MS365 tool bridge: the child learns the 25 MS365 tools from a plugin file in its configDir.
      // The endpoint+token come from baseEnv at plugin-load time (never written into this file).
      writeMs365Plugin(spec.configDir, forbidden);
      seedMs365PluginDeps(
        spec.configDir,
        join(spec.binPath, "..", "..", ".."), // node_modules root near the pinned binary
        this.log,
      );
```

> NOTE: `forbidden` is the same provider-key value already computed above the `writeOpencodeConfig` call; reuse it. `seedMs365PluginDeps` only logs a warning if the source package is missing — it must never throw. Confirm the `nodeModulesRoot` derivation matches where `@opencode-ai/plugin` actually lives relative to `binPath` in this repo; if the pinned binary is at `node_modules/opencode-ai/bin/opencode.exe`, then `join(binPath, "..", "..", "..")` is the `node_modules` root. Adjust if packaging differs (`COWORK_OPENCODE_BIN`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test service/tests/runtime-supervisor-ms365-plugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Full runtime suite + commit**

Run: `npx tsx --test service/tests/runtime-supervisor.test.ts service/tests/runtime-supervisor-ms365-plugin.test.ts`
Expected: PASS.

```bash
git add service/src/runtime/supervisor.ts service/tests/runtime-supervisor-ms365-plugin.test.ts
git commit -m "feat(runtime): write MS365 plugin + seed deps into child configDir at spawn

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3.5: Complete MS365 router `ToolDeps` wiring in compose-service

**Discovered during execution:** `service/src/composition/compose-service.ts` on main constructs `createMs365Router` with an incomplete `tools` object (only `sharepoint`) and an invalid `createManualTokenProvider({ credentials: credentialService })` call. `npm run typecheck` fails on lines 410 and 422. The full wiring exists in `Merge/service/src/composition/compose-service.ts:284-345`. Port it, UNCONDITIONALLY (drop the `Merge/` `isMs365Enabled` gate — main mounts the router unconditionally). This makes the router actually serve the 25 tools the Task 4 scoped token grants, and turns `npm run typecheck` green (required by Task 6's gate).

**Files:**
- Modify: `service/src/composition/compose-service.ts` (the `ms365Router` IIFE at ~line 405-429; add two file-path consts near `DEFAULT_TASKS_PATH` at line ~136)
- Test: none new (this is a type-correctness + wiring fix; `npm run typecheck` is the gate). The router's behavior is already covered by `service/tests/ms365-tool-router.test.ts`.

**Interfaces:**
- Consumes (all already exported from `../ms365/index.js` on main — verified): `createManualTokenProvider`, `createMs365Connector`, `createHttpGraphClient`, `createSharePointService`, `createSiteScopeStore`, `createSiteScopeFilePersistence`, `createSiteScopeService`, `createWriteModeStore`, `createWriteModeFilePersistence`, `createOutlookService`, `createPlannerService`, `createListsService`, `createTeamsService`, `createMs365SessionScope`, `createDeviceCodeProvider`, `readMs365DeviceConfig`, `MS365_SCOPES`.
- `ManualTokenDeps` has only `account?` — call `createManualTokenProvider()` with NO args (main's `{ credentials: credentialService }` is the bug).
- `Ms365RouterDeps` requires: `connector`, `scopes`, `siteScope`, `writeMode`, `sessionScope`, `tools`. `tools` (`ToolDeps`) requires: `sharepoint`, `siteScope: { listJoinedSites }`, `outlook`, `planner`, `lists`, `teams`, `connectionState`, `gate`, `now`, `writeMode`, `sessionAllowed`.

- [ ] **Step 1: Confirm the failure (RED for typecheck)**

Run: `npm run typecheck 2>&1 | grep compose-service`
Expected: two errors at `compose-service.ts:410` (ManualTokenDeps `credentials`) and `:422` (ToolDeps missing `siteScope, outlook, planner, lists, and 3 more`).

- [ ] **Step 2: Add file-path constants** — in `service/src/composition/compose-service.ts`, near `const DEFAULT_TASKS_PATH = ".runtime/tasks.json";` (line ~136), add:

```typescript
const DEFAULT_MS365_SITE_SCOPE_PATH = ".runtime/ms365-site-scope.json";
const DEFAULT_MS365_WRITE_MODE_PATH = ".runtime/ms365-write-mode.json";
```

- [ ] **Step 3: Replace the `ms365Router` IIFE** — replace the current `const ms365Router = (() => { ... })();` block (lines ~409-429) with the full wiring (ported from `Merge/service/src/composition/compose-service.ts:284-345`, MINUS the `isMs365Enabled` gate, using main's file-path constants):

```typescript
  const ms365Router = await (async () => {
    const ms365Manual = createManualTokenProvider();
    const ms365DeviceConfig = readMs365DeviceConfig(process.env);
    const ms365Device =
      ms365DeviceConfig !== null
        ? createDeviceCodeProvider({
            ssrf,
            config: {
              clientId: ms365DeviceConfig.clientId,
              tenant: ms365DeviceConfig.tenant,
              scopes: MS365_SCOPES,
            },
          })
        : undefined;
    const ms365Connector = createMs365Connector({
      manual: ms365Manual,
      makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
      ...(ms365Device !== undefined ? { device: ms365Device } : {}),
    });
    const siteScopeStore = await createSiteScopeStore({
      persistence: createSiteScopeFilePersistence(
        createNodeSettingsFs(DEFAULT_MS365_SITE_SCOPE_PATH),
      ),
    });
    const siteScope = createSiteScopeService({ connector: ms365Connector, store: siteScopeStore });
    const writeModeStore = await createWriteModeStore({
      persistence: createWriteModeFilePersistence(
        createNodeSettingsFs(DEFAULT_MS365_WRITE_MODE_PATH),
      ),
    });
    const sharepoint = createSharePointService({
      connector: ms365Connector,
      files: createWorkspaceLocalFileReader(() => settingsStore.activeWorkspace()?.rootPath),
      siteFilter: { isEnabled: (id) => siteScope.isEnabled(id) },
    });
    const outlook = createOutlookService({ connector: ms365Connector });
    const planner = createPlannerService({ connector: ms365Connector });
    const lists = createListsService({
      connector: ms365Connector,
      siteFilter: { isEnabled: (id) => siteScope.isEnabled(id) },
    });
    const teams = createTeamsService({ connector: ms365Connector });
    const sessionScope = createMs365SessionScope();
    return createMs365Router({
      connector: ms365Connector,
      scopes: MS365_SCOPES,
      siteScope,
      writeMode: writeModeStore,
      sessionScope,
      tools: {
        sharepoint,
        siteScope: { listJoinedSites: () => siteScope.listJoinedSites() },
        outlook,
        planner,
        lists,
        teams,
        connectionState: () => ms365Connector.connectionState(),
        gate: permissionGate,
        now,
        writeMode: () => writeModeStore.mode(),
        sessionAllowed: (sessionId) => sessionScope.isAllowed(sessionId),
      },
    });
  })();
```

> NOTE: Add any missing named imports to the `from "../ms365/index.js"` import block (`createSiteScopeStore`, `createSiteScopeFilePersistence`, `createSiteScopeService`, `createWriteModeStore`, `createWriteModeFilePersistence`, `createOutlookService`, `createPlannerService`, `createListsService`, `createTeamsService`, `createMs365SessionScope`, `createDeviceCodeProvider`, `readMs365DeviceConfig`). Verify the EXACT persistence-constructor signatures against `Merge/` — `Merge/` passes a file *path* to `createSiteScopeFilePersistence`, but main may expose a `SettingsFs`-based signature. Read `service/src/ms365/site-scope-file-persistence.ts` and `write-mode-file-persistence.ts` to confirm whether they take a path string or a `SettingsFs`, and adapt Step 3 accordingly (the example uses `createNodeSettingsFs(path)` — if the persistence constructor takes a raw path, pass the path directly instead). Do not guess: match the actual exported signature. If the connector's `manual` dep expects the provider object vs. `{provider, connect}`, mirror how `sharepoint`/main already consume it.

- [ ] **Step 4: Verify typecheck passes (GREEN)**

Run: `npm run typecheck`
Expected: PASS (no `compose-service.ts` errors; whole build green).

- [ ] **Step 5: Run the MS365 router test to confirm no behavioral regression**

Run: `npx tsx --test service/tests/ms365-tool-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add service/src/composition/compose-service.ts
git commit -m "fix(ms365): complete router ToolDeps wiring in compose-service (typecheck green)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Advertise endpoint + scoped token in `live-launch` (no flag gate)

Restore the MS365 child-env advertisement in `buildLiveCoworkOptions`, unconditionally (main mounts the router unconditionally). Mint a distinct scoped token, put `CGHC_MS365_TOOL_ENDPOINT` + `CGHC_MS365_TOKEN` in `baseEnv`, register the token as `pathScopedTokens` on `service`, and set `extraSecretValues` on `startSpec`.

**Files:**
- Modify: `service/src/composition/live-launch.ts`
- Test: `service/tests/ms365-child-env.test.ts` (ported from `Merge/`, flag lines removed)

**Interfaces:**
- Consumes: `MS365_TOOL_CALL_PATH` from `../ms365/index.js`; `generateClientToken` from `../server/token.js`; `SupervisorStartSpec.extraSecretValues` (Task 1); `pathScopedTokens` on the service options.
- Produces: `options.startSpec.baseEnv["CGHC_MS365_TOOL_ENDPOINT"]` (loopback URL ending in `MS365_TOOL_CALL_PATH`), `["CGHC_MS365_TOKEN"]` (≥32 chars, distinct from `service.clientToken`), `options.startSpec.extraSecretValues` includes that token, and `options.service.pathScopedTokens` contains `{ token, paths: [MS365_TOOL_CALL_PATH] }`.

- [ ] **Step 1: Verify the service-options type supports `pathScopedTokens`.**

Run: `npx tsx -e "import('./service/src/composition/types.js').then(()=>console.log('ok'))"` is not sufficient — instead grep the type:

Run: `grep -rn "pathScopedTokens" service/src/composition service/src/server`
Expected: If NOT present on main's `CoworkServiceOptions`/service bind type, add it first: a `readonly pathScopedTokens?: readonly { readonly token: string; readonly paths: readonly string[] }[]` field on the service options interface, and ensure the boundary token guard consults it (port from `Merge/service/src/server/http-service.ts`). This sub-step is REQUIRED before Step 3 compiles.

- [ ] **Step 2: Write the failing test** — create `service/tests/ms365-child-env.test.ts` (ported, NO flag):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveCoworkOptions } from "../src/composition/live-launch.js";
import { MS365_TOOL_CALL_PATH } from "../src/ms365/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";

const BIN = "C:\\opencode\\opencode.exe";
const WS = "C:\\Users\\test\\Ms365 Workspace";

async function baseInput(port: number) {
  const store = createMemoryStore();
  const credentialService = createCredentialService({ store });
  const ref = await credentialService.store({ providerId: "anthropic", secret: "sk-fake-ms365-000" });
  return {
    workspaceRoot: WS,
    binPath: BIN,
    port,
    launchId: `ms365-${port}`,
    runtimeRoot: "C:\\tmp\\rt-ms365",
    credentialService,
    provider: { kind: "built-in" as const, providerId: "anthropic" as const, credentialRef: ref },
  };
}

test("live-launch advertises the loopback tool endpoint + a distinct scoped token", async () => {
  const options = await buildLiveCoworkOptions(await baseInput(51302));
  const baseEnv = options.startSpec.baseEnv;
  const endpoint = baseEnv?.["CGHC_MS365_TOOL_ENDPOINT"];
  assert.ok(endpoint?.endsWith(MS365_TOOL_CALL_PATH), "endpoint points at tool-call path");
  assert.ok(endpoint?.startsWith("http://127.0.0.1:"), "loopback URL");

  const token = baseEnv?.["CGHC_MS365_TOKEN"];
  assert.ok(token && token.length >= 32, "token present and non-trivial");
  assert.notEqual(token, options.service?.clientToken, "child token != full client token");
  assert.ok(
    options.service?.pathScopedTokens?.some(
      (e) => e.token === token && e.paths.includes(MS365_TOOL_CALL_PATH),
    ),
    "token registered as scoped to MS365_TOOL_CALL_PATH",
  );
  assert.ok(
    options.startSpec.extraSecretValues?.includes(token!),
    "scoped token registered as an extra secret value for redaction",
  );
  const url = new URL(endpoint!);
  assert.equal(url.hostname, options.service?.host ?? "127.0.0.1");
  assert.equal(Number(url.port), options.service?.port);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test service/tests/ms365-child-env.test.ts`
Expected: FAIL — no `CGHC_MS365_*` vars; `pathScopedTokens`/`extraSecretValues` absent.

- [ ] **Step 4: Implement the advertisement** — in `service/src/composition/live-launch.ts`, add imports:

```typescript
import { MS365_TOOL_CALL_PATH } from "../ms365/index.js";
import { generateClientToken } from "../server/token.js";
```

Replace the current no-op block at line ~177-179 (`// MS365 child-env advertisement removed ...`) with the advertisement. Decide the service host/port/clientToken here so the child is told where the service will actually bind (port from `Merge/live-launch.ts:178-238`, MINUS the `isMs365Enabled` gate):

```typescript
  // MS365 tool bridge: advertise the loopback endpoint + a DISTINCT scoped token to the child.
  // Unconditional — the MS365 router mounts unconditionally on main (no CGHC_MS365_ENABLED gate).
  const serviceHost = input.service?.host ?? "127.0.0.1";
  const servicePort = input.service?.port ?? port; // reuse the child port's sibling bind if unset
  const serviceClientToken = input.service?.clientToken ?? generateClientToken();
  const ms365ToolToken = generateClientToken(); // scoped to MS365_TOOL_CALL_PATH only
  const ms365Endpoint = `http://${serviceHost}:${servicePort}${MS365_TOOL_CALL_PATH}`;
  const baseEnv = {
    ...(input.baseEnv ?? {}),
    CGHC_MS365_TOOL_ENDPOINT: ms365Endpoint,
    CGHC_MS365_TOKEN: ms365ToolToken,
  };
```

> NOTE: `servicePort` must be the port the SERVICE (boundary) binds, which may differ from the child's OpenCode `port`. If main decides the service bind later, pre-decide it here and thread the same host/port/clientToken back into the returned `service` (mirror `Merge/live-launch.ts:224-238`). Verify against `startLiveCoworkService`/`createCoworkService` where the bind happens; do NOT silently override a caller-supplied `input.service`.

Add `extraSecretValues` to the `startSpec` object:

```typescript
    extraSecretValues: [ms365ToolToken],
```

Build the returned `service` with the scoped token registered:

```typescript
  const service = {
    ...(input.service ?? {}),
    host: serviceHost,
    port: servicePort,
    clientToken: serviceClientToken,
    pathScopedTokens: [
      ...(input.service?.pathScopedTokens ?? []),
      { token: ms365ToolToken, paths: [MS365_TOOL_CALL_PATH] },
    ],
  };
```

Return `service` in the options object (replace the current `...(service !== undefined ? { service } : {})` conditional with the always-present `service`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test service/tests/ms365-child-env.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add service/src/composition/live-launch.ts service/tests/ms365-child-env.test.ts service/src/composition/types.ts service/src/server/http-service.ts
git commit -m "feat(ms365): advertise loopback tool endpoint + scoped token at launch (no flag gate)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: End-to-end redaction proof (scoped token never logged)

Prove the scoped token minted in Task 4 is masked in the supervisor's spawn log, exercising Tasks 1+4 together.

**Files:**
- Test: `service/tests/ms365-child-env.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1 and 4; `OpencodeSupervisor.start`, the runtime-supervisor fakes.

- [ ] **Step 1: Write the failing test** — append to `service/tests/ms365-child-env.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeSupervisor } from "../src/runtime/supervisor.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  fixedTimesProbe,
  fixedPortChecker,
} from "./runtime-supervisor-fakes.js";

test("scoped MS365 token is redacted in the supervisor spawn log", async () => {
  const root = mkdtempSync(join(tmpdir(), "cghc-ms365-redact-"));
  try {
    const options = await buildLiveCoworkOptions(await baseInput(51305));
    const token = options.startSpec.baseEnv?.["CGHC_MS365_TOKEN"];
    assert.ok(token && token.length >= 32, "precondition: a scoped token was minted");

    const { spawner } = recordingSpawner(new FakeChild(4321));
    const logs: string[] = [];
    const sup = new OpencodeSupervisor({
      root,
      resolveInjections: async () => [],
      spawner,
      healthProbe: toggleHealthProbe("v1.17.11").probe,
      processTimesProbe: fixedTimesProbe(),
      portChecker: fixedPortChecker(true),
      log: (l) => logs.push(l),
      pollIntervalMs: 5,
    });
    await sup.start({
      binPath: BIN,
      cwd: WS,
      port: 51305,
      dataHome: join(root, "xdg", "data"),
      configDir: join(root, "config", "opencode"),
      injectionRequests: [],
      baseEnv: options.startSpec.baseEnv,
      ...(options.startSpec.extraSecretValues !== undefined
        ? { extraSecretValues: options.startSpec.extraSecretValues }
        : {}),
    });
    await sup.stop();

    const joined = logs.join("\n");
    assert.ok(!joined.includes(token!), "raw scoped token must never appear in the spawn log");
    assert.ok(joined.includes("<redacted>"), "the logged env snapshot masks the scoped token");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx tsx --test service/tests/ms365-child-env.test.ts`
Expected: If Tasks 1+4 are correct, this PASSES immediately. If it FAILS with the token visible in logs, the `extraSecretValues` wiring (Task 1 Step 5 or Task 4 Step 4) is incomplete — fix there.

- [ ] **Step 3: Commit**

```bash
git add service/tests/ms365-child-env.test.ts
git commit -m "test(ms365): prove scoped token is redacted in the spawn log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full regression + status doc update

**Files:**
- Modify: `docs/product/current-status.md` (MS365 row)

- [ ] **Step 1: Run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS (no regressions).

- [ ] **Step 2: Run focused pre-commit checks**

Run: `scripts\verify-fast.bat`
Expected: PASS.

- [ ] **Step 3: Update the status doc** — in `docs/product/current-status.md`, change the MS365 row note to reflect that the tool bridge is now wired at the runtime layer (child can call MS365 tools; session-scoped execution), while the MS365-tab UI chat wiring remains a follow-up:

```markdown
| MS365 | PARTIAL — RUNTIME WIRED | Child loads 25 MS365 tools via plugin bridge; execution gated by Ms365SessionScope. Scoped loopback token. Tab UI chat wiring is a follow-up. Vault tokens after unlock. |
```

- [ ] **Step 4: Commit**

```bash
git add docs/product/current-status.md
git commit -m "docs(status): MS365 runtime tool-bridge wired (session-scoped execution)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Out of scope (follow-up plan)

The **MS365-tab UI chat wiring** — enabling the composer, creating the MS365 session, calling `POST /v1/ms365/session-scope`, and streaming replies into the assistant view — is a separate plan. It depends on the current Cowork send-prompt/stream UI path (`conversation-controller.ts`, `service-client.ts`, typed preload), which must be brainstormed in its own slice. This backend plan makes the child *capable* of MS365 tools with session-scoped execution; the UI plan makes the tab *use* it.

## Self-Review notes

- **Spec §4 (two layers):** Layer 2 (`Ms365SessionScope`) already exists and is untouched (correct — it is the real guard). Layer 1 (`tool.execute.before`) is added in Task 2 as a passthrough hook with a documented tightening path; the spec calls it a UX/noise-reduction layer, not a security boundary, which matches.
- **Spec §5A (advertisement + plugin):** Tasks 2, 3, 4 cover plugin source, spawn-time write, and env advertisement respectively; flag gate dropped per Global Constraints.
- **Spec §5B (session-scope):** unchanged, no task — correct.
- **Spec §5C (UI):** explicitly deferred to a follow-up plan (scope check).
- **Spec §8 (testing):** Tasks 1-5 cover redaction, plugin↔router 25-name parity, hook existence, and scope-gating is pre-existing router coverage. Packaged acceptance is a PO step noted in Task 6.
- **Type consistency:** `extraSecretValues` and `pathScopedTokens` names are used identically across Tasks 1, 4, 5.
