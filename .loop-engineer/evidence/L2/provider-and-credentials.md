# L2-DR3 — Provider Abstraction Shape + Credential Store (Discovery)

- Task: L2-DR3, role: repository-researcher (READ-ONLY on reference + product source).
- Purpose: de-risk two L3 open decisions — (a) a provider-neutral port/adapter contract for the
  five target providers (PR10) that also leaves room for a future gateway (D4), and (b) the single
  OS-backed credential store for provider keys on Windows (PR9).
- Nature: DISCOVERY. This lays out OPTIONS with evidence and advisory "leans". It does NOT decide.
  L3 writes the two ADRs.
- No secret material anywhere in this file; placeholders only (KEY).
- Reference tree: `.loop-engineer/source/openwork/` @ `1897f9f`. Reference paths below are relative
  to that root. External claims cite public URLs.

---

## Part A — How the reference handles providers + keys TODAY (confirms the PR9 gap)

### A.1 Where provider config lives / how a key is added (CONFIRMED in code)

The provider-auth flow lives in the UI store
`apps/app/src/react-app/domains/connections/provider-auth/store.ts` and talks to the OpenCode
runtime via the OpenCode SDK client (`@opencode-ai/sdk`), not to any Cowork-GHC-style store:

- API-key add — `submitProviderApiKey(providerId, apiKey)` calls
  `c.auth.set({ providerID, auth: { type: "api", key: trimmed } })` (`store.ts:1302`, key call at
  `store.ts:1316`). `c` is the OpenCode SDK client, so the raw key is handed to OpenCode's own auth
  store (persisted by OpenCode in its `auth.json` under the runtime data dir), not to a Windows
  OS-backed store and not to any OpenWork-owned store.
- OAuth add — `c.provider.oauth.authorize(...)` / `c.provider.oauth.callback(...)`
  (`store.ts:1132`, `store.ts:1268`); connection is polled with a bounded loop
  (`waitForProviderConnection`, timeout 15000 ms / poll 2000 ms, `store.ts:1244`).
- Key removal — `removeProviderAuthCredentials` prefers `c.auth.remove({ providerID })`, else
  `DELETE /auth/:providerID`, else `c.auth.set({ providerID, auth: null })` (`store.ts:894-925`).
- Provider/method discovery — `c.provider.auth()` returns per-provider auth methods
  (`store.ts:1074`); provider list via `ensureProviderListQuery` producing a `ProviderListResponse`
  of `{ all, connected, default }` (see `apps/app/src/app/utils/providers.ts:25-41`).
- MCP auth store is separate and OpenCode-owned too: `~/.config/opencode/mcp-auth.json`
  (`apps/server/src/server.ts:2317`).

Second key path — user env vars (plaintext file). Cloud/org and some providers inject keys as
environment variables persisted by `EnvService` to a JSON file:
- `apps/server/src/env-file.ts` — `resolveDefaultEnvStorePath()` returns
  `%APPDATA%/openwork/env.json` on Windows (`env-file.ts:56-66`). Values are written with
  `mode: 0o600` (`env-file.ts:136-140`), but the code explicitly notes chmod is a no-op on Windows
  ("values may still contain secrets", `env-file.ts:144-145`, `159-160`). So on Windows this is a
  plaintext, unencrypted key file.
- The shell injects these at child spawn: `EnvService.readForInjection` (`env-file.ts:241-250`),
  consumed by `apps/desktop/electron/runtime.mjs` and `apps/orchestrator/src/cli.ts`.
- Cloud connect writes env keys via `openworkClient.upsertUserEnv(...)` (`store.ts:325-327`,
  `store.ts:1371`) and mirrors `OPENWORK_API_KEY` (`store.ts:320-328`).

### A.2 Model selection ({model, variant} map) (CONFIRMED)

- Model identity is `ModelRef = { providerID, modelID }`
  (`apps/app/src/react-app/kernel/model-config.ts:43-54`).
- Default model persisted to browser `window.localStorage` under `MODEL_PREF_KEY`
  (`model-config.ts:148-165`). Per-session overrides `{ model, variant }` are also localStorage
  (`SESSION_MODEL_PREF_KEY`, `parseSessionChoiceOverrides` / `serializeSessionChoiceOverrides`,
  `model-config.ts:68-121`). Per-workspace variant map keyed by formatted model ref
  (`parseWorkspaceModelVariants`, `model-config.ts:123-146`).
