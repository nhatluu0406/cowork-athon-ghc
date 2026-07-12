# Cowork GHC - Handoff

Updated: 2026-07-12 (L6 packaged acceptance PASS)

## Git anchor

- **Baseline tag:** `poc-core-v0.1` -> `c96b5b8` (verified Slice 4 core before GUI migration)
- **GUI shell:** `8e6ea21` - HuyTT12 application shell integrated
- **L6 acceptance:** pending commit `test(release): complete packaged L6 acceptance`
- **Slice 1:** `3856a84` - packaged service readiness + authenticated health verification
- **Slice 2:** `ff32d808` - packaged workspace picker, activation, persistence, relaunch restore, workspace switching
- **Slice 3:** `8f7abff` - packaged provider/model settings + Windows keyring credential + bounded DeepSeek test connection
- **Bootstrap fix:** `bd22583` - settings-only boot before live connect
- **Slice 4:** `fcd15af` / `c96b5b8` - packaged OpenCode live session + streaming + safe workspace action

## Current State

- Loop: `L6` Implementation = **COMPLETED**
- Gate: **PASS** (desktop POC packaged acceptance)
- `CGHC-028`: **DONE**
- Do **not** auto-start `L7`
- Web remains `DEFERRED`

## Verified (Packaged)

`dist-app/win-unpacked/Cowork GHC.exe` via `node tools/verify/l6-packaged.mjs`:

| Slice | Result |
|---|---|
| 5A Permission approve | PASS (real modal; fixture file created) |
| 5A Permission deny | PASS (real modal; file not created) |
| 5B Clean-profile onboarding | PASS |
| 5C Provider recovery | PASS (delete credential → error → restore → success) |
| 5D Interruption + relaunch | PASS (no orphans; no stale running state) |
| 5E Lifecycle | PASS (`init.bat`, `stop.bat`) |
| 5F UX | PARTIAL (Vietnamese step labels, provider errors, path tooltip, disabled hints) |

Evidence: `.loop-engineer/evidence/CGHC-028-l6-packaged-acceptance.md`

## Carry-forward (non-blocking for L6 POC)

- Template re-run / session resume packaged smoke
- Invalid-model / bad-base-URL provider-error legs (separate from missing-credential recovery)
- Full `start.bat` / `clean.bat` double-click evidence in L9
- L9 scripted regression beyond `l6-packaged.mjs`

## Precise Next Action

Product owner may activate **L7 Integration** when ready. First L7 work: template/session-resume packaged smoke + full L9 regression script + `start.bat`/`clean.bat` evidence.
