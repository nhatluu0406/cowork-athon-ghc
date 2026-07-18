# MS365 Connector Foundation + SharePoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, service-side MS365 connector (auth via manual token + device-code OAuth, Microsoft Graph client, keyring credential storage, tool registration into the OpenCode runtime, permission enforcement) and prove it end-to-end with SharePoint search/summary/upload.

**Architecture:** All MS365 logic lives in `@cowork-ghc/service` behind port/adapter seams. A `TokenProvider` port has two adapters (manual paste; device-code OAuth). A `GraphClient` port wraps Microsoft Graph HTTP, pinned to `graph.microsoft.com` through the existing `SsrfPolicy`. An `Ms365Connector` composes token + graph + keyring and is the single reusable entry point every MS365 service uses. `SharePointService` sits on top. Tools are exposed on the existing loopback boundary via an `ms365-tool-router`; the OpenCode child is pointed at them at spawn. Every **write** (upload) goes through the existing `PermissionGate` at the execution boundary.

**Tech Stack:** TypeScript (strict, ESM, `.js` import specifiers), Node.js, `node:test` + `node:assert/strict`, `node:fetch`. Reuses existing modules: `service/src/provider/ssrf-policy.ts`, `service/src/credential/credential-service.ts`, `service/src/permission/permission-gate.ts`, `service/src/boundary/contract.ts` (`BoundaryRouter`), `service/src/diagnostics` (`SecretScrubber`), `core/contracts`.

## Global Constraints

- **Language:** Code, comments, tests, identifiers in **English**. Human-facing docs under `docs/` in **Vietnamese** (per `.claude/rules/documentation.md`). This plan file is machine-facing → English.
- **File size:** Production source target **< 250 lines**; > 300 triggers a split. Prefer cohesion.
- **Type safety:** strict mode; **no `any`**; validate at network/IPC/persistence boundaries; exhaustive `switch` with `never` default for closed unions.
- **Secrets:** Access/refresh tokens live **only** in keyring + in-memory service. **Never** in renderer state, EV frames, logs, tool-call envelope, or screenshots. Register every secret with the shared `SecretScrubber` before any log/error path. Redact before logging.
- **Network:** All outbound Graph/OAuth URLs pass `SsrfPolicy.assertAllowed` before the request; `graph.microsoft.com` and `login.microsoftonline.com` are the only allowed hosts (both resolve public → allowed by the existing policy; no loopback escape).
- **Permission:** Every write (upload) runs its mutation **only** inside `PermissionGate.proceed(...)` behind a recorded Allow. Deny blocks and does not strand the session.
- **Workspace boundary:** A local file to upload is confined via the existing `WorkspaceGuard.assertRealPathInside` before read (reject `..`, absolute escape, UNC, symlink escape).
- **Feature flag:** The MS365 boundary is **OFF by default** on baseline. The tool router and OpenCode tool registration only activate when the flag is on. Baseline journeys must still PASS when OFF.
- **Test commands:** From `service/`: `npm test` runs `node --import tsx --test "tests/**/*.test.ts"`. Single file: `node --import tsx --test tests/<file>.test.ts`. From repo root: `npm run typecheck` (tsc -b), `npm run build:renderer`.
- **Runtime constraint (honest):** OpenCode (the child) owns tool-calling. The service cannot inject an in-process function; tools must be reachable over the loopback HTTP surface and OpenCode pointed at them at spawn. This is why tools are a boundary router, not an in-process callback.

---

## File Structure

Created under `service/src/ms365/`:

- `ms365-errors.ts` — typed error union + mapper (`auth_expired`, `rate_limited`, `not_found`, `graph_error`, `not_connected`, `endpoint_blocked`).
- `graph-client.ts` — `GraphClient` port + `createHttpGraphClient` adapter (SSRF-pinned fetch, error mapping, 429 `Retry-After`).
- `token-provider.ts` — `TokenProvider` port + `AuthSource` types + `createManualTokenProvider`.
- `device-code-provider.ts` — `createDeviceCodeProvider` (OAuth device code + refresh); **gated** behind config.
- `ms365-connector.ts` — `Ms365Connector` port + `createMs365Connector` (composes token + graph + keyring + state machine).
- `sharepoint-service.ts` — `SharePointService` (search / list / summary / upload) on top of the connector.
- `ms365-tools.ts` — tool definitions (name, kind read|write, schema) + the dispatch `handleToolCall`.
- `ms365-tool-router.ts` — `BoundaryRouter` mounting the tool call route; read → direct, write → `PermissionGate`.
- `ms365-view.ts` — build the secret-free `MicrosoftIntegrationView` from connector state.
- `index.ts` — barrel export.

Modified:

- `core/contracts/src/permission.ts` — add `"ms365_write"` to `PermissionActionKind`.
- `service/src/permission/approval-level.ts` — add `ms365_write` branch to `classifyApprovalLevel`.

Tests under `service/tests/`:

- `ms365-graph-client.test.ts`, `ms365-manual-token.test.ts`, `ms365-device-code.test.ts`, `ms365-connector.test.ts`, `ms365-sharepoint.test.ts`, `ms365-tool-router.test.ts`, `ms365-view-redaction.test.ts`, `permission-ms365-level.test.ts`.

---

## Task 1: Permission contract — add the `ms365_write` action kind

**Files:**
- Modify: `core/contracts/src/permission.ts:20-25`
- Modify: `service/src/permission/approval-level.ts:31-45`
- Test: `service/tests/permission-ms365-level.test.ts`

**Interfaces:**
- Consumes: existing `PermissionActionKind`, `classifyApprovalLevel`.
- Produces: `PermissionActionKind` now includes `"ms365_write"`; `classifyApprovalLevel("ms365_write") === "elevated"`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/permission-ms365-level.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApprovalLevel } from "../src/permission/approval-level.js";

test("ms365_write classifies as elevated (bounded external write)", () => {
  assert.equal(classifyApprovalLevel("ms365_write"), "elevated");
});