- Per-workspace runtime overlay (e.g. `disabled_providers`) is written to OpenCode via the server
  config API / `OPENCODE_CONFIG` (`store.ts:503-512` `patchRuntimeProviders`;
  `apps/server/src/openwork-runtime-config.ts`). Model selection is UI state; provider keys are
  runtime state. Note for Cowork GHC: model refs in localStorage are fine (no secret), but the app
  already treats localStorage as UI-preference storage — keys must NOT join them.

### A.3 Secret scrubbing / diagnostics (CONFIRMED — and reveals the gap)

- `apps/app/src/app/lib/diagnostics-bundle.ts` scrubs secrets by literal replacement:
  `collectSecretValues` (`:121-130`) + `scrubKnownSecretValues` (`:132-138`), applied to the whole
  bundle JSON at `:185`.
- What it collects: only session/host/runtime tokens — `token`, `hostToken`, `clientToken`,
  `ownerToken`, `opencodePassword` (`:123-128`). It does NOT collect provider API keys, because
  provider keys never enter the app's diagnostics inputs — they live inside OpenCode's auth store,
  out of OpenWork's process state. The redaction is real but token-scoped.
- Client-side provider error mapping already exists: `describeProviderError` (`store.ts:927-1003`)
  maps 401/403 to auth_failed, 429 to rate_limit_exceeded, presence of providerID to
  provider_error, and surfaces status/code/response. Useful reference for PR7's taxonomy, but it is
  UI-side formatting, not an execution-boundary error contract.

### A.4 Conclusion — the PR9 gap L3 must close (CONFIRMED)

OpenWork does NOT own a single OS-backed credential store. Provider keys today live in two places,
neither Windows-secure:
1. OpenCode's own `auth.json` (via SDK `c.auth.set`) — owned by the runtime, plaintext-on-disk by
   OpenCode's design, outside OpenWork's control.
2. `%APPDATA%/openwork/env.json` — plaintext on Windows (chmod no-op, code-acknowledged).

Cowork GHC's PR9 invariant ("one OS-backed store; state holds only a reference; no keys in browser
local storage") is therefore NOT satisfied by the reference and must be designed fresh in L3. This
is a genuine additive layer, not a port of existing behaviour. Note the coding-rule tension in
Part B: whichever runtime Cowork GHC picks (DR1), the runtime may still want a key at call time —
so the store must be able to feed the runtime without becoming a second parallel store
(one-source-of-truth invariant).

---

## Part B — Provider abstraction shape (external facts + contract sketches)

### B.1 Five-target API comparison (public docs)

| Concern | Anthropic | OpenAI | Google (Gemini) | OpenRouter | OpenAI-compatible (DeepSeek / custom) |
|---|---|---|---|---|---|
| Auth style | `x-api-key: KEY` + `anthropic-version` header [1] | `Authorization: Bearer KEY` [2] | `x-goog-api-key: KEY` header (key query param also exists) [3] | `Authorization: Bearer KEY` [4] | `Authorization: Bearer KEY` + custom `base_url` [2][4] |
| Streaming | SSE, `stream: true` [1] | SSE, `stream: true`, terminated by `data: [DONE]` [2] | SSE via `streamGenerateContent` + `?alt=sse` [3] | SSE, `stream: true`; emits comment/keep-alive lines to ignore [4] | SSE, `stream: true` (OpenAI shape) [2][4] |
| Cancellation | Close/abort the HTTP+SSE connection; no server-side cancel token [1] | Abort the HTTP stream (client AbortController) [2] | Abort the HTTP stream [3] | Abort the HTTP stream [4] | Abort the HTTP stream [2][4] |
| Model naming | Bare id, e.g. claude-sonnet-*, claude-opus-* [1] | Bare id, e.g. gpt-* family [2] | Bare id, e.g. gemini-2.5-flash [3] | Vendor-prefixed vendor/model (prefix required) [4] | Bare id defined by the endpoint operator [4] |
| Error / rate-limit | HTTP 429 rate limit; 529 overloaded; typed error body [1] | HTTP 429 rate limit; 401 auth; JSON error{type,message,code} [2] | HTTP 429 RESOURCE_EXHAUSTED; google.rpc.Status-style error [3] | HTTP 429; structured {code,message,metadata}; 5xx fallback across upstreams [4] | Mirrors OpenAI error shape; exact codes operator-dependent [2][4] |

