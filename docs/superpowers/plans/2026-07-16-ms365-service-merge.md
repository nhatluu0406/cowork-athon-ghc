# MS365 Service Layer Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the MS365 backend service layer from the untracked `Merge/` snapshot into the `main` tree and remove all handling of the `CGHC_MS365_ENABLED` flag, leaving the OpenCode runtime wiring and the UI shell for a later pass.

**Architecture:** "Cách A" — a manual, layered port. Pure MS365 service files (confirmed to have zero OpenCode coupling) are copied verbatim from `Merge/service/src/ms365/` and `Merge/service/tests/`. The three `main` files that reference the removed flag (`ms365/index.ts`, `composition/compose-service.ts`, `composition/live-launch.ts`) are hand-edited so the MS365 SharePoint router mounts unconditionally and no `CGHC_MS365_ENABLED` / `CGHC_MS365_TOKEN` / `CGHC_MS365_TOOL_ENDPOINT` handling remains.

**Tech Stack:** TypeScript (Node ESM, `.js` import specifiers), `node --test` via `tsx`, git (bash tool for POSIX file ops on Windows).

## Global Constraints

- **Source of truth for copy:** `c:\Users\HuyTT12\Downloads\AI-Workspace\cowork-athon-ghc\Merge\`. Repo root is `c:\Users\HuyTT12\Downloads\AI-Workspace\cowork-athon-ghc`. All paths below are repo-relative unless stated.
- **Do NOT touch (deferred this pass):** `service/src/runtime/*` (supervisor, opencode-config, ms365-plugin-file, supervisor-types), `runtime/src/launch-config.ts`, `service/src/server/http-service.ts`, the entire UI shell (`app/ui/src/app-shell.ts`, `dispatch-plan.ts`, `service-client.ts`, `commercial.css`, `app/ui/src/ui-shell/microsoft/*`, `ms365-write-mode-control.ts`, UI tests), `package-lock.json`, `runtime/package.json`.
- **Do NOT copy these four OpenCode-coupled tests:** `ms365-child-env.test.ts`, `ms365-supervisor-flag-predicate.test.ts`, `ms365-plugin-file.test.ts`, `opencode-config.test.ts`.
- **Do NOT delete** `service/src/ms365/device-code-provider.ts` (exists only on `main`; keep it).
- **Flag decisions:** remove `CGHC_MS365_ENABLED` entirely (and its `isMs365Enabled` predicate); `CGHC_MS365_TOKEN` and `CGHC_MS365_TOOL_ENDPOINT` are removed with the OpenCode child-env block. Keep `CGHC_MS365_CLIENT_ID`, `CGHC_MS365_TENANT`, and `readMs365DeviceConfig`.
- **Build not required this pass:** a green `npm run typecheck` / `npm test` is explicitly NOT a gate (Product Owner: "chưa cần phải build"). Wiring the new services, restoring OpenCode, and going green happen in the follow-up pass. Each task still commits its own coherent slice.
- **Never push.** Commit locally only.

---

## File Structure

**Copied verbatim (Task 1):** all files under `Merge/service/src/ms365/` overwrite/create their counterparts under `service/src/ms365/`; the 27 non-OpenCode tests under `Merge/service/tests/ms365-*` copy to `service/tests/`.

**Hand-edited (Tasks 2–4):**
- `service/src/ms365/index.ts` — barrel: add new service exports, remove `isMs365Enabled`, keep `readMs365DeviceConfig`. (Task 1 already overwrites it via copy; Task 2 removes the flag function.)
- `service/src/composition/compose-service.ts` — mount MS365 router unconditionally; drop `isMs365Enabled`.
- `service/src/composition/live-launch.ts` — delete the MS365 child-env advertisement block and its now-dead helpers/imports.

---

### Task 1: Copy the pure MS365 service files and tests

**Files:**
- Create/Modify (copy from `Merge/`): all of `service/src/ms365/*.ts` that exist in `Merge/service/src/ms365/`
- Create (copy from `Merge/`): the 27 non-OpenCode `service/tests/ms365-*.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the MS365 service modules and barrel (`service/src/ms365/index.js`) exporting — among others — `createOutlookService`, `createPlannerService`, `createListsService`, `createTeamsService`, `createSiteScopeStore`, `createSiteScopeService`, `createSiteScopeFilePersistence`, `createWriteModeStore`, `createWriteModeFilePersistence`, `createMs365SessionScope`, plus the existing `createMs365Connector`, `createSharePointService`, `createMs365Router`, `createHttpGraphClient`, `createManualTokenProvider`, `createDeviceCodeProvider`. **Note:** after this copy the barrel still contains `isMs365Enabled` (removed in Task 2) and now also `readMs365DeviceConfig`.

- [ ] **Step 1: Copy every MS365 service source file from `Merge/`**

Run (bash tool):
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
cp Merge/service/src/ms365/*.ts service/src/ms365/
```

This overwrites the 9 changed files (`graph-client.ts`, `ms365-connector.ts`, `ms365-errors.ts`, `ms365-tool-router.ts`, `ms365-tools.ts`, `ms365-view.ts`, `sharepoint-service.ts`, `token-provider.ts`, `index.ts`) and creates the 13 new files (`lists-service.ts`, `planner-service.ts`, `outlook-service.ts`, `teams-service.ts`, `site-scope-service.ts`, `site-scope-store.ts`, `site-scope-file-persistence.ts`, `write-mode-store.ts`, `write-mode-file-persistence.ts`, `ms365-session-scope.ts`, `ms365-batch-tools.ts`, `ms365-gate-wait.ts`, `token-scopes.ts`). `device-code-provider.ts` is untouched (not present in `Merge/`).

- [ ] **Step 2: Verify device-code-provider.ts survived and new files landed**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
ls service/src/ms365/device-code-provider.ts && ls service/src/ms365/planner-service.ts service/src/ms365/teams-service.ts service/src/ms365/write-mode-store.ts
```
Expected: all paths listed, no "No such file" error.

- [ ] **Step 3: Copy the 27 non-OpenCode MS365 tests**

Run (bash tool — explicit list so the 4 deferred tests are excluded):
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
for f in ms365-batch-tools ms365-connector-device ms365-device-config ms365-device-routes \
  ms365-errors ms365-gate-wait ms365-graph-client ms365-lists-service ms365-lists-tool \
  ms365-manual-token ms365-outlook-service ms365-outlook-tool ms365-planner-service \
  ms365-planner-tool ms365-scoped-token ms365-session-scope ms365-sharepoint-site-filter \
  ms365-site-scope-file-persistence ms365-site-scope-service ms365-site-scope-store \
  ms365-sites-routes ms365-sites-tool ms365-teams-service ms365-teams-tool \
  ms365-token-scopes ms365-tool-router ms365-view-redaction ms365-write-mode; do
  cp "Merge/service/tests/$f.test.ts" "service/tests/$f.test.ts"
done
```

- [ ] **Step 4: Confirm the four deferred tests were NOT copied**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
for f in ms365-child-env ms365-supervisor-flag-predicate ms365-plugin-file opencode-config; do
  if [ -f "service/tests/$f.test.ts" ]; then echo "PRESENT-ON-MAIN: $f (ok if pre-existing)"; else echo "ABSENT: $f"; fi
done
```
Expected: these are only skipped from the copy; if any already existed on `main` before this pass, that is fine — the point is we did not import `Merge/`'s OpenCode versions. Do not delete pre-existing files.

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
git add service/src/ms365/ service/tests/
git commit -m "feat(ms365): copy MS365 service layer (Lists/Planner/Outlook/Teams/site-scope/write-mode) from Merge snapshot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Remove `isMs365Enabled` from the MS365 barrel

**Files:**
- Modify: `service/src/ms365/index.ts` (delete the `isMs365Enabled` function + its doc comment)

**Interfaces:**
- Consumes: the barrel produced by Task 1 (which currently still exports `isMs365Enabled` and `readMs365DeviceConfig`).
- Produces: a barrel that NO LONGER exports `isMs365Enabled`, still exports `readMs365DeviceConfig`. This is the breaking change that forces Tasks 3–4 (the `main` files that import `isMs365Enabled` must stop doing so).

- [ ] **Step 1: Confirm the current barrel content around the flag**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -n "isMs365Enabled\|readMs365DeviceConfig" service/src/ms365/index.ts
```
Expected: `isMs365Enabled` defined (function) and `readMs365DeviceConfig` defined (function) — both present after Task 1's copy.

- [ ] **Step 2: Delete the `isMs365Enabled` function and its doc comment**

Edit `service/src/ms365/index.ts`: remove the entire block below (the JSDoc immediately above `isMs365Enabled` through the closing brace of the function). The exact text to remove:

```ts
/**
 * Feature-flag gate for the whole MS365 unit (Task 11). OFF (`false`) unless the env var is
 * EXACTLY `"1"` or `"true"` — every other value, including `undefined`, `"0"`, `"false"`, or
 * any other string, is OFF. This is the ONLY switch the composition root reads to decide
 * whether to construct the connector and mount {@link createMs365Router}; default-OFF keeps
 * the baseline service byte-for-byte unaffected when the var is unset.
 */