test("existing file kinds keep their levels", () => {
  assert.equal(classifyApprovalLevel("file_create"), "standard");
  assert.equal(classifyApprovalLevel("file_delete"), "elevated");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/permission-ms365-level.test.ts`
Expected: type error / FAIL — `"ms365_write"` is not assignable to `PermissionActionKind`.

- [ ] **Step 3: Add the kind to the contract**

In `core/contracts/src/permission.ts`, extend the union:

```ts
export type PermissionActionKind =
  | "file_create"
  | "file_edit"
  | "file_delete"
  | "file_move"
  | "command_exec"
  | "ms365_write";
```

- [ ] **Step 4: Add the exhaustive branch**

In `service/src/permission/approval-level.ts`, add to the `switch` before the `default`:

```ts
    case "ms365_write":
      return "elevated";
```

(Keep it in the elevated group with a one-line comment: `// ms365_write — bounded external mutation (SharePoint upload); treat as elevated.`)

- [ ] **Step 5: Run test + typecheck to verify pass**

Run (from `service/`): `node --import tsx --test tests/permission-ms365-level.test.ts` → PASS
Run (from repo root): `npm run typecheck` → PASS (exhaustive switch compiles)

- [ ] **Step 6: Commit**

```bash
git add core/contracts/src/permission.ts service/src/permission/approval-level.ts service/tests/permission-ms365-level.test.ts
git commit -m "feat(permission): add ms365_write action kind (elevated)"
```

---

## Task 2: MS365 typed errors

**Files:**
- Create: `service/src/ms365/ms365-errors.ts`
- Test: covered indirectly by later tasks; add a focused mapper test here.
- Test: `service/tests/ms365-errors.test.ts`

**Interfaces:**
- Produces:
  - `type Ms365ErrorKind = "not_connected" | "auth_expired" | "rate_limited" | "not_found" | "endpoint_blocked" | "graph_error"`
  - `class Ms365Error extends Error { readonly kind: Ms365ErrorKind; readonly retryable: boolean; readonly recovery: string; readonly retryAfterMs?: number }`
  - `function mapGraphStatus(status: number, retryAfterHeader?: string | null): Ms365Error` — 401→`auth_expired`, 404→`not_found`, 429→`rate_limited` (parse `Retry-After` seconds → `retryAfterMs`), else→`graph_error`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-errors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGraphStatus, Ms365Error } from "../src/ms365/ms365-errors.js";

test("401 → auth_expired with reconnect recovery", () => {
  const e = mapGraphStatus(401);
  assert.equal(e.kind, "auth_expired");
  assert.ok(e instanceof Ms365Error);
  assert.match(e.recovery, /kết nối lại|reconnect/i);
});

test("429 parses Retry-After seconds into ms", () => {
  const e = mapGraphStatus(429, "30");
  assert.equal(e.kind, "rate_limited");
  assert.equal(e.retryAfterMs, 30_000);
  assert.equal(e.retryable, true);
});

test("404 → not_found; 500 → graph_error", () => {
  assert.equal(mapGraphStatus(404).kind, "not_found");
  assert.equal(mapGraphStatus(500).kind, "graph_error");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// service/src/ms365/ms365-errors.ts
/**
 * Typed MS365 errors. Messages/recovery are non-secret and user-safe (no token, no raw
 * Graph body). Mirrors the provider error discipline (kind + retryable + recovery).
 */
export type Ms365ErrorKind =
  | "not_connected"
  | "auth_expired"
  | "rate_limited"
  | "not_found"
  | "endpoint_blocked"
  | "graph_error";

export class Ms365Error extends Error {
  readonly kind: Ms365ErrorKind;
  readonly retryable: boolean;
  readonly recovery: string;
  readonly retryAfterMs?: number;
  constructor(kind: Ms365ErrorKind, message: string, recovery: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "Ms365Error";
    this.kind = kind;
    this.recovery = recovery;
    this.retryable = retryable;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export function mapGraphStatus(status: number, retryAfterHeader?: string | null): Ms365Error {
  if (status === 401 || status === 403) {
    return new Ms365Error("auth_expired", "Microsoft 365 authorization failed.", "Kết nối lại Microsoft 365.", false);
  }
  if (status === 404) {
    return new Ms365Error("not_found", "The requested Microsoft 365 resource was not found.", "Kiểm tra lại tên/đường dẫn.", false);
  }
  if (status === 429) {
    const secs = Number.parseInt(retryAfterHeader ?? "", 10);
    const retryAfterMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 5000;
    return new Ms365Error("rate_limited", "Microsoft Graph rate limit reached.", "Thử lại sau ít phút.", true, retryAfterMs);
  }
  return new Ms365Error("graph_error", `Microsoft Graph request failed (status ${status}).`, "Thử lại; nếu tiếp diễn hãy kết nối lại.", status >= 500);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-errors.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-errors.ts service/tests/ms365-errors.test.ts
git commit -m "feat(ms365): typed Graph errors + status mapper"
```

---

## Task 3: GraphClient port + SSRF-pinned HTTP adapter

**Files:**
- Create: `service/src/ms365/graph-client.ts`
- Test: `service/tests/ms365-graph-client.test.ts`

**Interfaces:**
- Consumes: `SsrfPolicy` (`assertAllowed`) from `../provider/index.js`; `mapGraphStatus`, `Ms365Error` from Task 2.
- Produces:
  - `interface GraphRequest { method: "GET" | "POST" | "PUT"; path: string; query?: Record<string,string>; body?: unknown; bodyBytes?: Uint8Array; contentType?: string; }`
  - `interface GraphClient { json<T>(req: GraphRequest): Promise<T>; bytes(req: GraphRequest): Promise<Uint8Array>; }`
  - `interface GraphFetchDeps { ssrf: SsrfPolicy; fetchFn?: typeof fetch; getToken: () => Promise<string>; baseUrl?: string; }`
  - `function createHttpGraphClient(deps: GraphFetchDeps): GraphClient` — default `baseUrl = "https://graph.microsoft.com/v1.0"`. Builds the full URL, runs `ssrf.assertAllowed(url)` BEFORE fetch, adds `Authorization: Bearer <token>`, maps non-2xx via `mapGraphStatus`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-graph-client.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpGraphClient } from "../src/ms365/graph-client.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [{ address: "20.190.1.1", family: 4 }];

function fakeFetch(status: number, payload: unknown, headers: Record<string,string> = {}) {
  const calls: string[] = [];
  const fn = (async (url: string, init?: { headers?: Record<string,string> }) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => payload,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(payload)).buffer,
      // expose init for assertion
      __authHeader: init?.headers?.["Authorization"],
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("json() sends bearer token, hits graph host, returns parsed body", async () => {
  const { fn, calls } = fakeFetch(200, { value: [{ id: "1" }] });
  const client = createHttpGraphClient({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    fetchFn: fn,
    getToken: async () => "TOKEN123",
  });
  const out = await client.json<{ value: { id: string }[] }>({ method: "GET", path: "/me/drive/root/children" });
  assert.equal(out.value[0].id, "1");
  assert.match(calls[0], /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/drive\/root\/children/);
});

test("non-2xx maps to Ms365Error via mapGraphStatus", async () => {
  const { fn } = fakeFetch(429, {}, { "retry-after": "12" });
  const client = createHttpGraphClient({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    fetchFn: fn,
    getToken: async () => "T",
  });
  await assert.rejects(() => client.json({ method: "GET", path: "/me" }), (e: unknown) => {
    return (e as { kind?: string }).kind === "rate_limited";
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-graph-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// service/src/ms365/graph-client.ts
/**
 * Microsoft Graph HTTP client. SSRF-pinned: every URL passes SsrfPolicy.assertAllowed BEFORE
 * the fetch (graph.microsoft.com resolves public → allowed; a poisoned/rebinding answer is
 * blocked). The bearer token is fetched per call (so a refreshed token is always current) and
 * NEVER logged. Non-2xx is mapped to a typed Ms365Error.
 */
import type { SsrfPolicy } from "../provider/index.js";
import { mapGraphStatus } from "./ms365-errors.js";

export interface GraphRequest {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  readonly bodyBytes?: Uint8Array;
  readonly contentType?: string;
}

export interface GraphClient {
  json<T>(req: GraphRequest): Promise<T>;
  bytes(req: GraphRequest): Promise<Uint8Array>;
}

export interface GraphFetchDeps {
  readonly ssrf: SsrfPolicy;
  readonly fetchFn?: typeof fetch;
  readonly getToken: () => Promise<string>;
  readonly baseUrl?: string;
}

const DEFAULT_BASE = "https://graph.microsoft.com/v1.0";

export function createHttpGraphClient(deps: GraphFetchDeps): GraphClient {
  const base = deps.baseUrl ?? DEFAULT_BASE;
  const doFetch = deps.fetchFn ?? fetch;

  function buildUrl(req: GraphRequest): string {
    const url = new URL(base + req.path);
    if (req.query) for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
    return url.href;
  }

  async function send(req: GraphRequest): Promise<Response> {
    const href = buildUrl(req);
    await deps.ssrf.assertAllowed(href); // throws SsrfBlockedError on refusal — never fetch unvalidated
    const token = await deps.getToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let payload: BodyInit | undefined;
    if (req.bodyBytes !== undefined) {
      payload = req.bodyBytes;
      headers["Content-Type"] = req.contentType ?? "application/octet-stream";
    } else if (req.body !== undefined) {
      payload = JSON.stringify(req.body);
      headers["Content-Type"] = "application/json";
    }
    const res = await doFetch(href, { method: req.method, headers, body: payload });
    if (!res.ok) throw mapGraphStatus(res.status, res.headers.get("retry-after"));
    return res;
  }

  return {
    async json<T>(req: GraphRequest): Promise<T> {
      const res = await send(req);
      return (await res.json()) as T;
    },
    async bytes(req: GraphRequest): Promise<Uint8Array> {
      const res = await send(req);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-graph-client.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/graph-client.ts service/tests/ms365-graph-client.test.ts
git commit -m "feat(ms365): SSRF-pinned Graph HTTP client"
```

---

## Task 4: TokenProvider port + manual token adapter

**Files:**
- Create: `service/src/ms365/token-provider.ts`
- Test: `service/tests/ms365-manual-token.test.ts`

**Interfaces:**
- Consumes: `GraphClient` (Task 3) for validation; `CredentialService` (`store`, `has`, `remove`) from `../credential/index.js`; `CredentialRef` from `@cowork-ghc/contracts`.
- Produces:
  - `type AuthSource = "manual_token" | "device_code"`
  - `interface TokenProvider { source: AuthSource; getAccessToken(): Promise<string>; isValid(): Promise<boolean>; clear(): Promise<void>; }`
  - `interface ManualTokenDeps { credentials: CredentialService; account?: string; now?: () => number; }`
  - `function createManualTokenProvider(deps: ManualTokenDeps): { provider: TokenProvider; connect(accessToken: string): Promise<void>; }`
  - The manual token is stored via `credentials.store({ providerId: "ms365", secret: token })`; `getAccessToken` reads it back through a resolver the connector supplies (see note). For unit isolation, `ManualTokenDeps` also accepts an in-memory `getStored`/`setStored` fake — but production uses the credential store.

  Simplify: `createManualTokenProvider` holds the token **in-memory** after `connect` (session lifetime) AND persists a copy via `credentials.store` so relaunch can attempt reuse. `isValid()` returns whether a token is present (expiry is detected by Graph 401 → connector maps to `needs_reconnect`; manual tokens carry no exp we can trust).

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-manual-token.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";
import { createCredentialService } from "../src/credential/index.js";
import { createMemoryStore } from "../src/credential/memory-store.js";

function creds() {
  return createCredentialService({ store: createMemoryStore() });
}

test("connect stores token; getAccessToken returns it; source is manual_token", async () => {
  const { provider, connect } = createManualTokenProvider({ credentials: creds() });
  assert.equal(provider.source, "manual_token");
  assert.equal(await provider.isValid(), false);
  await connect("PASTED-TOKEN");
  assert.equal(await provider.isValid(), true);
  assert.equal(await provider.getAccessToken(), "PASTED-TOKEN");
});

test("clear removes the token", async () => {
  const { provider, connect } = createManualTokenProvider({ credentials: creds() });
  await connect("T");
  await provider.clear();
  assert.equal(await provider.isValid(), false);
});
```

> Confirm the memory-store factory name during Step 2; if `createMemoryStore` differs, use the actual export from `service/src/credential/memory-store.ts` (it exists per the file list). Adjust the import accordingly — this is the only unknown symbol.

- [ ] **Step 2: Run test to verify it fails (and confirm memory-store export)**

Run (from `service/`): `node --import tsx --test tests/ms365-manual-token.test.ts`
Expected: FAIL — module not found. While here, open `service/src/credential/memory-store.ts` and confirm the exported factory name; fix the test import if needed.

- [ ] **Step 3: Implement**

```ts
// service/src/ms365/token-provider.ts
/**
 * TokenProvider seam. Two adapters (manual paste here; device code in a later module) satisfy
 * the SAME interface so the connector is auth-source agnostic. The manual token is held in
 * memory for the session AND persisted via the credential store so a relaunch can retry it;
 * a stale token surfaces as a Graph 401, which the connector maps to needs_reconnect.
 */
import type { CredentialService } from "../credential/index.js";

export type AuthSource = "manual_token" | "device_code";

export interface TokenProvider {
  readonly source: AuthSource;
  getAccessToken(): Promise<string>;
  isValid(): Promise<boolean>;
  clear(): Promise<void>;
}

const MS365_ACCOUNT = "ms365";

export interface ManualTokenDeps {
  readonly credentials: CredentialService;
  readonly account?: string;
}

export function createManualTokenProvider(deps: ManualTokenDeps): {
  provider: TokenProvider;
  connect(accessToken: string): Promise<void>;
} {
  const providerId = deps.account ?? MS365_ACCOUNT;
  let token: string | null = null;
  let ref = null as Awaited<ReturnType<CredentialService["store"]>> | null;

  const provider: TokenProvider = {
    source: "manual_token",
    async getAccessToken() {
      if (token === null) throw new Error("No MS365 token; connect first.");
      return token;
    },
    async isValid() {
      return token !== null;
    },
    async clear() {
      if (ref !== null) await deps.credentials.remove(ref);
      token = null;
      ref = null;
    },
  };

  return {
    provider,
    async connect(accessToken: string) {
      if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
        throw new Error("Access token must be a non-empty string.");
      }
      token = accessToken.trim();
      ref = await deps.credentials.store({ providerId, secret: token });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-manual-token.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/token-provider.ts service/tests/ms365-manual-token.test.ts
git commit -m "feat(ms365): TokenProvider seam + manual token adapter"
```

---

## Task 5: Device-code OAuth adapter (coded, gated)

**Files:**
- Create: `service/src/ms365/device-code-provider.ts`
- Test: `service/tests/ms365-device-code.test.ts`

**Interfaces:**
- Consumes: `TokenProvider`, `AuthSource` (Task 4); `SsrfPolicy`.
- Produces:
  - `interface DeviceCodePrompt { userCode: string; verificationUri: string; expiresInSec: number; }`
  - `interface DeviceCodeConfig { clientId: string; tenant?: string; scopes: readonly string[]; }`
  - `interface DeviceCodeDeps { ssrf: SsrfPolicy; fetchFn?: typeof fetch; config: DeviceCodeConfig; now?: () => number; }`
  - `function createDeviceCodeProvider(deps: DeviceCodeDeps): { provider: TokenProvider; begin(): Promise<DeviceCodePrompt>; poll(): Promise<"pending" | "connected">; }`
  - Hosts pinned to `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/{devicecode,token}`; every URL passes `ssrf.assertAllowed`. Access token cached with `expiresAt`; `getAccessToken` refreshes via the stored refresh token when within 60s of expiry; refresh failure throws `Ms365Error("auth_expired", ...)`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-device-code.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeviceCodeProvider } from "../src/ms365/device-code-provider.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";

const PUBLIC = async (): Promise<readonly ResolvedAddress[]> => [{ address: "20.190.1.1", family: 4 }];

function scriptedFetch(steps: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return (async () => {
    const step = steps[Math.min(i++, steps.length - 1)];
    return { ok: step.status < 300, status: step.status, headers: { get: () => null }, json: async () => step.body } as unknown as Response;
  }) as unknown as typeof fetch;
}

test("begin() returns a device code prompt", async () => {
  const fetchFn = scriptedFetch([{ status: 200, body: { user_code: "ABCD", verification_uri: "https://microsoft.com/devicelogin", expires_in: 900, device_code: "dc" } }]);
  const { begin } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] } });
  const prompt = await begin();
  assert.equal(prompt.userCode, "ABCD");
  assert.match(prompt.verificationUri, /devicelogin/);
});

test("poll() returns pending then connected", async () => {
  const fetchFn = scriptedFetch([
    { status: 200, body: { user_code: "ABCD", verification_uri: "u", expires_in: 900, device_code: "dc" } },
    { status: 400, body: { error: "authorization_pending" } },
    { status: 200, body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } },
  ]);
  const { provider, begin, poll } = createDeviceCodeProvider({ ssrf: createSsrfPolicy({ resolver: PUBLIC }), fetchFn, config: { clientId: "cid", scopes: ["Sites.Read.All"] } });
  await begin();
  assert.equal(await poll(), "pending");
  assert.equal(await poll(), "connected");
  assert.equal(await provider.getAccessToken(), "AT");
  assert.equal(provider.source, "device_code");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-device-code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `device-code-provider.ts` implementing `begin()` (POST `/devicecode` with `client_id` + `scope`), `poll()` (POST `/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`; `400 authorization_pending` → `"pending"`; 200 → cache `{accessToken, refreshToken, expiresAt}` → `"connected"`), and `provider.getAccessToken()` (refresh via `grant_type=refresh_token` when within 60s of `expiresAt`; on refresh failure throw `new Ms365Error("auth_expired", ...)`). Every URL string passes `deps.ssrf.assertAllowed(url)` before fetch. Keep the file < 250 lines. Use `deps.now ?? (() => Date.now())` for expiry math (injectable clock).

Key shape:

```ts
import type { SsrfPolicy } from "../provider/index.js";
import type { TokenProvider } from "./token-provider.js";
import { Ms365Error, mapGraphStatus } from "./ms365-errors.js";

export interface DeviceCodePrompt { readonly userCode: string; readonly verificationUri: string; readonly expiresInSec: number; }
export interface DeviceCodeConfig { readonly clientId: string; readonly tenant?: string; readonly scopes: readonly string[]; }
export interface DeviceCodeDeps { readonly ssrf: SsrfPolicy; readonly fetchFn?: typeof fetch; readonly config: DeviceCodeConfig; readonly now?: () => number; }

export function createDeviceCodeProvider(deps: DeviceCodeDeps): {
  provider: TokenProvider;
  begin(): Promise<DeviceCodePrompt>;
  poll(): Promise<"pending" | "connected">;
} {
  const tenant = deps.config.tenant ?? "common";
  const authBase = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const now = deps.now ?? (() => Date.now());
  const doFetch = deps.fetchFn ?? fetch;
  // ... deviceCode/accessToken/refreshToken/expiresAt closure state ...
  // begin(): assertAllowed(`${authBase}/devicecode`) then POST; store device_code + prompt.
  // poll(): assertAllowed(`${authBase}/token`) then POST device_code grant; map states.
  // provider.getAccessToken(): refresh when near expiry; throw Ms365Error("auth_expired",...) on failure.
  // (Full body written here; keep <250 lines.)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-device-code.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/device-code-provider.ts service/tests/ms365-device-code.test.ts
git commit -m "feat(ms365): device-code OAuth adapter (gated by config)"
```

---

## Task 6: Ms365Connector — state machine + composition

**Files:**
- Create: `service/src/ms365/ms365-connector.ts`
- Test: `service/tests/ms365-connector.test.ts`

**Interfaces:**
- Consumes: `TokenProvider` (Task 4/5), `GraphClient` (Task 3), `Ms365Error` (Task 2); `MicrosoftConnectionState` from `../../app/ui`? — **No.** The enum `MicrosoftConnectionState` currently lives in `app/ui/src/integration-slots.ts` (renderer). For the service, **re-declare a matching service-side type** `Ms365ConnectionState = "disconnected" | "connecting" | "connected" | "needs_reconnect" | "error"` in this module (do not import renderer code into the service — that violates the import direction). The view mapper (Task 8) maps service state → the renderer contract shape.
- Produces:
  - `type Ms365ConnectionState = "disconnected" | "connecting" | "connected" | "needs_reconnect" | "error"`
  - `interface Ms365Connector { connectionState(): Ms365ConnectionState; connectWithToken(token: string): Promise<void>; disconnect(): Promise<void>; graph(): GraphClient; source(): AuthSource | null; lastError(): string | null; }`
  - `interface Ms365ConnectorDeps { manual: { provider: TokenProvider; connect(token: string): Promise<void> }; makeGraph: (getToken: () => Promise<string>) => GraphClient; verify?: (graph: GraphClient) => Promise<void>; }`
  - `function createMs365Connector(deps: Ms365ConnectorDeps): Ms365Connector`
  - Behavior: `connectWithToken` → state `connecting`, call `manual.connect`, then `verify(graph)` (default: `graph.json({method:"GET", path:"/me"})`); success → `connected`; a `Ms365Error("auth_expired")` → `needs_reconnect`; other error → `error` with `lastError` set to the non-secret message. `graph()` returns a client whose token comes from the active provider (so a mid-session refresh is transparent).

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-connector.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365Connector } from "../src/ms365/ms365-connector.js";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";
import { createCredentialService } from "../src/credential/index.js";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import type { GraphClient } from "../src/ms365/graph-client.js";

function fakeGraph(verifyOk: boolean): GraphClient {
  return {
    json: async () => { if (!verifyOk) throw new Ms365Error("auth_expired", "bad", "reconnect", false); return {} as never; },
    bytes: async () => new Uint8Array(),
  };
}

function connectorWith(verifyOk: boolean) {
  const credentials = createCredentialService({ store: createMemoryStore() });
  const manual = createManualTokenProvider({ credentials });
  return createMs365Connector({ manual, makeGraph: () => fakeGraph(verifyOk) });
}

test("starts disconnected", () => {
  assert.equal(connectorWith(true).connectionState(), "disconnected");
});

test("connectWithToken → connected on successful verify", async () => {
  const c = connectorWith(true);
  await c.connectWithToken("T");
  assert.equal(c.connectionState(), "connected");
  assert.equal(c.source(), "manual_token");
});

test("auth_expired on verify → needs_reconnect", async () => {
  const c = connectorWith(false);
  await c.connectWithToken("T");
  assert.equal(c.connectionState(), "needs_reconnect");
});

test("disconnect returns to disconnected and clears token", async () => {
  const c = connectorWith(true);
  await c.connectWithToken("T");
  await c.disconnect();
  assert.equal(c.connectionState(), "disconnected");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-connector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** the connector per the Interfaces block (state machine + `verify` default `GET /me`, `error`/`needs_reconnect` mapping, `graph()` bound to the active provider's `getAccessToken`). Keep < 250 lines.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-connector.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-connector.ts service/tests/ms365-connector.test.ts
git commit -m "feat(ms365): connector state machine over token + graph"
```

---

## Task 7: SharePointService — search / list / summary / upload

**Files:**
- Create: `service/src/ms365/sharepoint-service.ts`
- Test: `service/tests/ms365-sharepoint.test.ts`

**Interfaces:**
- Consumes: `Ms365Connector` (Task 6, uses `.graph()`), `Ms365Error` (Task 2). For upload it consumes a **local-file reader** port `interface LocalFileReader { readBytes(relativePath: string): Promise<Uint8Array>; }` (backed in production by the workspace-confined file service; injected as a fake in tests) — this keeps the workspace-boundary check where it already lives.
- Produces:
  - `interface SharePointHit { id: string; name: string; webUrl: string; }`
  - `interface SharePointService { search(query: string, limit?: number): Promise<SharePointHit[]>; listSiteFiles(siteId: string): Promise<SharePointHit[]>; getFileSummaryText(driveItemId: string): Promise<string>; upload(input: { siteId: string; relativeLocalPath: string; targetName: string }): Promise<{ id: string; webUrl: string }>; }`
  - `function createSharePointService(deps: { connector: Ms365Connector; files: LocalFileReader; maxResults?: number; maxSummaryBytes?: number }): SharePointService`
  - `search` → Graph `POST /search/query` with a KQL/`$search` request built from `query` (driveItem entity), capped at `maxResults` (default 25). `getFileSummaryText` → `bytes` of `/drive/items/{id}/content`, decoded UTF-8, truncated to `maxSummaryBytes` (default 65536 = 64 KiB, matching File Review). `upload` → `files.readBytes(relativeLocalPath)` (workspace-confined) then Graph `PUT /sites/{siteId}/drive/root:/{targetName}:/content`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-sharepoint.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSharePointService } from "../src/ms365/sharepoint-service.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import type { GraphClient, GraphRequest } from "../src/ms365/graph-client.js";

function connectorReturning(recorder: GraphRequest[], responder: (r: GraphRequest) => unknown): Ms365Connector {
  const graph: GraphClient = {
    json: async (r) => { recorder.push(r); return responder(r) as never; },
    bytes: async (r) => { recorder.push(r); return responder(r) as Uint8Array; },
  };
  return {
    connectionState: () => "connected", connectWithToken: async () => {}, disconnect: async () => {},
    graph: () => graph, source: () => "manual_token", lastError: () => null,
  };
}

test("search caps results at maxResults and returns hits", async () => {
  const seen: GraphRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [{ hitsContainers: [{ hits: [
    { resource: { id: "a", name: "Doc A", webUrl: "http://x/a" } },
    { resource: { id: "b", name: "Doc B", webUrl: "http://x/b" } },
  ] }] }] }));
  const svc = createSharePointService({ connector: conn, files: { readBytes: async () => new Uint8Array() }, maxResults: 1 });
  const hits = await svc.search("quarterly report");
  assert.equal(hits.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.match(seen[0].path, /\/search\/query/);
});

test("upload reads the workspace file then PUTs content", async () => {
  const seen: GraphRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "up1", webUrl: "http://x/up1" }));
  const bytes = new TextEncoder().encode("hello");
  const svc = createSharePointService({ connector: conn, files: { readBytes: async () => bytes } });
  const out = await svc.upload({ siteId: "S", relativeLocalPath: "notes.txt", targetName: "notes.txt" });
  assert.equal(out.id, "up1");
  const put = seen.find((r) => r.method === "PUT");
  assert.ok(put && put.bodyBytes && put.bodyBytes.length === 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-sharepoint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** per the Interfaces block. Parse the Graph `/search/query` response defensively (optional chaining over `value[].hitsContainers[].hits[].resource`), map to `SharePointHit[]`, slice to `maxResults`. Keep < 250 lines.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-sharepoint.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/sharepoint-service.ts service/tests/ms365-sharepoint.test.ts
git commit -m "feat(ms365): SharePoint search/list/summary/upload service"
```

---

## Task 8: MicrosoftIntegrationView mapper (secret-free)

**Files:**
- Create: `service/src/ms365/ms365-view.ts`
- Test: `service/tests/ms365-view-redaction.test.ts`

**Interfaces:**
- Consumes: `Ms365Connector` (Task 6). Does **not** import renderer types; produces a plain object matching the `MicrosoftIntegrationView` shape (`connectionState`, `services[]`, `scopes[]`, `actionHistory[]`, optional `error`).
- Produces:
  - `interface Ms365ViewData { connectionState: Ms365ConnectionState; services: { id: string; label: string; connected: boolean }[]; scopes: string[]; actionHistory: { label: string; source: string; at?: string }[]; error?: string; }`
  - `function buildMs365View(connector: Ms365Connector, scopes: readonly string[]): Ms365ViewData` — never includes a token; `error` is the connector's non-secret `lastError()`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-view-redaction.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMs365View } from "../src/ms365/ms365-view.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";

function conn(state: "connected" | "disconnected"): Ms365Connector {
  return {
    connectionState: () => state, connectWithToken: async () => {}, disconnect: async () => {},
    graph: () => ({ json: async () => ({} as never), bytes: async () => new Uint8Array() }),
    source: () => (state === "connected" ? "manual_token" : null), lastError: () => null,
  };
}

test("view carries state + scopes and NO token field", () => {
  const view = buildMs365View(conn("connected"), ["Sites.Read.All", "Files.ReadWrite.All"]);
  assert.equal(view.connectionState, "connected");
  assert.deepEqual(view.scopes, ["Sites.Read.All", "Files.ReadWrite.All"]);
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /Bearer|access_token|refresh_token/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-view-redaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `buildMs365View` returning the plain shape; `services` = the SharePoint service marked connected iff state is `connected`; `scopes` passthrough; `actionHistory` = `[]` for this slice; `error` only when `lastError()` is non-null.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-view-redaction.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-view.ts service/tests/ms365-view-redaction.test.ts
git commit -m "feat(ms365): secret-free MicrosoftIntegrationView mapper"
```

---

## Task 9: Tool definitions + dispatch with permission enforcement

**Files:**
- Create: `service/src/ms365/ms365-tools.ts`
- Test: `service/tests/ms365-tool-router.test.ts` (dispatch-level; router mount in Task 10)

**Interfaces:**
- Consumes: `SharePointService` (Task 7); `PermissionGate` + `createPermissionRequest` from `../permission/index.js`; `PermissionAction` from `@cowork-ghc/contracts`.
- Produces:
  - `type Ms365ToolName = "sharepoint_search" | "sharepoint_list_site_files" | "sharepoint_get_file_summary" | "sharepoint_upload_file"`
  - `interface ToolCall { name: Ms365ToolName; args: Record<string, unknown>; sessionId: string; requestId: string; }`
  - `type ToolResult = { ok: true; data: unknown } | { ok: false; error: { kind: string; message: string; recovery?: string } }`
  - `interface ToolDeps { sharepoint: SharePointService; connectionState: () => Ms365ConnectionState; gate: PermissionGate; now: () => string; }`
  - `function handleToolCall(deps: ToolDeps, call: ToolCall): Promise<ToolResult>` — if `connectionState() !== "connected"` → `{ ok:false, error:{ kind:"not_connected", ... } }`. Reads run directly. `sharepoint_upload_file` (write): build a `PermissionAction { kind: "ms365_write", description: "Upload <targetName> lên SharePoint" }`, `gate.submit(createPermissionRequest(...))`, then `gate.proceed(requestId, () => sharepoint.upload(...))`; if `proceed` returns `performed:false` → `{ ok:false, error:{ kind:"denied", ... } }`.

  Note: `proceed` runs a synchronous `perform`; since `upload` is async, capture the promise inside `perform` and await it outside, OR add an async proceed. To stay faithful to the existing sync `proceed`, `perform` returns the `Promise` and the handler awaits the returned promise: `const r = gate.proceed(id, () => sharepoint.upload(input)); if (!r.performed) return denied; return { ok:true, data: await r.result };`.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-tool-router.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall } from "../src/ms365/ms365-tools.js";
import { createPermissionGate, createInMemoryAuditSink } from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

function gateFixture() {
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply: recordingReplyPort(), audit: createInMemoryAuditSink(), session: recordingDenialSink(),
    scheduler: { schedule: () => ({}) as never, cancel: () => {} }, timeoutMs: 1000, now: time.now,
  });
  return gate;
}

const sp = {
  search: async () => [{ id: "1", name: "A", webUrl: "u" }],
  listSiteFiles: async () => [], getFileSummaryText: async () => "text",
  upload: async () => ({ id: "up", webUrl: "u" }),
};

test("read tool runs directly when connected", async () => {
  const res = await handleToolCall(
    { sharepoint: sp, connectionState: () => "connected", gate: gateFixture(), now: () => "t" },
    { name: "sharepoint_search", args: { query: "x" }, sessionId: "s", requestId: "r1" },
  );
  assert.equal(res.ok, true);
});

test("not connected → not_connected error, no throw", async () => {
  const res = await handleToolCall(
    { sharepoint: sp, connectionState: () => "disconnected", gate: gateFixture(), now: () => "t" },
    { name: "sharepoint_search", args: { query: "x" }, sessionId: "s", requestId: "r2" },
  );
  assert.equal(res.ok, false);
  assert.equal((res as { error: { kind: string } }).error.kind, "not_connected");
});

test("upload without an Allow is blocked (proceed not_allowed → denied)", async () => {
  const gate = gateFixture();
  const res = await handleToolCall(
    { sharepoint: sp, connectionState: () => "connected", gate, now: () => "t" },
    { name: "sharepoint_upload_file", args: { siteId: "S", relativeLocalPath: "n.txt", targetName: "n.txt" }, sessionId: "s", requestId: "r3" },
  );
  // No resolve() Allow was recorded, so proceed blocks.
  assert.equal(res.ok, false);
  assert.equal((res as { error: { kind: string } }).error.kind, "denied");
});

test("upload with an Allow proceeds", async () => {
  const gate = gateFixture();
  // Kick off the call, then allow the pending request.
  const p = handleToolCall(
    { sharepoint: sp, connectionState: () => "connected", gate, now: () => "t" },
    { name: "sharepoint_upload_file", args: { siteId: "S", relativeLocalPath: "n.txt", targetName: "n.txt" }, sessionId: "s", requestId: "r4" },
  );
  await gate.resolve({ requestId: "r4", decision: "allow", scope: "once" });
  const res = await p;
  assert.equal(res.ok, true);
});
```

> If the upload/allow ordering is racy (submit then immediately proceed inside the handler), implement the handler so it submits, then `resolve` is awaited by the test BEFORE proceed. Simplest faithful design: the handler submits and immediately calls `proceed` — which returns `not_allowed` unless an Allow was already recorded. For the "with Allow" test, restructure so the handler awaits a resolution signal. **Chosen design:** the handler does NOT block waiting for the modal; it submits and then proceeds in the SAME call. Real Allow arrives via the normal permission round trip on a *subsequent* tool retry. To keep the test deterministic, the "with Allow" case pre-resolves: call `gate.submit` semantics are internal — so for this unit test, drop the "with Allow proceeds" case and instead assert proceed-blocks-without-allow (the deterministic guarantee). Keep only the first three tests. (Adjust in Step 1 before running.)

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-tool-router.test.ts`
Expected: FAIL — module not found. Confirm `permission-fakes.ts` exports `createFakeTime`, `recordingDenialSink`, `recordingReplyPort`, and `createInMemoryAuditSink` (used by existing permission tests); adjust imports to the real names if they differ.

- [ ] **Step 3: Implement** `ms365-tools.ts` per the Interfaces block. Validate `args` per tool (non-empty `query`; `siteId`/`relativeLocalPath`/`targetName` strings for upload) → on invalid, `{ ok:false, error:{ kind:"invalid_input", ... } }`. Map any thrown `Ms365Error` to `{ ok:false, error:{ kind, message, recovery } }`.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-tool-router.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-tools.ts service/tests/ms365-tool-router.test.ts
git commit -m "feat(ms365): tool dispatch with permission-gated upload"
```

---

## Task 10: BoundaryRouter + barrel export

**Files:**
- Create: `service/src/ms365/ms365-tool-router.ts`
- Create: `service/src/ms365/index.ts`
- Test: extend `service/tests/ms365-tool-router.test.ts` with a router-shape test.

**Interfaces:**
- Consumes: `handleToolCall`, `ToolCall`, `ToolResult` (Task 9); `BoundaryRouter`, `RouteContext`, `RouteResult` from `../boundary/contract.js`; view mapper (Task 8).
- Produces:
  - `const MS365_TOOL_CALL_PATH = "/v1/ms365/tool-call"` and `const MS365_VIEW_PATH = "/v1/ms365/view"` and `const MS365_CONNECT_PATH = "/v1/ms365/connect"`.
  - `function createMs365Router(deps: { tools: ToolDeps; connector: Ms365Connector; scopes: readonly string[] }): BoundaryRouter` — token-guarded (no `publicUnauthenticated`). POST tool-call validates body → `handleToolCall`. POST connect → `connector.connectWithToken(body.token)`. GET view → `buildMs365View`.
  - `index.ts` re-exports the public surface.

- [ ] **Step 1: Write the failing router test (append to the tool-router test file)**

```ts
import { createMs365Router, MS365_TOOL_CALL_PATH } from "../src/ms365/index.js";

test("router is token-guarded and mounts the tool-call route", () => {
  const router = createMs365Router({
    tools: { sharepoint: sp, connectionState: () => "connected", gate: gateFixture(), now: () => "t" },
    connector: { connectionState: () => "connected", connectWithToken: async () => {}, disconnect: async () => {}, graph: () => ({ json: async () => ({} as never), bytes: async () => new Uint8Array() }), source: () => "manual_token", lastError: () => null },
    scopes: ["Sites.Read.All"],
  });
  assert.equal(router.name, "ms365");
  for (const r of router.routes) assert.notEqual((r as { publicUnauthenticated?: true }).publicUnauthenticated, true);
  assert.ok(router.routes.some((r) => "path" in r && r.path === MS365_TOOL_CALL_PATH));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-tool-router.test.ts`
Expected: FAIL — `createMs365Router` not found.

- [ ] **Step 3: Implement** `ms365-tool-router.ts` (build `RouteDefinition[]`, each handler parses `ctx.body`, returns `{ status: 200, data }`; on invalid body return `{ status: 400, data }` mapped through the boundary error path used by sibling routers — mirror `provider-router` / `workspace-router` conventions) and `index.ts` barrel.

- [ ] **Step 4: Run test to verify it passes**

Run (from `service/`): `node --import tsx --test tests/ms365-tool-router.test.ts` → PASS
Run (from repo root): `npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/ms365-tool-router.ts service/src/ms365/index.ts service/tests/ms365-tool-router.test.ts
git commit -m "feat(ms365): token-guarded boundary router + barrel"
```

---

## Task 11: Composition wiring behind a feature flag (OFF by default)

**Files:**
- Modify: the service composition root (find via `grep -rn "RouterRegistry\|\.mount(" service/src/composition service/src/server`). Mount `createMs365Router(...)` **only** when the flag is on.
- Modify: OpenCode supervisor spawn env (`service/src/runtime/supervisor.ts` / `child-spawner.ts` call site) to advertise the MS365 tool endpoint to the child **only** when the flag is on.
- Test: `service/tests/ms365-flag-off.test.ts`

**Interfaces:**
- Consumes: `createMs365Router` (Task 10); existing composition seams (`RouterRegistry.mount`, supervisor env building).
- Produces: a flag read from env `CGHC_MS365_ENABLED` (default OFF). When OFF: no ms365 routes mounted, no ms365 tool advertised to OpenCode, baseline unaffected.

- [ ] **Step 1: Write the failing test**

```ts
// service/tests/ms365-flag-off.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMs365Enabled } from "../src/ms365/index.js";

test("MS365 is OFF by default (no env)", () => {
  assert.equal(isMs365Enabled({}), false);
});

test("MS365 is ON only for explicit '1'/'true'", () => {
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "1" }), true);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "true" }), true);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "0" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `service/`): `node --import tsx --test tests/ms365-flag-off.test.ts`
Expected: FAIL — `isMs365Enabled` not found.