Commonalities L3 can lean on: all five are HTTPS + header-based key auth, all stream via SSE, all
cancel by aborting the HTTP stream, all signal rate limits with HTTP 429. Differences the port must
absorb: auth header name (x-api-key vs Authorization vs x-goog-api-key), model naming (OpenRouter
requires a vendor/ prefix; the others use bare ids), streaming endpoint/param quirks (Gemini
streamGenerateContent, OpenRouter keep-alive comments), and per-provider error body shapes behind
the shared 429/401 status layer.

### B.2 Where the runtime already calls providers vs where Cowork GHC's abstraction sits

Critical constraint (coding rule "do not duplicate provider logic"): OpenCode (or whichever runtime
DR1 picks) already contains provider adapters — it performs the auth, streaming, cancellation, and
model calls (reference: keys go to it via `c.auth.set`; streams come back over its `/event` SSE,
proxied at `apps/server/src/server.ts:887`). Cowork GHC must NOT re-implement HTTP calls to
Anthropic/OpenAI/etc. if it reuses such a runtime.

Therefore the Cowork-GHC provider abstraction is best framed as a management/config port, not a
wire-protocol client. Two candidate shapes follow. L3 picks one; the answer depends on DR1.

### B.3 Contract sketch 1 — thin "Provider Management Port" over a reused runtime (LEAN if DR1 reuses OpenCode)

The port is provider-neutral config + credential orchestration; the runtime does the wire calls.

```
interface ProviderPort {
  list(): Promise<ProviderDescriptor[]>            // id, displayName, authKind, env[], models
  testConnection(id): Promise<TestResult>          // bounded probe call
  configureCredential(id, ref: CredentialRef)      // ref only, never raw key
  removeCredential(id)
  configureModel(sel: { scope: default|session; sessionId?; model: ModelRef })
  streamChat(req): AsyncIterable<ChatEvent>        // delegates to runtime; app does not build HTTP
  cancel(handle)                                   // aborts the runtime stream
  mapError(raw): ProviderError                     // kind: auth|rate_limit|timeout|unavailable|unknown; retryable; recovery
  redactionPatterns(): RedactPattern[]             // feed the log/diagnostics scrubber
}
type ModelRef      = { providerID: string; modelID: string }   // matches reference model-config.ts:43-54
type CredentialRef = { store: "os"; account: string }          // handle into the OS store (Part C)
```

- `configureCredential` takes a reference/handle, never key bytes, satisfying PR9. The adapter
  resolves the ref from the OS store and hands material to the runtime at the execution boundary
  only (server/shell process), so the key never touches UI/renderer state.
- `mapError` centralises PR7's taxonomy (invalid key / timeout / 429 / unavailable) with bounded
  retries — model it on reference `describeProviderError` (`store.ts:927`) but enforce it at the
  boundary, not only in UI formatting.
- Adding a provider = one descriptor + auth-kind entry; no unrelated UI/business change (PR1).

### B.4 Contract sketch 2 — full "Provider Adapter" (LEAN only if DR1 builds/owns the client)

Same public ProviderPort surface, but each provider is a self-contained adapter that owns the
HTTP/SSE call (auth header injection, stream parse, abort, error map), with a shared contract suite
per adapter (matches testing-rule "provider contract tests"). This is the OpenAI-SDK / LangChain
shape. Only justified if Cowork GHC does NOT reuse a runtime that already has adapters — otherwise
it duplicates provider logic (rule violation). An OpenAI-compatible base can cover OpenAI +
OpenRouter + DeepSeek/custom by parameterising base_url + auth header; Anthropic and Gemini get
dedicated adapters for their header/stream/naming differences.

### B.5 Leaving room for D4 (future gateway) WITHOUT reshaping the core