export function isMs365Enabled(env: Record<string, string | undefined>): boolean {
  return env.CGHC_MS365_ENABLED === "1" || env.CGHC_MS365_ENABLED === "true";
}
```

Leave `readMs365DeviceConfig` (and everything else) intact.

- [ ] **Step 3: Verify the flag function is gone and device-config remains**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -n "isMs365Enabled" service/src/ms365/index.ts; echo "exit: $?"
grep -n "export function readMs365DeviceConfig" service/src/ms365/index.ts
```
Expected: first grep prints nothing (exit 1 — no match); second grep prints the `readMs365DeviceConfig` line.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
git add service/src/ms365/index.ts
git commit -m "refactor(ms365): drop isMs365Enabled gate predicate from barrel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Mount the MS365 router unconditionally in compose-service

**Files:**
- Modify: `service/src/composition/compose-service.ts` (import list near line 90–98; the `ms365Router` block at lines ~406–435)

**Interfaces:**
- Consumes: the barrel from Task 2 (no `isMs365Enabled`). Still imports `createManualTokenProvider`, `createMs365Connector`, `createHttpGraphClient`, `createSharePointService`, `createMs365Router` from `../ms365/index.js`.
- Produces: `compose-service.ts` that constructs `ms365Router` unconditionally (no ternary, no `isMs365Enabled` reference). The `routers` array spread at line ~501 (`...(ms365Router !== undefined ? [ms365Router] : [])`) still works because `ms365Router` is now always defined — leave that spread as-is (harmless; always includes the router).