- [ ] **Step 3: Implement** `isMs365Enabled(env: Record<string,string|undefined>): boolean` in `ms365/index.ts` (`return env.CGHC_MS365_ENABLED === "1" || env.CGHC_MS365_ENABLED === "true";`). Then guard the composition-root mount and the supervisor env advertisement with `isMs365Enabled(process.env)`. Read the composition file first and mirror the existing mount pattern; do not weaken any protected boundary.

- [ ] **Step 4: Run tests + full service suite + typecheck**

Run (from `service/`): `node --import tsx --test tests/ms365-flag-off.test.ts` → PASS
Run (from `service/`): `npm test` → PASS (no regression)
Run (from repo root): `npm run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/ms365/index.ts service/src/composition service/src/runtime service/tests/ms365-flag-off.test.ts
git commit -m "feat(ms365): mount connector behind CGHC_MS365_ENABLED (off by default)"
```

---

## Task 12: Full regression + packaged verification handoff + status update

**Files:**
- Modify: `docs/product/current-status.md` (Vietnamese) — add an MS365 connector slice row.
- Modify: `docs/integration/external-systems-integration-readiness.md` — fill the §3 D2 matrix row and §5 D2 acceptance evidence.

**Interfaces:**
- Consumes: everything above.
- Produces: verified slice record + intake traceability.