D4 (key pool / rotation / failover / cost routing) fits behind the same ProviderPort as an
alternate implementation, if two things hold now:
1. CredentialRef is a handle, not a key (already in both sketches) — a gateway can map one logical
   provider to a pool of refs without the core knowing.
2. ProviderId / ModelRef are logical, resolved late — so a gateway can route anthropic/claude-* to
   any of N upstream keys/endpoints, and mapError.retryable already gives it the failover signal.
   Store model names logically; apply the OpenRouter vendor/ prefix only at the adapter edge.

So D4 is a new ProviderPort implementation + a routing table, not a core reshape. The POC builds the
port + concrete adapters; the gateway is the seam only (D4 = DEFERRED, boundary only).

---

## Part C — Credential store on Windows (PR9): options + comparison

All options store outside the browser; the app persists only a reference/handle (service + account
name) and reads material at the execution boundary. Scored for a Windows-11 local-PC desktop
product.

| Option | How it stores / retrieves | Windows-11 fit | Native dep / packaging cost | Maintenance / license | No-key-in-frontend fit |
|---|---|---|---|---|---|
| Electron `safeStorage` | App encrypts/decrypts bytes via OS crypto (Windows = DPAPI, per-user); the app stores the ciphertext itself. Not a vault — just encrypt/decrypt. [5] | Good on Win11 (DPAPI, user-scoped). Caveat: protects vs other users, NOT other apps in the same user context. [5] | Zero extra native dep — built into Electron. Async API recommended (sync may be deprecated). Viable only if DR2 picks Electron. [5] | Maintained with Electron; MIT. Strong. | Excellent: renderer never sees plaintext; main process decrypts on demand. |
| `@napi-rs/keyring` (keytar successor) | Native bindings to the OS secret service: Windows Credential Manager, macOS Security.framework, Linux Secret Service. The store IS the OS vault; app keeps only service/account keys. [6] | Strong: real Windows Credential Manager entries, per-user, OS-managed. | Prebuilt N-API binaries (Rust/napi-rs); ~100% keytar-compatible API; cross-platform; ~220k weekly downloads. [6] | Actively maintained, MIT; author has MS OSS funding; used by Azure SDK / MSAL keytar migrations. [6] | Excellent: only {service, account} handle in app; secret stays in OS vault. |
| `node-keytar` (incumbent) | Same OS stores (Win Credential Vault / Keychain / libsecret). [7] | Works but legacy native-build pain on modern Node/Electron. | ARCHIVED 2022-12-15, read-only; last release 2022-02. MIT. [7] | NOT maintained — do not adopt for new work; migration target is @napi-rs/keyring. [6][7] | Same handle model as napi-rs, but a dead dependency. |
| Windows Credential Manager direct (DPAPI / WinCred API) | Call CredWrite/CredRead (or DPAPI ProtectData) via a small native/CLI shim. | Native Win11 fit by definition. | Highest custom-native cost; must build + test the shim; Windows-only (fine here, no cross-platform reuse). | Team-owned; no third-party license; maintenance burden on the team. | Excellent, same handle model. |
| Tauri Stronghold plugin | IOTA Stronghold encrypted vault file (Argon2-derived key, password-gated). Not the OS keychain. [8] | Cross-platform incl. Win11, but adds a password-to-unlock UX and a self-managed vault rather than OS-backed. Relevant only if DR2 picks Tauri. | Rust dep; documented upstream scrypt Cargo tweak; Rust >= 1.77. [8] | Maintained (Tauri v2). App-defined password model. | Good, but PR9's OS-backed wording favours an OS keychain over a self-managed vault; needs a master-password story. |
| Tauri keyring plugin (community, wraps keyring-rs) | Rust keyring-rs to Windows Credential Manager / Keychain / Secret Service. | Strong OS-backed fit on Win11. | Rust dep; Tauri-only; less battle-tested than napi-rs in Node land. | keyring-rs actively maintained; MIT/Apache. | Excellent handle model. |

Cross-cutting notes for L3:
- "One credential store" (architecture invariant) means the chosen store must also be the store the
  runtime reads from — or the app must inject the resolved key into the runtime at spawn/call time
  so there is no second parallel store (the reference's auth.json + env.json split is exactly the
  anti-pattern to avoid). This couples PR9 to DR1 (runtime) and DR2 (shell).