- [ ] **Step 1: Confirm the current gated block and import**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -n "isMs365Enabled" service/src/composition/compose-service.ts
```
Expected: line ~97 (`isMs365Enabled,` in the import), line ~406/409 (comment mentions), line ~413 (`const ms365Router = isMs365Enabled(process.env)`).

- [ ] **Step 2: Remove `isMs365Enabled` from the ms365 import block**

Edit `service/src/composition/compose-service.ts`. Change the import block (currently):

```ts
import {
  createHttpGraphClient,
  createManualTokenProvider,
  createMs365Connector,
  createMs365Router,
  createSharePointService,
  isMs365Enabled,
} from "../ms365/index.js";
```

to (drop the `isMs365Enabled,` line):

```ts
import {
  createHttpGraphClient,
  createManualTokenProvider,
  createMs365Connector,
  createMs365Router,
  createSharePointService,
} from "../ms365/index.js";
```

- [ ] **Step 3: Replace the gated `ms365Router` block with an unconditional one**

Edit `service/src/composition/compose-service.ts`. Replace the entire block (the comment + the ternary, currently lines ~406–435):

```ts
  // --- MS365 (SharePoint over Microsoft Graph), Task 11: OFF by default. `isMs365Enabled`
  // reads the SAME `process.env` the rest of this module treats as the environment source
  // (no options field exists for it — Tier 1/Tier 2 env-driven switches all read `process.env`
  // directly, e.g. `readE2eMockLlmBaseUrl` above). With the var unset, `ms365Router` is
  // `undefined` and NOTHING below is constructed or mounted — the baseline is byte-for-byte
  // unaffected. The SAME `ssrf` policy instance built above (line ~105) is reused here; no
  // second SsrfPolicy is created.
  const ms365Router = isMs365Enabled(process.env)
    ? (() => {
        const ms365Manual = createManualTokenProvider({ credentials: credentialService });
        const ms365Connector = createMs365Connector({
          manual: ms365Manual,
          makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
        });
        const sharepoint = createSharePointService({
          connector: ms365Connector,
          files: createWorkspaceLocalFileReader(() => settingsStore.activeWorkspace()?.rootPath),
        });
        return createMs365Router({
          connector: ms365Connector,
          scopes: MS365_SCOPES,
          tools: {
            sharepoint,
            connectionState: () => ms365Connector.connectionState(),
            gate: permissionGate,
            now,
          },
        });
      })()
    : undefined;