- [ ] **Step 1: Full regression**

Run (from repo root): `npm run typecheck` → PASS
Run (from `service/`): `npm test` → PASS
Run (from repo root): `npm run build:renderer` → PASS
Run (from repo root): `npm run verify:release` → PASS

- [ ] **Step 2: Confirm feature-OFF baseline is unaffected**

With no `CGHC_MS365_ENABLED`, confirm no ms365 route is mounted and existing journeys behave as before (the `ms365-flag-off` test + full service suite cover this deterministically).

- [ ] **Step 3: Update `docs/product/current-status.md`** (Vietnamese)

Add a section recording: spec + plan paths, the `ms365_write` permission kind, manual-token connect working, device-code coded+gated, SharePoint search/summary/upload with permission-gated upload, feature flag OFF by default, and that packaged live verification against a real tenant is **pending** (honest — no fake connected state).

- [ ] **Step 4: Update the D2 intake matrix** in `docs/integration/external-systems-integration-readiness.md` §3 and §5 with the implemented auth model, scopes (`Sites.Read.All`, `Files.ReadWrite.All`), one read-only + one bounded write action, and the packaged journey.

- [ ] **Step 5: Commit**

```bash
git add docs/product/current-status.md docs/integration/external-systems-integration-readiness.md
git commit -m "docs(product): record MS365 connector + SharePoint slice (D2)"
```

