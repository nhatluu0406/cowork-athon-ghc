# MS365 #2: /disconnect revoke-all session scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On MS365 disconnect, clear the entire `Ms365SessionScope` so no session retains tool access — a backend defense-in-depth layer on top of the UI's per-session revoke.

**Architecture:** Add `revokeAll()` to `Ms365SessionScope` (clears the in-memory `Set`), and call it in the `/v1/ms365/disconnect` handler before `connector.disconnect()`. Backend-only; the endpoint and contract are unchanged (behavior-only change).

**Tech Stack:** TypeScript, `node --test` via `tsx`.

## Global Constraints

- Backend-only: touch `service/src/ms365/ms365-session-scope.ts` + `service/src/ms365/ms365-tool-router.ts` + their tests. NO contract / renderer / controller / connector change.
- In the disconnect handler, call `revokeAll()` BEFORE `connector.disconnect()` (revoke tool access before dropping the Graph connection; fail-safe if disconnect throws).
- `revokeAll()` never throws (just `Set.clear()`); idempotent when the scope is empty.
- Fail-closed guard `sessionAllowed` at `handleToolCall` is unchanged — this only guarantees the scope is empty after disconnect.
- Gate = focused ms365 tests pass + typecheck GREEN. Do NOT run the full suite (pre-existing failures + `Merge/` glob noise). Commit on `main` per user consent; do not push. Stage NAMED files only — never `git add -A`/`.` (untracked `Merge/` dir must never be committed).

---

### Task 1: revokeAll() on Ms365SessionScope + call it on disconnect

**Files:**
- Modify: `service/src/ms365/ms365-session-scope.ts` (add `revokeAll` to interface + factory)
- Modify: `service/src/ms365/ms365-tool-router.ts` (call `revokeAll` in the disconnect handler)
- Test: `service/tests/ms365-session-scope.test.ts` (revokeAll unit)
- Test: `service/tests/ms365-tool-router.test.ts` (disconnect clears scope)

**Interfaces:**
- Consumes: existing `Ms365SessionScope { allow; revoke; isAllowed }`; existing router `deps.sessionScope` + the `MS365_DISCONNECT_PATH` handler that calls `deps.connector.disconnect()`.
- Produces: `Ms365SessionScope.revokeAll(): void` (clears all allowed session ids). Disconnect handler now empties the scope.

- [ ] **Step 1: Write the failing unit test**