```

with this unconditional version:

```ts
  // --- MS365 (SharePoint over Microsoft Graph): the router mounts UNCONDITIONALLY. The former
  // `CGHC_MS365_ENABLED` gate has been removed (2026-07-16 merge); there is no default-OFF switch.
  // The SAME `ssrf` policy instance built above is reused here; no second SsrfPolicy is created.
  const ms365Router = (() => {
    const ms365Manual = createManualTokenProvider({ credentials: credentialService });
    const ms365Connector = createMs365Connector({
      manual: ms365Manual,
      makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
    });
    const sharepoint = createSharePointService({
      connector: ms365Connector,
      files: createWorkspaceLocalFileReader(() => settingsStore.activeWorkspace()?.rootPath),
    });
    return createMs365Router({
      connector: ms365Connector,
      scopes: MS365_SCOPES,
      tools: {
        sharepoint,
        connectionState: () => ms365Connector.connectionState(),
        gate: permissionGate,
        now,
      },
    });
  })();
```

Note: this preserves main's SharePoint-only wiring; the new services (Planner/Outlook/Teams/Lists/site-scope/write-mode/session-scope) remain copied-but-unwired this pass, by design.

- [ ] **Step 4: Verify no `isMs365Enabled` references remain in the file**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -n "isMs365Enabled" service/src/composition/compose-service.ts; echo "exit: $?"
grep -n "const ms365Router" service/src/composition/compose-service.ts
```
Expected: first grep prints nothing (exit 1); second grep shows `const ms365Router = (() => {`.

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
git add service/src/composition/compose-service.ts
git commit -m "refactor(ms365): mount SharePoint router unconditionally (drop CGHC_MS365_ENABLED gate)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Remove the MS365 child-env advertisement from live-launch

**Files:**
- Modify: `service/src/composition/live-launch.ts` (import at line ~60–61; the `ms365Enabled`/`baseEnv` block at ~193–206; the `service` ternary at ~230–235; the dead `ServiceBindPlan` type + `resolveServiceBindPlan` + `ms365ToolEndpointUrl` helpers at ~290–318; the file-level doc comment at ~17–22 referencing MS365)

**Interfaces:**
- Consumes: the barrel from Task 2 (no `isMs365Enabled`).
- Produces: `live-launch.ts` with no `CGHC_MS365_ENABLED` / `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` handling. `baseEnv` falls back to `input.baseEnv`; `service` falls back to `input.service`. `allocateLoopbackPort` remains used (line ~161); `MS365_TOOL_CALL_PATH`, `assertConfiguredToken`, `generateClientToken` imports become unused and are removed.

