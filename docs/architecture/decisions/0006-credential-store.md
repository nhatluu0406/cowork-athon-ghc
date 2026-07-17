# ADR 0006 — Credential Store: `@napi-rs/keyring` (Windows Credential Manager), Inject-at-Launch

- Status: **Accepted** — FROZEN in Loop L4 (Architecture Review), 2026-07-11. Ratified after multi-role critique + threat model. Supersedes the L3 Proposed draft.
- Date: 2026-07-11
- Loop: L3 (Architecture Candidates)
- Deciders: product-architect (L3); to be ratified by the L4 critique + freeze.
- Requirement drivers: PR9 (one OS-backed store; no keys in browser local storage; state holds
  only a reference), PR2 (add credential), PR8 (redaction), SD3 (redacted logs). Carries **SEC-1**
  and **SEC-2** from `.loop-engineer/evidence/L2/review-dispositions.md`.
- Related ADRs: 0001 (runtime), 0002 (shell), 0005 (provider port).

## Context

L2 (`provider-and-credentials.md` Part A/C; discovery-report §3.4) **CONFIRMED the PR9 gap in
code**: the reference stores provider keys in two places, neither Windows-secure —

1. OpenCode's own `auth.json` via the SDK `c.auth.set` (`store.ts:1302,1316`), and
2. a plaintext `%APPDATA%/openwork/env.json` whose `chmod 0o600` is a **code-acknowledged no-op on
   Windows** (`env-file.ts:144-145`).

The reference diagnostics scrubber (`diagnostics-bundle.ts:121-138`) only redacts session/host
tokens, **not** provider keys. So PR9 is a genuine additive layer, not a port. L2 scored six store
options; `node-keytar` is archived (avoid); Tauri Stronghold/keyring are shell-locked; the two
shell-neutral / most-literal-PR9 candidates are Electron `safeStorage` (DPAPI, Electron-only) and
**`@napi-rs/keyring`** (real Windows Credential Manager, shell-neutral, MIT, maintained).

## Decision

**Adopt `@napi-rs/keyring`, backed by Windows Credential Manager, as the single OS-backed
credential store.** It is the most literal PR9 fit ("Windows Credential Manager"), shell-neutral
(so this ADR does not depend on ADR 0002 and survives a Tauri revisit), MIT, actively maintained,
and keytar-API-compatible. Electron `safeStorage` (DPAPI) is recorded as the **accepted
alternative** since the shell is Electron (ADR 0002).

### One store, handle-only state

- The **only** persisted representation of a credential in app state is a **handle**
  `CredentialRef = { store: "os", account }` (ADR 0005). The store IS the Windows Credential
  Manager entry; app/session state and the renderer hold no key bytes.
- **No key material in browser local storage, DOM, frontend state, or logs.** Model preferences and
  provider settings do **not** live in browser local storage: they live in the **service settings
  store**, which is the single source of truth for them (§4 of the design doc). The renderer holds no
  authoritative provider/model settings and, regardless, **no secrets** ever go to local storage
  (`provider-and-credentials.md` A.2).

### HARD CONSTRAINT — inject-at-launch via ENV, never persist to the runtime store (SEC-1)

**Concrete mechanism.** Keys live in `@napi-rs/keyring` (Windows Credential Manager). At child
launch the **local service** reads the key from the keyring and injects it as a **per-provider
environment variable** into the OpenCode child's spawn env. OpenCode resolves provider keys from its
process environment (reference: `env-file.ts:3-12`; `cloud-provider-config.ts:43-66,150`), injected
via a `buildChildEnv` → `spawn({ env })` path (reference: `runtime.mjs:769-805`, `1017-1023`). Env
injection is the **default and only sanctioned channel** (AC6).

- Cowork GHC **never** calls OpenCode's `c.auth.set` (`store.ts:1316`) and **never** writes the
  runtime's `auth.json` or `env.json`. **Writing OpenCode's default `auth.json` is FORBIDDEN.**
  There is exactly **one** at-rest store (Windows Credential Manager); the runtime receives keys
  transiently, in the child's in-memory environment, per launch.

**Custom OpenAI-compatible provider (5th target, ADR 0005).** `base_url` is supplied via the
provider config `options.baseURL`; the key via env / `options.apiKey`
(reference: `cloud-provider-config.ts:109-183`). No cleartext file is written for the custom
provider either.

**Pin-gated prerequisite (tie to ADR 0001 pin/upgrade gate).** The exact per-provider env var names
for **OPENAI / OPENROUTER / GEMINI** are defined inside the pinned OpenCode binary (v1.17.11) and are
**not vendored** into this repo. **L6 MUST confirm the exact env var names via a bounded, keyless
spike** (start the pinned binary, observe which env vars it reads for each provider) **before**
relying on them. This confirmation is a prerequisite gated to the ADR 0001 pin: any OpenCode version
bump re-runs the spike.

### SEC-1 acceptance criteria the freeze adopts (AC1–AC6)

- **AC1** — the key is resolved **only inside the local service**, at child launch (never earlier,
  never elsewhere).
- **AC2** — the key is **never persisted** to any stable / backup / diagnostics / clean-preserved
  location (no `auth.json`, no `env.json`, no app-state file, no `.runtime/`).
- **AC3** — the key **never crosses to the renderer**: never in frontend state, DOM, or browser
  local storage.
- **AC4** — the key is **redacted by VALUE everywhere**, including the diagnostics bundle and the
  execution-metadata record.