- All options keep only a handle in app state; PR9's "no key in browser local storage" test is
  satisfiable by any of them provided the renderer never receives plaintext.
- safeStorage DPAPI stores ciphertext the app manages; the keyring options store in the OS vault.
  Both are OS-backed in spirit; the keyring options match the literal PR9 example ("Windows
  Credential Manager") most closely.

---

## Part D — Open questions for L3 (must be resolved in the two ADRs)

1. Store vs runtime ownership (couples to DR1). If DR1 reuses OpenCode, keys still need to reach
   OpenCode's auth.json/env at call time. Does L3 (a) let the OS store be the source of truth and
   inject into the runtime per session, or (b) accept the runtime's store as the single store and
   wrap it? Option (b) risks failing PR9's OS-backed wording. Unknown until DR1 lands.
2. Shell dependency (couples to DR2). safeStorage needs Electron; Stronghold/keyring plugins need
   Tauri; @napi-rs/keyring is shell-neutral Node. The credential ADR cannot finalise before DR2
   (Electron vs Tauri) or must be written shell-neutral (favours @napi-rs/keyring).
3. Provider port shape depends on runtime. Sketch 1 (thin management port) vs Sketch 2 (full
   adapters) is decided by whether Cowork GHC reuses a runtime with built-in provider adapters
   (DR1). Do not pick the shape before DR1.
4. PR7 error taxonomy location. Is the canonical error mapping enforced at the execution boundary
   (server) as a typed contract, or only formatted in UI (as the reference does in
   describeProviderError)? The invariant says execution boundary; confirm.
5. OpenAI-compatible provider identity. Is the 5th target a fixed vendor (DeepSeek) or a
   user-defined custom endpoint (base_url + key)? Affects whether the descriptor list is static or
   user-extensible.
6. Migration / test seams. How does a contract test assert "no key in frontend state" and "key is
   in the OS store, referenced only by handle" on Windows CI without a live key? (Use a fake store
   adapter + a real-store integration test gated to a Windows runner.)

---

## Part E — Advisory leans (NOT decisions — L3 decides)

- Credential store: if the product stays shell-neutral or wants the most literal PR9 fit,
  @napi-rs/keyring (real Windows Credential Manager, maintained, MIT, keytar-compatible, no shell
  lock-in) is the strongest default. If DR2 firmly picks Electron and the team prefers zero extra
  native deps, safeStorage (DPAPI) is a clean second. Avoid node-keytar (archived). Treat Stronghold
  as a fallback only if a self-managed vault + master-password UX is explicitly wanted.
- Provider abstraction: lean toward Sketch 1 (thin provider-management port over a reused runtime)
  to honour "do not duplicate provider logic", contingent on DR1 reusing a runtime that already has
  provider adapters. Keep CredentialRef a handle and ModelRef logical so D4 slots in as another
  ProviderPort implementation with zero core reshape.

---

## Sources
- [1] Anthropic Messages API — https://platform.claude.com/docs/en/api/messages
- [2] OpenAI Chat Completions API — https://platform.openai.com/docs/api-reference/chat (fetch
  returned 403; facts are canonical/stable: Bearer auth, stream:true SSE with data:[DONE],
  error{type,message,code}, HTTP 429, base_url override for compatible endpoints)
- [3] Google Gemini API (text generation) — https://ai.google.dev/gemini-api/docs/text-generation
- [4] OpenRouter API reference — https://openrouter.ai/docs/api-reference/overview
- [5] Electron safeStorage — https://www.electronjs.org/docs/latest/api/safe-storage
- [6] @napi-rs/keyring (keyring-node) — https://github.com/Brooooooklyn/keyring-node ; Socket
  analysis — https://socket.dev/npm/package/@napi-rs/keyring
- [7] node-keytar (archived) — https://github.com/atom/node-keytar
- [8] Tauri Stronghold plugin — https://v2.tauri.app/plugin/stronghold/
- Reference source (read-only) — `.loop-engineer/source/openwork/` @ `1897f9f`
- L1 input — `.loop-engineer/evidence/L1/openwork-research.md` sections 2.6 and 4