Add to `service/tests/ms365-session-scope.test.ts` (create the file if it does not exist, matching the repo's `node --test` style; if it exists, append):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365SessionScope } from "../src/ms365/ms365-session-scope.js";

test("revokeAll clears every allowed session", () => {
  const scope = createMs365SessionScope();
  scope.allow("a");
  scope.allow("b");
  assert.equal(scope.isAllowed("a"), true);
  assert.equal(scope.isAllowed("b"), true);
  scope.revokeAll();
  assert.equal(scope.isAllowed("a"), false);
  assert.equal(scope.isAllowed("b"), false);
});

test("revokeAll on an empty scope is a no-op (idempotent)", () => {
  const scope = createMs365SessionScope();
  scope.revokeAll();
  scope.revokeAll();
  assert.equal(scope.isAllowed("x"), false);
});
```

- [ ] **Step 2: Run it — verify FAIL**

Run: `npx tsx --test service/tests/ms365-session-scope.test.ts`
Expected: FAIL — `scope.revokeAll is not a function` (method not defined yet).

- [ ] **Step 3: Add revokeAll to the interface + factory**

In `service/src/ms365/ms365-session-scope.ts`, add `revokeAll(): void;` to the interface (after `revoke`) and implement it in the returned object:

```ts
export interface Ms365SessionScope {
  allow(sessionId: string): void;
  revoke(sessionId: string): void;
  revokeAll(): void;
  isAllowed(sessionId: string): boolean;
}

export function createMs365SessionScope(): Ms365SessionScope {
  const allowed = new Set<string>();
  return {
    allow(sessionId: string): void {
      allowed.add(sessionId);
    },
    revoke(sessionId: string): void {
      allowed.delete(sessionId);
    },
    revokeAll(): void {
      allowed.clear();
    },
    isAllowed(sessionId: string): boolean {
      return allowed.has(sessionId);
    },
  };
}
```

- [ ] **Step 4: Run it — verify PASS**

Run: `npx tsx --test service/tests/ms365-session-scope.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Write the failing router test**

In `service/tests/ms365-tool-router.test.ts`, the existing `router(overrides?)` helper hides its `sessionScope`. Add a small local helper + test that builds the router with an accessible scope. Append:

```ts
import { MS365_DISCONNECT_PATH } from "../src/ms365/index.js";

test("disconnect revokes ALL sessions in the scope", async () => {
  const scope = createMs365SessionScope();
  scope.allow("s1");
  scope.allow("s2");
  let connectorDisconnected = false;
  const r = createMs365Router({
    tools: { sharepoint: recordingSharePoint(), connectionState: () => "connected", gate: gateFixture(), now: () => "t", writeMode: () => "manual" as const, sessionAllowed: (id) => scope.isAllowed(id) },
    connector: fakeConnector({ disconnect: async () => { connectorDisconnected = true; } }),
    scopes: ["Sites.Read.All"],
    siteScope: fakeSiteScope(),
    writeMode: fakeWriteMode(),
    sessionScope: scope,
  });
  const route = r.routes.find((route) => route.method === "POST" && "path" in route && route.path === MS365_DISCONNECT_PATH);
  assert.ok(route && "handler" in route);
  await route.handler(ctx("POST", MS365_DISCONNECT_PATH));
  assert.equal(scope.isAllowed("s1"), false, "s1 revoked on disconnect");
  assert.equal(scope.isAllowed("s2"), false, "s2 revoked on disconnect");
  assert.equal(connectorDisconnected, true, "connector.disconnect still called");
});
```

Notes for the implementer:
- `createMs365SessionScope`, `recordingSharePoint`, `gateFixture`, `fakeConnector`, `fakeSiteScope`, `fakeWriteMode`, `ctx`, `createMs365Router` are all already imported/defined in this test file (see the existing `router()` helper). Reuse them — do NOT redefine.
- `MS365_DISCONNECT_PATH` may not yet be imported in this test; add it to the existing `import { … } from "../src/ms365/index.js";` line (confirm it is exported from that barrel — it is exported from `ms365-tool-router.ts`; if the barrel does not re-export it, import from `../src/ms365/ms365-tool-router.js` instead. Grep first.).
- `fakeConnector(overrides)` already spreads `Partial<Ms365Connector>` over defaults (the default `disconnect` is `async () => {}`), so passing `{ disconnect: … }` works.

- [ ] **Step 6: Run it — verify FAIL**

Run: `npx tsx --test service/tests/ms365-tool-router.test.ts`
Expected: FAIL — `scope.isAllowed("s1")` is still `true` after disconnect (handler doesn't revoke yet).

- [ ] **Step 7: Call revokeAll in the disconnect handler**

In `service/src/ms365/ms365-tool-router.ts`, the `MS365_DISCONNECT_PATH` handler currently is:

```ts
        handler: async (): Promise<RouteResult<Ms365ViewData>> => {
          await deps.connector.disconnect();
          return { status: 200, data: buildMs365View(deps.connector, deps.scopes) };
        },
```

Change it to revoke the whole scope BEFORE dropping the connection:

```ts
        handler: async (): Promise<RouteResult<Ms365ViewData>> => {
          // Defense-in-depth: clear every MS365-scoped session so no session retains tool
          // access after disconnect (independent of the UI's per-session revoke). Done BEFORE
          // connector.disconnect() so tool access is revoked even if disconnect throws.
          deps.sessionScope.revokeAll();
          await deps.connector.disconnect();
          return { status: 200, data: buildMs365View(deps.connector, deps.scopes) };
        },
```

- [ ] **Step 8: Run both test files — verify PASS**

Run: `npx tsx --test service/tests/ms365-session-scope.test.ts service/tests/ms365-tool-router.test.ts`
Expected: PASS (revokeAll unit + disconnect-revokes-all + all pre-existing router tests).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: GREEN, no new errors in touched files.

- [ ] **Step 10: Commit**

```bash
git add service/src/ms365/ms365-session-scope.ts service/src/ms365/ms365-tool-router.ts service/tests/ms365-session-scope.test.ts service/tests/ms365-tool-router.test.ts
git commit -m "feat(ms365): revoke all session scope on /disconnect (defense-in-depth)"
```

---

## Self-Review

**Spec coverage:**
- §1 in-scope: `revokeAll()` on interface+factory → Step 3; call before `connector.disconnect()` → Step 7. ✅
- §2 decisions: location (disconnect handler), API (`revokeAll(): void`), order (revoke before disconnect, Step 7 comment + code), contract unchanged (no contract file touched), renderer/controller unchanged (not in file list). ✅
- §5 error handling: revokeAll no-throw / idempotent → Step 1 second test; fail-safe order → Step 7. ✅
- §6 testing 1-4: revokeAll unit (Steps 1-4), disconnect clears scope + connector still called (Steps 5-8), regression (Steps 8-9). Item 3 (strict order-assert) folded into the disconnect test asserting both effects happened — a separate connector-observes-empty-scope assertion is optional and omitted for YAGNI; the code order is fixed + commented. ✅
- §7 review: whole-branch independent review (security boundary). ✅

**Placeholder scan:** no TBD/TODO; every code step has complete code; the "grep the barrel for MS365_DISCONNECT_PATH" note carries a concrete fallback import path.

**Type consistency:** `revokeAll(): void` identical in interface, factory, and both call sites (test + handler). `Ms365SessionScope` shape matches the existing `allow`/`revoke`/`isAllowed`. Router deps `sessionScope` already typed as `Ms365SessionScope`, so `deps.sessionScope.revokeAll()` type-checks once Step 3 lands.

## Execution Handoff

Will offer execution choice after saving.