- [ ] **Step 1: Confirm current MS365 references in the file**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -n "isMs365Enabled\|CGHC_MS365\|servicePlan\|resolveServiceBindPlan\|ms365ToolEndpointUrl\|ServiceBindPlan\|MS365_TOOL_CALL_PATH" service/src/composition/live-launch.ts
```
Expected: matches at import (~60), the flag block (~197–204), the `service` ternary (~233–234), and the helper/type definitions (~290–318).

- [ ] **Step 2: Remove the MS365 imports (keep `MS365`-free imports intact)**

Edit `service/src/composition/live-launch.ts`.

Delete this import line entirely (line ~60):
```ts
import { isMs365Enabled, MS365_TOOL_CALL_PATH } from "../ms365/index.js";
```

Change the token import (line ~61) from:
```ts
import { assertConfiguredToken, generateClientToken } from "../server/token.js";
```
— delete it entirely (both symbols become unused once `resolveServiceBindPlan` is removed in Step 5).

- [ ] **Step 3: Replace the `ms365Enabled` / `baseEnv` block with a plain `baseEnv`**

Replace this block (lines ~193–206):

```ts
  // MS365 child-env advertisement (flag-gated, Task 11 follow-up): resolve the same
  // host/port/clientToken the SERVICE (not the child) will bind to, so the endpoint the child is
  // told about is the endpoint the service actually opens. When the caller already supplied any of
  // these via `input.service`, reuse them as-is (never silently override a caller's choice).
  const ms365Enabled = isMs365Enabled(process.env);
  const servicePlan = ms365Enabled ? await resolveServiceBindPlan(input) : undefined;
  const baseEnv = ms365Enabled
    ? {
        ...(input.baseEnv ?? {}),
        CGHC_MS365_ENABLED: "1",
        CGHC_MS365_TOOL_ENDPOINT: ms365ToolEndpointUrl(servicePlan!),
        CGHC_MS365_TOKEN: servicePlan!.clientToken,
      }
    : input.baseEnv;
```

with:

```ts
  // MS365 child-env advertisement removed (2026-07-16 merge): the OpenCode runtime wiring is
  // deferred, so no MS365 tool endpoint/token is advertised to the child here.
  const baseEnv = input.baseEnv;
```

- [ ] **Step 4: Replace the `service` ternary with a plain pass-through**

Replace this block (lines ~230–235):

```ts
  // When MS365 is enabled, the returned `service` options pin the SAME host/port/clientToken that
  // were advertised to the child above (so the service binds where the child was told to look);
  // otherwise `input.service` is passed through untouched (baseline unaffected when the flag is off).
  const service = servicePlan
    ? { ...(input.service ?? {}), ...servicePlan }
    : input.service;
```

with:

```ts
  // `input.service` is passed through untouched (the MS365 bind-plan advertisement was removed).
  const service = input.service;
```

- [ ] **Step 5: Delete the now-dead `ServiceBindPlan` type and its two helpers**

Delete this entire block (lines ~290–318):

```ts
/** The service host/port/clientToken the MS365 endpoint is advertised against. */
interface ServiceBindPlan {
  readonly host: string;
  readonly port: number;
  readonly clientToken: string;
}

/**
 * Resolve the exact host/port/clientToken the SERVICE (not the OpenCode child) will bind to,
 * reusing any value the caller already fixed via `input.service` and generating the rest. This
 * lets the MS365 advertisement below name the real endpoint even though the service itself binds
 * later (inside `startLiveCoworkService`) — as long as the SAME plan is threaded into the returned
 * `service` options (done by the caller of this function), the service ends up bound exactly there.
 */
async function resolveServiceBindPlan(input: BuildLiveCoworkInput): Promise<ServiceBindPlan> {
  const host = input.service?.host?.trim() || "127.0.0.1";
  const port = input.service?.port ?? (await (input.allocatePort ?? allocateLoopbackPort)());
  const clientToken =
    input.service?.clientToken !== undefined
      ? assertConfiguredToken(input.service.clientToken)
      : generateClientToken();
  return { host, port, clientToken };
}

