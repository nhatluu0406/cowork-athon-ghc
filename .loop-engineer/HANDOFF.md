# Cowork GHC - Handoff

Updated: 2026-07-12 (HuyTT12 GUI packaged PASS)

## Git anchor

- **Baseline tag:** `poc-core-v0.1` -> `c96b5b8` (verified Slice 4 core before GUI migration)
- **Current GUI integration commit:** pending
- **Slice 1:** `3856a84` - packaged service readiness + authenticated health verification
- **Slice 2:** `ff32d808` - packaged workspace picker, activation, persistence, relaunch restore, workspace switching
- **Slice 3:** `8f7abff` - packaged provider/model settings + Windows keyring credential + bounded DeepSeek test connection
- **Bootstrap fix:** `bd22583` - settings-only boot before live connect
- **Slice 4:** `c96b5b8` - packaged OpenCode live session + streaming + safe workspace action

## Current State

- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- HuyTT12 GUI presentation: **integrated into `app/ui`**
- Packaged GUI regression: **PASS**
- `CGHC-028`: **IN_PROGRESS** (full L9 journey not complete)
- Do not start `L7`
- Web remains `DEFERRED`

## Verified (Packaged)

`dist-app/win-unpacked/Cowork GHC.exe`:

| Area | Verified |
|---|---|
| HuyTT12-style shell | New sidebar/chat/composer/right-panel/settings UI renders |
| Service | Settings-only boot connects; live starts only after explicit session action |
| Workspace | Native picker selects fixture workspace; service validates/persists |
| Provider/model/keyring | Restored through service settings; no `.env` import in packaged GUI verifier |
| OpenCode session | Explicit start, prompt send, streaming response |
| Safe file action | Fixture file created in selected workspace and shown in right panel |
| Cancellation | Visible cancel reaches cancelled state |
| Cleanup | No owned `Cowork GHC.exe` / `opencode.exe` orphan after close |

Evidence:

- `.loop-engineer/evidence/CGHC-028-huytt12-gui-packaged.md`
- `docs/references/huytt12-gui.md`
- Verify: `node tools/verify/gui-packaged.mjs`

## Still Open

- Real pending permission request was not observed during packaged safe file action; permission modal/controller are wired and covered by focused tests.
- Full stop/resume/clean L9 journey.
- Provider-error packaged E2E.
- Template re-run/session resume packaged smoke.

## Precise Next Action

Continue `CGHC-028`: trigger/verify a real packaged permission request if supported, then complete stop/resume/clean and provider-error packaged legs. Do **not** start L7.