- **AC5** — proven by **negative tests for BOTH** a standard provider **AND** the user-defined custom
  provider: the key is absent from disk, from logs, and from a frontend-state snapshot.
- **AC6** — **env injection is the default and only sanctioned channel** for handing keys to the
  runtime.

- **Required negative tests (Windows):**
  1. After configuring a credential and running a session, assert **no key material** appears in the
     runtime's `auth.json`/`env.json` on disk, nor in any Cowork-GHC app-state file (AC2), for both a
     standard and the custom provider (AC5).
  2. Assert **no key material** appears in any browser-local-storage / frontend-state snapshot (AC3).
  3. Contract test uses a **fake store adapter** for CI; a **real-store integration test** is gated
     to a Windows runner (`provider-and-credentials.md` D.6). No live key in logs.

### SEC-2 — scrubber must match the secret VALUE, not just the env-var NAME (PR8/SD3)

The reference redacts **by env-var name** — `SECRET_ENV_PATTERN.test(name)` gates the replacement
(`managed-opencode.ts:27,87`). Name-only matching **leaks the value** wherever the same secret
appears outside a recognized name (a message body, a stack frame, a URL query, a serialized config).
Cowork GHC's scrubber MUST therefore match the secret **VALUE** itself: on resolving a key at the
boundary, its concrete value is registered with the scrubber and replaced by a placeholder anywhere
it appears. Name-based redaction may remain as a defense-in-depth layer but is **not** sufficient
alone.

`ProviderPort.redactionPatterns()` (ADR 0005) feeds the scrubber. **Scrubber coverage MUST include
the diagnostics bundle and the execution-metadata record** (in addition to logs, errors, and EV
events). A redaction test asserts a known placeholder key is scrubbed everywhere it could surface.
SD3: redaction stays on even with verbose/dev logging enabled.

### `chmod 0o600` is a no-op on Windows

The reference's `chmod 0o600` on its cleartext `env.json` is a **code-acknowledged no-op on
Windows** (reference: `env-file.ts`). Cowork GHC does **not** rely on filesystem permissions for
secret protection; protection comes from Windows Credential Manager plus **never writing cleartext
key material to disk at all**.

### License note

`@napi-rs/keyring` is MIT (discovery-report §3.6). The `/ee` Fair Source boundary (ADR 0001) is
unaffected. The automated transitive SPDX scan is an **L5** task (PA-1 residual).

## Consequences

- Positive: one OS-backed store, shell-neutral, most literal PR9 fit; renderer never sees plaintext;
  the reference's `auth.json` + `env.json` split anti-pattern is eliminated.
- Positive: survives a Tauri revisit (ADR 0002) without re-architecting credentials.
- Negative: adds a prebuilt N-API native dependency (packaging step, ADR 0004 asarUnpack-class
  concern under Electron); Windows Credential Manager protects against other users, not other apps
  in the same user context — acceptable for a local-PC POC and consistent with DPAPI's model.
- Constraint on ADR 0001: key injection must be transient and per-launch; the runtime store is
  never the source of truth.

## Alternatives considered

- **Electron `safeStorage` (DPAPI)** — accepted alternative; clean, zero extra native dep, but
  Electron-locked (breaks the ADR 0002 revisit condition) and stores app-managed ciphertext rather
  than a first-class OS vault entry.
- **`node-keytar`** — rejected: archived 2022, read-only, unmaintained.
- **Direct WinCred/DPAPI shim** — rejected: highest custom-native cost for no added benefit over
  `@napi-rs/keyring`.
- **Tauri Stronghold / Tauri keyring plugin** — rejected: shell-locked to Tauri; Stronghold adds a
  master-password UX and is a self-managed vault, less literal to PR9's OS-backed wording.
- **Accept OpenCode's `auth.json` as the single store** — rejected: fails PR9 (not OS-backed;
  plaintext on Windows) and violates SEC-1.

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| PR9 | Single OS-backed store (Windows Credential Manager); handle-only in state; no keys in local storage. |
| PR2 | Add credential → OS store; port holds a `CredentialRef`. |
| PR8/SD3 | Scrubber covers provider keys (SEC-2); redaction survives verbose logging. |
| SEC-1 | Inject-at-launch; never `c.auth.set`/`env.json`; negative tests on disk + frontend snapshot. |
| SEC-2 | `redactionPatterns()` feeds scrubber; redaction test asserts scrubbing everywhere. |

## Resolved at L4

- **Injection mechanism (runtime H1):** per-provider **env var** injected into the OpenCode child's
  spawn env by the local service at launch; OpenCode reads keys from process env. `auth.json`/
  `env.json` are never written; writing OpenCode's default `auth.json` is forbidden.
- **Redaction (security HIGH / SEC-2):** scrubber matches the secret **VALUE**, not just the env-var
  name; coverage extended to the diagnostics bundle and the execution-metadata record.
- **SEC-1 (security HIGH):** acceptance criteria AC1–AC6 adopted, including negative tests for both a
  standard and the custom provider.
- **localStorage:** model/provider settings live in the service settings store, not local storage.

## Prerequisite carried to L6 (gated to the ADR 0001 pin)

- Confirm, via a bounded **keyless** spike against the pinned OpenCode binary (v1.17.11), the exact
  per-provider env var names for OPENAI / OPENROUTER / GEMINI (not vendored). Re-run on any pin bump.

## Open items carried to L5/L6

- Confirm `@napi-rs/keyring` vs Electron `safeStorage` (shell-neutrality vs zero-extra-dep).
- Confirm the fake-store + gated-real-store test seam for Windows CI.
