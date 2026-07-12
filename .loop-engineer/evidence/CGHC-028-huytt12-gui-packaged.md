# CGHC-028 — HuyTT12 GUI packaged integration

Date: 2026-07-12

Target: `dist-app/win-unpacked/Cowork GHC.exe`

## Scope

Integrated the HuyTT12 GUI presentation direction into the real Cowork GHC renderer:

- HuyTT12-style app shell, sidebar, conversation area, composer, right activity panel, settings modal.
- Existing shell bridge and `service-client` remain the only renderer boundaries.
- Existing Cowork GHC service, Windows keyring, OpenCode, DeepSeek, workspace validation, event stream and lifecycle remain unchanged.
- HuyTT12 main/preload/mock backend code was not imported.

## Verification

Command:

`node tools/verify/gui-packaged.mjs`

Observed:

- New GUI shell renders in packaged app.
- Local service connects.
- Fixture workspace selected via native picker.
- Provider/model settings restore from persisted service settings.
- DeepSeek credential status is available through keyring-backed settings; no `.env` credential import used.
- OpenCode live session starts explicitly.
- Prompt streams into the conversation UI.
- Safe workspace action creates `cghc-gui-fixture.txt` with expected content in the fixture workspace.
- Output file is shown in the right panel.
- Cancel action reaches visible cancelled state.
- App closes with no owned `Cowork GHC.exe` or `opencode.exe` orphan process.

Live budget:

- Provider connectivity: 1 `/v1/models` style test through existing provider test route.
- Successful inference: 2.
- Cancelled run: 1.
- Retries: 0.

## Remaining limitation

No real pending permission request was observed during the packaged safe file action. The permission controller and modal remain wired to the real service contract and focused tests pass; packaged permission approval should be rechecked when the runtime emits a pending request in this flow.
