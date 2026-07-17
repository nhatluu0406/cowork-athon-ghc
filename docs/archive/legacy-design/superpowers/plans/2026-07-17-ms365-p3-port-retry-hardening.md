# MS365 P3: Port-in-use retry hardening + document plugin-gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry live-service launch on unambiguous port-busy signals (fresh ephemeral ports each attempt), and document the MS365 plugin `tool.execute.before` seam as an intentional no-op.

**Architecture:** Shell-only. Wrap a bounded retry loop around `resolveOptions()` + `startLive()` inside `createLiveStartService` (`app/shell/src/service/live-service-adapter.ts`). Retry only when `err.code` is `"runtime_port_in_use"` (child OpenCode port) or `"EADDRINUSE"` (service socket) — never on health-timeout/spawn-fail. Each retry re-runs `resolveOptions()` which mints a fresh supervisor + fresh ports, sidestepping the single-shot supervisor.

**Tech Stack:** TypeScript, `node --test` via `tsx`. No framework.

## Global Constraints

- Shell-only: touch `app/shell/src/service/live-service-adapter.ts` + its test + `docs/quality/known-limitations.md`. NO service package / contract / supervisor / router / gate change.
- Retry ONLY on `err.code === "runtime_port_in_use"` OR `err.code === "EADDRINUSE"`. NEVER retry `runtime_health_timeout`, `runtime_spawn_failed`, `ServiceLaunchNotConfiguredError`, or any other error.
- Detect via `err.code` PROPERTY read (not `instanceof`) — the error crosses the service→shell package boundary.
- `maxAttempts` default 3; injectable via an OPTIONAL third parameter so the existing 1-arg call site (`main.ts:169`) and 2-arg tests keep working unchanged.
- No sleep between attempts (fresh ephemeral port each time).
- Retry re-runs `resolveOptions()` every attempt (fresh supervisor + ports); it must NOT reuse a supervisor that already threw (single-shot).
- Gate = focused shell test passes + typecheck GREEN. Do NOT run the full suite (pre-existing failures + `Merge/` glob noise). Commit on `main` per user consent; do not push.

---

### Task 1: Bounded port-in-use retry in createLiveStartService

**Files:**
- Modify: `app/shell/src/service/live-service-adapter.ts`
- Test: `app/shell/tests/live-service-adapter.test.ts`

**Interfaces:**
- Consumes: `ResolveLiveOptions = () => Promise<LiveCoworkServiceOptions>`, `StartLiveService = (options) => Promise<LiveCoworkService>`, `toStartedService(live)` (all already in the file).
- Produces: `createLiveStartService(resolveOptions, startLive?, opts?)` where `opts?: { maxAttempts?: number; log?: (line: string) => void }`. Behavior: on each attempt run `resolveOptions()` then `startLive()`; if it throws and `isPortInUse(err)` and attempts remain, retry; otherwise rethrow. Default `maxAttempts = 3`, default `log` = no-op. Also exports nothing new publicly beyond the widened signature (isPortInUse stays module-private).

- [ ] **Step 1: Write the failing tests**

Add these tests to `app/shell/tests/live-service-adapter.test.ts` (append after the existing tests; reuse the existing `fakeLive()` helper and imports already at the top of the file). Use verbatim:

```ts
test("retries once on runtime_port_in_use then succeeds (fresh options each attempt)", async () => {
  const { live } = fakeLive();
  let resolveCalls = 0;
  let startCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      return { workspaceId: `C:/ws-${resolveCalls}` } as unknown as LiveCoworkServiceOptions;
    },
    async () => {
      startCalls += 1;
      if (startCalls === 1) throw { code: "runtime_port_in_use" };
      return live;
    },
  );
  const started = await startService();
  assert.equal(started.baseUrl, BASE_URL);
  assert.equal(resolveCalls, 2, "resolveOptions re-run on retry → fresh supervisor + ports");
  assert.equal(startCalls, 2);
});

test("retries on a raw EADDRINUSE from the service socket", async () => {
  const { live } = fakeLive();
  let startCalls = 0;
  const startService = createLiveStartService(
    async () => ({ workspaceId: "C:/ws" }) as unknown as LiveCoworkServiceOptions,
    async () => {
      startCalls += 1;
      if (startCalls === 1) throw { code: "EADDRINUSE" };
      return live;
    },
  );
  const started = await startService();
  assert.equal(started.baseUrl, BASE_URL);
  assert.equal(startCalls, 2);
});

test("exhausts maxAttempts on persistent port-in-use, then throws the last error", async () => {
  let resolveCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      return { workspaceId: "C:/ws" } as unknown as LiveCoworkServiceOptions;
    },
    async () => {
      throw { code: "runtime_port_in_use" };
    },
    { maxAttempts: 3 },
  );
  await assert.rejects(startService(), (err: unknown) => {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "runtime_port_in_use";
  });
  assert.equal(resolveCalls, 3, "tried exactly maxAttempts times");
});

test("does NOT retry a health-timeout (masking a broken binary would be worse)", async () => {
  let resolveCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      return { workspaceId: "C:/ws" } as unknown as LiveCoworkServiceOptions;
    },
    async () => {
      throw { code: "runtime_health_timeout" };
    },
  );
  await assert.rejects(startService(), (err: unknown) => {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "runtime_health_timeout";
  });
  assert.equal(resolveCalls, 1, "no retry → resolveOptions called exactly once");
});

test("a not-configured resolver rejection is not retried", async () => {
  let resolveCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      throw new ServiceLaunchNotConfiguredError();
    },
    async () => fakeLive().live,
  );
  await assert.rejects(startService(), (err: unknown) => err instanceof ServiceLaunchNotConfiguredError);
  assert.equal(resolveCalls, 1, "not-configured is honest terminal, never retried");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test app/shell/tests/live-service-adapter.test.ts`
Expected: the new tests FAIL (current code has no retry: the port-in-use test rethrows on the first attempt; `resolveCalls`/`startCalls` stay at 1). The pre-existing tests still pass.

- [ ] **Step 3: Implement the retry loop**

In `app/shell/src/service/live-service-adapter.ts`, replace the existing `createLiveStartService` function (lines 45-54) with:

```ts
/** Options controlling the launch retry policy. */
export interface LiveStartOptions {
  /** Max launch attempts before giving up (default 3). */
  readonly maxAttempts?: number;
  /** Non-secret log sink for retry telemetry (default: no-op). */
  readonly log?: (line: string) => void;
}

/**
 * A port-busy signal we may safely retry: the child OpenCode port pre-check
 * (`runtime_port_in_use`) or the service socket bind (`EADDRINUSE`). We read `err.code`
 * as a property — NOT `instanceof` — because the typed error crosses the service→shell
 * package boundary. Health-timeout / spawn-fail are NOT retried: retrying them would mask
 * a genuinely broken binary/pin and slow an honest failure by N attempts.
 */
function isPortInUse(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "runtime_port_in_use" || code === "EADDRINUSE";
}

/**
 * Build the default shell StartService: resolve launch options, start the live service, and
 * normalize the handle. `startLive` defaults to the real `startLiveCoworkService`.
 *
 * A rare TOCTOU race exists between ephemeral-port allocation and the child/service bind: a
 * port picked by `allocateLoopbackPort` (bind 0 → read → close) can be taken by another
 * process before the real bind. On an unambiguous port-busy signal we re-run `resolveOptions()`
 * (which mints a FRESH supervisor + fresh ports — the supervisor is single-shot) and retry, up
 * to `maxAttempts`. Any other failure propagates immediately.
 */
export function createLiveStartService(
  resolveOptions: ResolveLiveOptions,
  startLive: StartLiveService = startLiveCoworkService,
  opts: LiveStartOptions = {},
): StartService {
  const maxAttempts = opts.maxAttempts ?? 3;
  const log = opts.log ?? ((): void => {});
  return async (): Promise<StartedService> => {
    for (let attempt = 1; ; attempt += 1) {
      const options = await resolveOptions();
      try {
        const live = await startLive(options);
        return toStartedService(live);
      } catch (err) {
        if (isPortInUse(err) && attempt < maxAttempts) {
          log(`live_start_port_retry attempt=${attempt}`);
          continue;
        }
        throw err;
      }
    }
  };
}
```