/** The loopback MS365 tool-call endpoint URL the child is told about (non-secret). */
function ms365ToolEndpointUrl(plan: ServiceBindPlan): string {
  const authority = plan.host.includes(":") ? `[${plan.host}]` : plan.host;
  return `http://${authority}:${plan.port}${MS365_TOOL_CALL_PATH}`;
}
```

- [ ] **Step 6: Update the file-level doc comment that describes the removed behavior**

Find the file-header doc block (lines ~17–22) that describes "MS365 CHILD-ENV ADVERTISEMENT". Remove the MS365-specific paragraph (the lines mentioning `CGHC_MS365_ENABLED`, `isMs365Enabled`, the tool endpoint, and reused token uses). Leave the rest of the header comment intact. If the whole block is solely about the MS365 advertisement, delete the block; otherwise trim just the MS365 sentences.

Run to confirm what to trim:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
sed -n '10,30p' service/src/composition/live-launch.ts
```

- [ ] **Step 7: Verify no MS365 / dead-symbol references remain**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -n "isMs365Enabled\|CGHC_MS365\|servicePlan\|resolveServiceBindPlan\|ms365ToolEndpointUrl\|ServiceBindPlan\|MS365_TOOL_CALL_PATH\|assertConfiguredToken\|generateClientToken" service/src/composition/live-launch.ts; echo "exit: $?"
grep -n "allocateLoopbackPort" service/src/composition/live-launch.ts
```
Expected: first grep prints nothing (exit 1 — all removed); second grep still shows `allocateLoopbackPort` used at line ~161 and defined at ~333 (kept).

- [ ] **Step 8: Commit**

```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
git add service/src/composition/live-launch.ts
git commit -m "refactor(ms365): remove MS365 child-env advertisement + dead bind-plan helpers from live-launch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Final sweep — confirm no `CGHC_MS365_ENABLED` handling remains in service source

**Files:**
- No edits expected. This task is a verification gate + a summary commit if any stray reference is found.

**Interfaces:**
- Consumes: results of Tasks 1–4.
- Produces: confirmation that `service/src/**` (excluding the deferred `runtime/` and `server/http-service.ts`, and excluding copied test fixtures) contains no `isMs365Enabled` / `CGHC_MS365_ENABLED` handling.

- [ ] **Step 1: Sweep the service source (excluding deferred OpenCode paths)**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -rn "isMs365Enabled\|CGHC_MS365_ENABLED" service/src \
  --include=*.ts | grep -v "service/src/runtime/" | grep -v "service/src/server/http-service.ts"
echo "exit: $?"
```
Expected: prints nothing (exit 1). If any line prints, it is a stray non-deferred reference — remove it the same way as Tasks 3/4 (drop the import/usage, keep behavior unconditional), then re-run.

- [ ] **Step 2: Confirm the deferred OpenCode files were NOT modified**

Run:
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
git status --short service/src/runtime/ runtime/src/ service/src/server/http-service.ts app/ui/
```
Expected: prints nothing (no staged/unstaged changes to deferred areas).

- [ ] **Step 3: (Optional) note remaining flag references in deferred code**

Run (informational — do NOT edit these; they belong to the deferred OpenCode pass):
```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
grep -rn "CGHC_MS365_ENABLED\|isMs365Enabled" service/src/runtime service/src/server/http-service.ts runtime/src 2>/dev/null | head
```
Any hits here are expected to be addressed in the follow-up OpenCode pass, not now.

- [ ] **Step 4: (No commit needed unless Step 1 required a fix.)** If a stray reference was fixed, commit:

```bash
cd "c:/Users/HuyTT12/Downloads/AI-Workspace/cowork-athon-ghc"
git add -A service/src
git commit -m "chore(ms365): remove stray CGHC_MS365_ENABLED reference found in final sweep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the follow-up pass (out of scope here)

- Wire the copied services (Planner/Outlook/Teams/Lists/site-scope/write-mode/session-scope) into `compose-service.ts`'s `createMs365Router` `tools` object and its router deps.
- Restore the OpenCode runtime (supervisor plugin-file, opencode-config) **on top of main's current skills-permission code**, NOT `Merge/`'s older fork.
- Port the UI shell (`app-shell.ts`, `dispatch-plan.ts` MS365 orchestration policy, `service-client.ts`, CSS, `microsoft/*`, write-mode control).
- Take `npm run typecheck` and `npm test` green.
