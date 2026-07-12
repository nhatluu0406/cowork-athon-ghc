# Cowork GHC - Handoff

Updated: 2026-07-12 (Slice 4 packaged PASS)

## Git anchor

- **Slice 1:** `3856a84` — packaged service readiness + authenticated health verification
- **Slice 2:** `ff32d808` — packaged workspace picker, activation, persistence, relaunch restore, workspace switching
- **Slice 3:** `8f7abff` — packaged provider/model settings + Windows keyring credential + bounded DeepSeek test connection
- **Bootstrap fix:** `bd22583` — settings-only boot before live connect
- **Slice 4:** *(this commit)* — packaged OpenCode live session + streaming + safe workspace action

## Current State

- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Slice 1–4 packaged: **PASS**
- `CGHC-008`, `CGHC-011`, `CGHC-019`: **DONE**
- `CGHC-028`: **IN_PROGRESS** (full L9 journey not complete)
- Do not start `L7`
- Web remains `DEFERRED`

## Verified (Packaged)

`dist-app/win-unpacked/Cowork GHC.exe`:

| Slice | Scope | Verified |
|---|---|---|
| Service lifecycle | Slice 1 | Settings-only boot; authenticated health; clean PID stop |
| Workspace | Slice 2 | Picker → grant → activate → persist → relaunch restore |
| Provider + credential | Slice 3 | DeepSeek preset, keyring, test connection, relaunch restore |
| OpenCode live session | Slice 4 | Explicit start → OpenCode v1.17.11 → session → streaming → file action → clean stop |

Evidence:

- Slice 4: `.loop-engineer/evidence/CGHC-028-slice4-packaged-opencode-session.md`
- Verify: `node tools/verify/slice4-session-packaged.mjs`

## Still Unverified (Package)

- Permission modal journey in packaged GUI
- Cancellation leg in packaged verify
- Full stop/resume/clean L9 acceptance

## Precise Next Action

**Slice 5:** Packaged permission + cancel verification; then stop/resume/clean journey. Do **not** start L7.

## Runtime note

OpenCode **v1.17.11** bundled at `resources/opencode/opencode.exe` (extraResources). Historical `ENOENT` was wrong dev `node_modules` path during automatic live boot — fixed by settings-only boot + packaged `binPath`.