Note: `resolveOptions()` runs INSIDE the loop so each attempt gets fresh options. A `ServiceLaunchNotConfiguredError` (or any non-port error) thrown by `resolveOptions()` propagates out of the async function directly — it is not caught by the inner try (which wraps only `startLive`), so it is never retried. This matches the not-configured test.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test app/shell/tests/live-service-adapter.test.ts`
Expected: PASS (all new tests + the 4 pre-existing tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: GREEN, no new errors. Confirm the 1-arg call site `app/shell/src/main.ts:169` (`createLiveStartService(createLiveOptionsResolver(liveSource))`) still type-checks (the third param is optional).

- [ ] **Step 6: Commit**

```bash
git add app/shell/src/service/live-service-adapter.ts app/shell/tests/live-service-adapter.test.ts
git commit -m "feat(ms365): bounded port-in-use retry on live-service launch"
```

---

### Task 2: Document the plugin-gate seam as an intentional no-op

**Files:**
- Modify: `docs/quality/known-limitations.md`

**Interfaces:** none (doc only).

- [ ] **Step 1: Read the current known-limitations doc**

Read `docs/quality/known-limitations.md` to match its existing heading style and language (it is Vietnamese-leaning per the repo; follow the file's actual convention). Note where MS365-related limitations live (e.g. the existing file-delete limitation).

- [ ] **Step 2: Add the plugin-gate seam entry**

Add a short entry (match the file's existing section format). Content to convey (adapt wording to the file's style, keep it factual and non-secret):

- The MS365 OpenCode plugin's `tool.execute.before` hook (`service/src/runtime/ms365-plugin-file.ts`) is an **intentional no-op passthrough**, not a security gate.
- Reason: the child process cannot read its own session's MS365 scope, so any decision made in-process would be a guess. The real, fail-closed authorization boundary is `Ms365SessionScope` in the router (`service/src/ms365/ms365-tool-router.ts`), which rejects any tool call from a session that is not MS365-scoped.
- The hook is kept as a RESERVED SEAM (documented in the source): if the child ever learns its own scope, it could become an early friendly block. Adding a gate there today would be security theater. No action needed.

- [ ] **Step 3: Verify no code/typecheck impact + commit**

Run: `npm run typecheck`
Expected: GREEN (doc-only change; confirm nothing else was touched).

```bash
git add docs/quality/known-limitations.md
git commit -m "docs(ms365): document plugin tool.execute.before as intentional no-op seam"
```

---

## Self-Review

**Spec coverage:**
- §1 finding #1-4 (port race + retry seam) → Task 1. ✅
- §1 finding #5 (plugin no-op) → Task 2. ✅
- §2 decisions: retry location (Task 1 createLiveStartService), both codes (Task 1 isPortInUse), no-retry set (Task 1 tests 4-5 + note), maxAttempts default 3 injectable (Task 1 LiveStartOptions), err.code property (Task 1 isPortInUse), no sleep (Task 1 loop has none), plugin doc-only (Task 2). ✅
- §5 error handling → Task 1 tests + the propagation note. ✅
- §6 testing items 1-6 → Task 1 Step 1 five tests + backward-compat (item 6) covered by the pre-existing 1/2-arg tests still passing; regression → Steps 4-5. ✅
- §7 review → whole-branch independent review (runtime/process launch). ✅

**Placeholder scan:** no TBD/TODO; Task 1 has complete code; Task 2 is doc prose (adapt-to-file-style is a legitimate instruction with the exact facts to convey). No code step lacks code.

**Type consistency:** `LiveStartOptions` used consistently; `isPortInUse(err: unknown): boolean` module-private; `createLiveStartService(resolveOptions, startLive?, opts?)` third param optional preserves both call forms; `toStartedService`/`ResolveLiveOptions`/`StartLiveService` reused, not redefined.

## Execution Handoff

Will offer execution choice after saving.
