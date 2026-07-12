# ADR 0005 — Provider Abstraction: Thin Provider Management Port (PR1/PR10, D4-ready)

- Status: **Accepted** — FROZEN in Loop L4 (Architecture Review), 2026-07-11. Ratified after multi-role critique + threat model. Supersedes the L3 Proposed draft.
- Date: 2026-07-11
- Loop: L3 (Architecture Candidates)
- Deciders: product-architect (L3); to be ratified by the L4 critique + freeze.
- Requirement drivers: PR1 (provider-neutral), PR3 (test connection), PR4/PR5 (model select +
  live switch), PR7 (error taxonomy), PR8 (redaction), PR10 (five targets); D4 (deferred gateway).
- Related ADRs: 0001 (runtime owns wire calls), 0006 (credential store).

## Context

L2 (`provider-and-credentials.md` Part B; discovery-report §3.3) established:

- All five targets (Anthropic, OpenAI, Google Gemini, OpenRouter, one OpenAI-compatible) are
  HTTPS + header-key auth, stream via SSE, cancel by aborting the HTTP stream, and signal rate
  limits with HTTP 429. Differences the port must absorb: auth header name, model naming
  (OpenRouter needs a `vendor/` prefix), streaming quirks (Gemini `streamGenerateContent`), and
  per-provider error bodies behind shared status codes.
- **Critical constraint (coding rule "no duplicate provider logic"):** the reused runtime
  (OpenCode, ADR 0001) **already owns** the provider adapters — it performs auth, streaming,
  cancellation, and model calls. Re-implementing HTTP clients would duplicate provider logic.
- Two candidate shapes: (1) a thin **Provider Management Port** (runtime does the wire calls);
  (2) full **Provider Adapters** owning the HTTP/SSE (only if Cowork GHC builds/owns the client).

## Decision

**Adopt Sketch 1 — a thin, provider-neutral `ProviderPort` management port over the reused
runtime.** The runtime owns the wire calls; the port owns config, credential-ref orchestration,
error taxonomy, and redaction patterns. This is contingent on ADR 0001 (reuse OpenCode) and honors
"do not duplicate provider logic."

### Port interface (contract, refined in L5)

```ts
interface ProviderPort {
  list(): Promise<ProviderDescriptor[]>;        // id, displayName, authKind, requiredFields, models
  testConnection(id: ProviderId): Promise<TestResult>;      // bounded probe; PR3
  configureCredential(id: ProviderId, ref: CredentialRef): Promise<void>; // ref/handle ONLY — never key bytes
  removeCredential(id: ProviderId): Promise<void>;
  configureModel(sel: { scope: "default" | "session"; sessionId?: string; model: ModelRef }): Promise<void>;
  streamChat(req: ChatRequest): AsyncIterable<ChatEvent>;   // delegates to runtime; app builds no HTTP
  cancel(handle: StreamHandle): Promise<void>;              // aborts the runtime stream; S3
  mapError(raw: unknown): ProviderError;                    // PR7 taxonomy, enforced at the boundary
  redactionPatterns(): RedactPattern[];                     // feeds the log/diagnostics scrubber; PR8/SEC-2
}

type ModelRef      = { providerID: string; modelID: string };   // logical; matches reference model-config.ts:43-54
type CredentialRef = { store: "os"; account: string };          // handle into the OS store (ADR 0006) — NOT a key
```

- **`configureCredential` takes a handle, never key bytes** (PR9). The credential material is
  resolved from the OS store and injected into the runtime **only at the execution boundary** (the
  service/shell process) at launch/call time — never in the renderer, never persisted into the
  runtime's own store (SEC-1; enforced in ADR 0006).
- **`ModelRef` is logical and resolved late.** Provider-specific naming (e.g. the OpenRouter
  `vendor/` prefix) is applied only at the adapter edge, not stored in app state. Logical model
  refs are secret-free and safe to persist (ADR 0001).

### PR7 error taxonomy — enforced at the execution boundary

`mapError` is the **canonical** mapping, enforced at the service/execution boundary (not UI-only
formatting as the reference `describeProviderError`, `store.ts:927`, does). Taxonomy:

| Kind | Trigger | Retryable | Recovery surfaced to UI |
|---|---|---|---|
| `auth_invalid` | 401/403 | no | Re-enter/replace credential |
| `rate_limited` | 429 | bounded retry (capped, backoff) | Wait / reduce rate / switch model |
| `timeout` | no response in bound | bounded retry | Retry / cancel |
| `unavailable` | 5xx / network loss | bounded retry | Retry later / switch provider |
| `unknown` | anything else | no | Show mapped message + cancel |

Retries are **bounded** (no infinite loop, PR7). The typed `ProviderError` carries a recovery
action for EV6. The UI only *formats* these; it never invents error semantics.

### Five target providers (PR10)

