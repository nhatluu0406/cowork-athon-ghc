# Requirements Baseline Review

**Status:** COMPLETE (L1 Requirement Baseline).
**Final classification of `docs/openwork-requirements-and-basic-design.md`: VALID_WITH_GAPS.**

The OpenWork analysis document is accurate and honestly hedged; it is used as **research
input** to build Cowork GHC's own requirement baseline, and is **not rewritten**. Cowork
GHC's owned scope/acceptance lives in `docs/product/cowork-ghc-scope-and-acceptance.md`.

## Evidence

- `.loop-engineer/evidence/L1/openwork-research.md` — full-read doc classification +
  capability inventory (verdict VALID_WITH_GAPS), verified against reference HEAD
  `1897f9f`.
- `.loop-engineer/evidence/L1/reference-delta.md` — reference churn `00190e5..1897f9f`
  (11 commits) is ~91% concentrated in out-of-scope `ee/` (75 files) and `evals` (25);
  the POC-relevant surface (`apps/server` 0 changed, `apps/orchestrator` 0 changed,
  `apps/app` 5, `apps/desktop` 4) is stable.

## Confirmed structural claims (at HEAD `1897f9f`)

- Four-layer split present: `apps/app` (UI), `apps/desktop` (Electron shell),
  `apps/server`, `apps/orchestrator` (research §1).
- Desktop shell is **Electron, not Tauri** (no `src-tauri/`); README's Tauri build
  instructions are stale (research §1, §4).
- OpenCode is the external pinned runtime: `constants.json` = `v1.17.11` (research §1, §3).
- Server owns workspace state, loopback default (`DEFAULT_HOST=127.0.0.1`), path guards,
  atomic writes, audit; permission enforced at the execution boundary with a fail-closed
  approval timeout (research §1, §2.4, §3).

## Gaps (why VALID_WITH_GAPS, not VALID)

1. **Commit drift** — doc authored at `00190e5`, checkout at `1897f9f`; no history diff
   possible on a shallow clone, and large-file line numbers may have shifted (treat exact
   line cites as approximate). Structural/runtime drift risk is low (reference-delta).
2. **Credential store under-specification** — the doc does not pin where provider API
   keys are stored; evidence shows keys live in OpenCode's own auth store, i.e. OpenWork
   does **not** own a single credential store (research §4). This conflicts with Cowork
   GHC's "one OS-backed credential store, no keys in browser local storage" invariant.
   Captured as MUST **PR9** in the scope doc and flagged as needing an L3 ADR.
3. **Overstated / unbuilt features** — Templates (FR-040), Marketplace (FR-041), and
   Memory bank (FR-042) are not implemented in the reference (research §4). Cowork GHC's
   scope stands on its own and does **not** inherit these as requirements; where Cowork
   GHC keeps a template capability (RE4, SHOULD) it is defined fresh, not imported.

## Decision

Use the analysis document as research input only. Do not fork/clone/rebrand OpenWork and
do not rewrite the analysis doc. The Cowork-GHC-owned requirement baseline (capability
matrix, MUST/SHOULD/COULD/DEFERRED/OUT_OF_SCOPE classification, testable acceptance,
Windows lifecycle acceptance, deferred/out-of-scope boundary, open L3 decisions, and
MUST→area traceability) is delivered in
`docs/product/cowork-ghc-scope-and-acceptance.md`. Counts: 66 capabilities classified
(41 MUST, 15 SHOULD, 2 COULD, 5 DEFERRED, 3 OUT_OF_SCOPE).