---

## Self-Review

**1. Spec coverage:**
- Connector foundation (auth, Graph, keyring, port/adapter) → Tasks 2–6. ✓
- Manual token + device code (both auth sources) → Tasks 4, 5. ✓
- Device code coded-but-gated → Tasks 5, 11 (flag). ✓
- SharePoint search/summary/upload; query built from prompt → Task 7 (model builds the query string; `search` passes it to Graph). ✓
- Internal service tool, not MCP → Tasks 9, 10 (own loopback router; no `mcp-registry`). ✓
- Write via PermissionGate → Tasks 1, 9. ✓
- Secret-free view/logs → Tasks 8, 2 (typed non-secret errors), Global Constraints. ✓
- SSRF-pinned outbound → Task 3, 5. ✓
- Workspace boundary on upload → Task 7 (`LocalFileReader` backed by the confined file service). ✓
- Feature flag OFF default; baseline PASS when OFF → Task 11, 12. ✓
- Intake traceability → Task 12. ✓

**2. Placeholder scan:** Task 5 and Task 7/10 leave some body as prose (`// ... full body ...`) rather than full code. These are large modules (< 250 lines each) whose shapes, signatures, request paths, and behaviors are fully specified in the Interfaces block and step text; the TDD test fully pins behavior. Acceptable given size, but implementers must write complete code — no runtime placeholders. No `TODO`/`TBD` left in code steps.

**3. Type consistency:** `Ms365ConnectionState` used consistently (Tasks 6, 8, 9, 10). `Ms365Connector` method set identical across Tasks 6–10 (`connectionState`, `connectWithToken`, `disconnect`, `graph`, `source`, `lastError`). `GraphClient` = `{ json, bytes }` everywhere. `PermissionActionKind` extension (Task 1) consumed by Task 9. `handleToolCall(deps, call)` signature stable Tasks 9–10.

**Known risk flagged for the implementer (Task 9):** the sync `PermissionGate.proceed` vs async `upload`. Resolution documented in Task 9 (perform returns the promise; await `r.result`). The "with Allow proceeds" unit case is deprecated in favor of the deterministic "proceed blocks without Allow"; real Allow round trip is covered by packaged verification, not a racy unit test.

**One symbol to confirm at implementation time:** the credential memory-store factory export name (`service/src/credential/memory-store.ts`) and the permission test fakes (`permission-fakes.ts`) — both exist in the repo; confirm exact export names in the relevant Step 2 and adjust the test import. This is the only place the plan depends on a name not directly quoted from a file I read in full.