Anthropic, OpenAI, Google (Gemini), OpenRouter, and **one OpenAI-compatible endpoint**. **Decision:
the 5th is a user-defined custom OpenAI-compatible endpoint (`base_url` + key + auth header)**, not
a fixed DeepSeek entry. Rationale: a user-defined descriptor is strictly more general (DeepSeek is
just one such configuration), it keeps the descriptor list user-extensible without core changes
(PR1), and it maps cleanly onto the OpenAI-compatible wire shape the runtime already supports. The
UI ships DeepSeek as a suggested preset, but the identity is "custom OpenAI-compatible." Providers
not exercised with a live key are clearly marked "not live-tested" (PR10).

### Custom endpoint SSRF policy (security MED-2 / test HIGH-2)

A user-defined `base_url` is an SSRF/exfil surface. The custom base_url maps to
`ProviderConfig.options.baseURL` (ADR 0006; reference `cloud-provider-config.ts:109-183`).

**Production policy — enforced at the SERVICE, not the UI:**

- Require `https`.
- Block **RFC-1918** (10/8, 172.16/12, 192.168/16), **link-local** (169.254/16), **loopback**
  (127/8, `::1`), and **cloud-metadata** (`169.254.169.254`) targets.
- Validate the **RESOLVED IP at connect time** (not just the hostname) to defeat **DNS rebinding**;
  re-validate on redirect.

**TEST-MODE loopback allowlist escape** — so a local mock endpoint can drive deterministic,
no-live-LLM tests:

- Gated by a **build-time constant AND an explicit launch flag**; **dead-code-eliminated in release**
  with a **startup hard-assert that REFUSES to start** if the flag is somehow set in a release build.
- **Never the default.** It relaxes **only explicit loopback**; link-local, cloud-metadata, and
  RFC-1918 stay blocked even in test mode. `http` is permitted **only on loopback** under the flag.
- Emits a **WARN banner + local audit event** whenever active.
- **Unreachable from the renderer / boundary API** (cannot be toggled by model-generated content or a
  UI call).
- A **release negative test proves the flag cannot relax the production policy** in a release build.

### D4 (future gateway) — seam only, DEFERRED

D4 (key pool / rotation / failover / cost routing) slots in as **another `ProviderPort`
implementation + a routing table**, with zero core reshape, because (a) `CredentialRef` is already
a handle (a gateway maps one logical provider to a pool of refs), and (b) `ProviderId`/`ModelRef`
are logical and resolved late, so a gateway can route to any of N upstreams and use
`mapError().retryable` as the failover signal (`provider-and-credentials.md` B.5). The POC builds
the port + delegation to the runtime; the gateway is boundary-only and **not built**.

## Consequences

- Positive: no duplicated provider logic (delegates to the runtime); adding a provider = one
  descriptor (PR1); PR7 enforced once at the boundary; D4 is a drop-in implementation.
- Positive: contract tests (connect, auth error, model, streaming, timeout, cancel, 429, error
  mapping, redaction) run against the port with a fake runtime, per the testing rules.
- Negative: the port is coupled to the runtime's capabilities; a runtime lacking a provider forces
  a gap the port must surface honestly rather than fake.

## Alternatives considered

- **Sketch 2 — full Provider Adapters owning HTTP/SSE** — rejected: only justified if Cowork GHC
  builds/owns the client (ADR 0001 reuses OpenCode), otherwise duplicates provider logic.
- **Fixed DeepSeek as the 5th provider** — rejected in favor of a user-defined custom
  OpenAI-compatible endpoint (more general; DeepSeek becomes a preset).
- **PR7 mapping in the UI only** — rejected: the invariant puts enforcement at the execution
  boundary; UI-only mapping cannot bound retries or guarantee redaction.

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| PR1 | Provider-neutral port; add a provider = one descriptor; no vendor hard-coded in core. |
| PR2 | `configureCredential(id, ref)` takes a handle to the OS store (ADR 0006); adding a provider credential never puts key bytes in app/UI state. |
| PR3 | `testConnection` bounded probe. |
| PR4/PR5 | `configureModel` (default + per-session); live switch via runtime config overlay (no restart). |
| PR7 | `mapError` taxonomy with bounded retries, enforced at the boundary, recovery per EV6. |
| PR8 | `redactionPatterns` feeds the scrubber (ADR 0006 §SEC-2). |
| PR10 | Five targets named; 5th = user-defined OpenAI-compatible; non-live marked. |
| D4 | Alternate `ProviderPort` impl + routing table; seam only, deferred. |

## Resolved at L4

- **SSRF (security MED-2 / test HIGH-2):** production policy (https-only; block RFC-1918/link-local/
  loopback/metadata; validate resolved IP at connect time) enforced at the service; a build-time +
  launch-flag test-mode escape relaxes only loopback, is dead-code-eliminated in release with a
  startup hard-assert, and is unreachable from the renderer. See "Custom endpoint SSRF policy."
- **Custom base_url mapping confirmed:** `ProviderConfig.options.baseURL`.

## Open items carried to L5/L6

- Confirm PR7 retry bounds/backoff parameters (L5 tunes values).
- Confirm the EV event model boundary (ADR 0001 §3) vs the raw runtime SSE for `streamChat`
  (see the design doc §5 EV event / client-state contract, load-bearing for L5).
