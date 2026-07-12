# L3 — Architecture Authoring Notes (for the reviewer + gate)

Loop L3 (Architecture Candidates), task L3-A1. Drafts ADRs + implementation design; makes the six
decisions (Status: **Proposed** — L4 freezes). No feature/product code written; no builds/tests
run; no live LLM/provider calls; reference source untouched.

## Deliverables

- `docs/architecture/decisions/0001`–`0006` + `README.md` index.
- `docs/architecture/cowork-ghc-implementation-design.md` (coherent design tying the ADRs together).
- This note.

## Each ADR: decision + single strongest L2 citation

| ADR | Decision | Strongest L2 citation |
|---|---|---|
| 0001 Runtime + persistence | Reuse OpenCode, pinned single-owner child; OpenCode owns session content, Cowork GHC owns only settings/light metadata; `/ee` boundary; pin+upgrade-test policy | `runtime-candidates.md` §1.2 (`constants.json:2` pin), §1.6 (`opencode-db.ts:54-66` owns SQLite), §5 (HIGH gaps); discovery-report §3.1, §3.6 |
| 0002 Desktop shell | Electron (closest call); Tauri recorded with explicit footprint/security revisit condition | `desktop-shell-and-lifecycle.md` §1.1 (`electron-builder.yml:1-3,37-39` completed Tauri→Electron migration), §2 Testability + Node/TS-fit rows, §6; discovery-report §3.2 |
| 0003 Transport/placement/loopback | HTTP+SSE baseline; **standalone** loopback service; P7 test | `desktop-shell-and-lifecycle.md` §3 (transport candidates, `config.ts:48` loopback, `runtime.mjs:391-417` port bind), §1.5 (reference embeds — the model we diverge from for testability); discovery-report §3.5 |
| 0004 Windows lifecycle/supervision | One-owner chain; `.runtime/pids/*.json` schema; identity-verified stale-PID; graceful-then-`taskkill /T`/Job Object; no admin | discovery-report §4 (HIGH: `runtime.mjs:1072` `ps` Unix-only; SIGTERM not graceful on Windows); `desktop-shell-and-lifecycle.md` §4 (scaffold gaps in `lifecycle.mjs`) |
| 0005 Provider abstraction | Thin provider-neutral `ProviderPort` over the runtime; PR7 at boundary; 5th = user-defined OpenAI-compatible; D4 seam only | `provider-and-credentials.md` B.2 (runtime already owns adapters → no duplicate logic), B.3 (port sketch), B.5 (D4 seam); discovery-report §3.3 |
| 0006 Credential store | `@napi-rs/keyring` (Windows Credential Manager); inject-at-launch, never `c.auth.set` (SEC-1); scrubber covers keys (SEC-2) | `provider-and-credentials.md` A.1/A.4 (`store.ts:1316` `c.auth.set`, `env-file.ts:144-145` chmod no-op = confirmed PR9 gap), Part C table (`@napi-rs/keyring` row); review-dispositions SEC-1/SEC-2 |

## Carried-forward constraints — where encoded

- **SEC-1** (inject-at-launch; never `c.auth.set`/`env.json`; negative test on disk + frontend
  snapshot): ADR 0006 §"HARD CONSTRAINT" + design §6.
- **SEC-2** (scrubber must cover provider key material): ADR 0006 §SEC-2 + ADR 0005
  `redactionPatterns()` + design §6.
- **/ee Fair Source boundary** (never copy `/ee`): ADR 0001 §5 + design §7 (OOS1).
- **L5 automated transitive license scan** (PA-1 residual): noted in ADR 0001 §5 and ADR 0006.
- **PA-3** (fold persistence into the runtime ADR): ADR 0001 §Decision.2.

## Decisions that DIVERGE from the L2 advisory lean (flagged for L4)

- **Service placement = standalone** (L2 documented the reference as embedded-in-Electron-main and
  did not lean; chose standalone for headless testability + boundary clarity + shell-neutrality).
- **5th provider = user-defined custom OpenAI-compatible endpoint** (task left fixed-DeepSeek vs
  custom open; chose custom as strictly more general).
- All other decisions adopt the directed L2-grounded positions.

## Acceptance self-check

- All six decisions DECIDED with rationale + L2 citations + alternatives + traceability. Yes.
- Invariants honored; nothing contradicts L1 scope. Yes (design §1, traceability §10).
- Carried-forward constraints explicitly encoded. Yes (above).
- No feature code; ADRs marked Status: Proposed (L4 freezes). Yes.
