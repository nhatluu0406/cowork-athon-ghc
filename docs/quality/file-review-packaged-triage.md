---
language: "vi"
status: "triage"
updated_at: "2026-07-12"
---

# File Work Review packaged triage

This is analysis and verification preparation only. It does not change product code,
verification harness code, acceptance status, or UI scope.

Current required status:

```text
File Work Review: PARTIAL PASS
Packaged A-L: not PASS yet
Current blocker: live packaged Journey A does not prove the requested file appears on disk after permission
```

Do not conclude this is environment-only until the evidence below is collected.

## 1. Current failure summary

`tools/verify/file-review-packaged.mjs` is the packaged live verifier for File Work
Review journeys A-L. The expected first live journey is:

```text
create-blue.txt -> content CREATE-BLUE-314 -> disk file exists -> create activity -> review artifact
```

Active docs record that implementation, unit/release regression, and Windows package build
passed, but packaged live A-L did not complete. The retained docs say Journey A failed because
the live agent file-write steps did not land on disk. No persisted `file-review` startup trace
or detailed runtime/session diagnostic file was found for the failed run, because the current
File Review harness does not enable `COWORK_GHC_STARTUP_TRACE` and does not dump conversation
diagnostics on failure.

## 2. Exact Journey A flow

| Step | Harness evidence | Timeout | Expected event/state | Known actual from prior failure | Possible failure point | Confidence |
|---|---|---:|---|---|---|---|
| Launch packaged app | Spawns `dist-app/win-unpacked/Cowork GHC.exe` with `--user-data-dir=<tmp>` and `COWORK_GHC_REMOTE_DEBUG_PORT=19235` | 90s for `.app-shell` | Renderer target appears in CDP | Not recorded as failing | Missing exe, stale CDP/process, Electron env contamination | Medium |
| Local service ready | `.topbar__status` matches shared `LOCAL_SERVICE_READY` | 240s | `Local service: ... Sẵn sàng` | Not recorded as failing | Local service timeout, stale service, auth/bootstrap failure | Medium |
| Workspace activated | Clicks `.workspace-choose`, waits `.workspace-context` contains `cghc-freview-ws-` | 240s | Temporary workspace is active | Not recorded as failing | E2E picker seam mismatch, bad profile/workspace | Medium |
| Provider configured | Opens settings, saves `DEEPSEEK_API_KEY`, runs connection test | 30s credential, 60s connection | Credential status and settings status success | Not recorded as failing | Missing/invalid credential, wrong model/base URL, stale keyring state | Medium |
| Conversation created / live turn started | Sets composer text and clicks `.send-btn`; waits `.execution-status` processing/waiting | 60s | Runtime turn begins | Not recorded in retained logs | Send disabled, preflight issue, runtime not started | Low-medium |
| Permission requested | `waitTerminalAfterPermission("allow")` repeatedly clicks `.permission-allow` if present | 300s | A real permission modal appears for file create/edit | Unknown. Harness does not assert it saw a permission dialog. | No permission event, wrong permission target, modal never appeared, or harness missed it | High |
| Permission approved | Same function clicks allow and waits terminal status | 300s | Permission decision reaches service and OpenCode reply path | Unknown. Harness does not capture decision response or pending queue. | Reply route mismatch, unresolved permission, terminal error hidden by broad status match | High |
| OpenCode/tool mutation | Agent should call tool to create file in workspace | Indirect only | OpenCode emits `file_mutation`, disk file exists | Prior failure says disk file did not appear | Prompt/model did not use tool, runtime/provider instability, permission reply did not unblock, wrong workspace | High |
| File appears on disk | `waitForDiskFile(createPath, /CREATE-BLUE-314/)` | 120s | `create-blue.txt` exists with exact marker | Failed previously per docs | Product/runtime/harness unknown without logs | High |
| Review artifact created | Activity text, output row, click review, body contains marker and before state | 90s review marker | `Đã tạo tệp`, output row, review artifact | Not reached if disk wait failed | Event stream missed `file_mutation`, review build failed, UI click row mismatch | Medium |

## 3. Known facts

- `packagedChildEnv()` removes `ELECTRON_RUN_AS_NODE` for packaged verifier launches.
- File Review harness uses isolated temp profile and temp workspace.
- File Review harness requires `DEEPSEEK_API_KEY` from environment or `.env`.
- File Review harness configures credential through the UI and runs a live connection test.
- File Review harness does not set `COWORK_GHC_STARTUP_TRACE`.
- File Review harness does not preserve the temp profile/workspace on failure.
- File Review harness does not log runtime session ID, pending permission snapshot, permission decision response, activity snapshot, or conversation diagnostics on Journey A failure.
- File Review artifact creation is UI-driven after a `file_mutation` EV: before snapshot is captured when permission is pending; after snapshot is captured when a `file_mutation` event is seen.
- No-network focused tests passed for file-review service/router, activity model, permission controller, and permission bridge.

Focused no-network command run during this triage:

```powershell
node --import tsx --test service/tests/file-review.test.ts service/tests/file-review-router.test.ts app/ui/tests/activity-model.test.ts app/ui/tests/permission-controller.test.ts service/tests/permission-bridge.test.ts
```

Result: PASS, 38 tests.

## 4. Unknowns

- Whether Journey A actually saw a permission request.
- Whether the permission request had `targetPath=create-blue.txt` or an equivalent workspace-relative path.
- Whether the permission decision POST returned `resolved`, `already_resolved`, or an error.
- Whether the reply reached OpenCode at `/permission/{requestId}/reply`.
- Whether OpenCode emitted `file_mutation`.
- Whether OpenCode created a file somewhere outside the expected fixture root.
- Whether the assistant completed with text while skipping the tool call.
- Whether the live runtime session ID changed, stalled, or failed before mutation.
- Whether a stale process/port/profile affected the previous run.
- Whether the packaged build used in the failed run exactly matched the source commit.

## 5. Harness versus product boundary

Treat these as different failure classes:

| Class | Meaning in this blocker |
|---|---|
| Harness defect | The product may work, but the verifier is not observing enough, uses the wrong selector/path/timing, cleans up too early, or cannot distinguish "no permission" from "permission approved". |
| Product defect | The packaged app fails to route permission, runtime events, file mutation, workspace guard, or review artifact generation correctly. |
| Runtime/provider instability | OpenCode or the live model returns a terminal response without using the expected file tool, stalls, or fails after permission. |
| Environment/configuration issue | Missing/invalid credential, wrong model/base URL, stale Cowork/OpenCode process, port conflict, bad packaged build, or contaminated profile/workspace. |
| Insufficient evidence | Current state when a failure is plausible but no retained logs prove the exact step. |

Current classification: **Insufficient evidence**, with harness observability as the highest-confidence issue to fix before a clean rerun.

## 6. Comparison with passing packaged flows

| Verifier | Relevant passing behavior | Important difference versus File Review verifier |
|---|---|---|
| `provider-readiness-packaged.mjs` | Confirms clean launch, missing credential preflight, key recovery, connection test, focus, env hygiene. | Uses `COWORK_GHC_STARTUP_TRACE` and explicitly tests `ELECTRON_RUN_AS_NODE` hygiene. Does not require file mutation. |
| `attachment-honesty-packaged.mjs` | Verifies live attachment prompts, secret blocking, budget fail-fast, and attachment permission isolation. | Uses startup trace, alert catcher, several preserved UI checks; its permission-isolation path only verifies permission appears and completion, not review artifact creation. |
| `skills-foundation-packaged.mjs` | Verifies live Skill usage, disable/relaunch/provenance, budget overflow, and deny isolation. | Similar CDP style but Journey H asserts `.permission-dialog` before Deny. File Review Journey A does not assert a permission dialog was observed before it treats the turn as terminal. |
| `multi-turn-tool-packaged.mjs` | Verifies create -> modify -> read file with live tool calls, permission allow, file content, diagnostics, relaunch. | Logs conversation diagnostics from profile, uses startup trace, checks assistant message count and output panel. It has a shorter 30s disk-file wait but richer failure diagnostics. |
| `l6-packaged.mjs` | Verifies live ready trace, streaming PING, permission approve/deny, provider recovery, cleanup. | Has explicit `live_ready/live_failed` trace and an older "start session" step. File Review verifier relies on implicit runtime start on send and lacks startup trace. |
| `conversation-finalization-packaged.mjs` | Verifies permission + finalization paths. | Uses startup trace and assistant text waits to avoid confusing terminal UI state with successful tool completion. |

Largest difference: **File Review Journey A waits for terminal status after attempting to click Allow, but it does not first prove that a permission request appeared, that the decision resolved, or that OpenCode emitted `file_mutation`.** When disk verification fails, the harness loses the evidence needed to distinguish model skipped tool, permission reply failure, event-stream failure, wrong workspace, and environment instability.

## 7. Root-cause hypotheses

| Hypothesis | Evidence for | Evidence against | Confidence | How to prove |
|---|---|---|---|---|
| Harness does not capture enough Journey A state and may return from permission flow without proving permission existed. | `waitTerminalAfterPermission` clicks `.permission-allow` opportunistically and then waits terminal status; it does not assert `.permission-dialog` existed, read pending permissions, or log decision response. Failed run has no retained file-review trace. | Passing file flows use similar CDP polling in places; a real disk failure still indicates something happened beyond pure reporting. | High | Add a triage-only rerun that logs permission pending snapshot, decision POST outcome, runtime session ID, activity snapshot, and file path before cleanup. |
| Live model/runtime completed without calling the file mutation tool. | Prior failure says no disk file after terminal. Provider/model prompts can be nondeterministic, and current prompt is natural-language instruction. | Earlier live verifier `multi-turn-tool-packaged.mjs` passed create/modify/read with similar prompts. | Medium | Capture assistant final text, tool_call/file_mutation EVs, OpenCode session events, and output panel for Journey A. |
| Permission reply reached UI but did not unblock OpenCode. | File creation requires OpenCode permission. Runtime reply route notes it is expected to POST `/permission/{requestId}/reply`. If reply fails, no disk mutation follows. | Unit `permission-bridge` and UI permission-controller tests pass; older permission approve/deny packaged flows passed. | Medium | Capture pending request ID, POST `/v1/permission/decision` response, runtime reply diagnostic/error, and whether OpenCode remains waiting. |
| Wrong workspace/path normalization caused file to be created outside `createPath` or permission target mismatch. | File Review uses temp workspace and `toRelativePath`/workspace guard; OpenCode may report absolute paths or relative paths. Disk verifier checks exactly `<workspace>/create-blue.txt`. | Passing `multi-turn-tool-packaged.mjs` creates files in the expected workspace. Workspace context is checked before send. | Low-medium | After failure, preserve workspace and search only that fixture and OpenCode cwd/config for `create-blue.txt`; log permission target and OpenCode cwd. |
| Stale process, port, or profile contaminated the run. | File Review uses fixed CDP port `19235`, ignores stdio, and only kills processes on controlled cleanup. A failed/aborted previous run could leave processes. | It uses fresh temp profile/workspace; shared env removes `ELECTRON_RUN_AS_NODE`. | Low-medium | Pre-kill Cowork/OpenCode, verify CDP port free, clean isolated profile/workspace, and capture process list before/after. |
| Packaged build did not match expected source or was stale. | Harness only checks exe exists, not build commit/version. | Docs record `npm run package:win` PASS for the slice. | Low | Confirm package timestamp/version/hash after packaging from current HEAD before rerun. |
| Environment/provider credential/model/base URL issue after connection test. | Live call depends on `DEEPSEEK_API_KEY`, provider config, and model/base URL. | Harness connection test succeeded before Journey A if it reached Journey A; earlier provider readiness passed. | Low | Capture settings state and test status, then run a bounded no-tool prompt before Journey A in the same clean profile. |

## 8. Required environment and credentials

Required for the final live rerun:

- Packaged app under `dist-app/win-unpacked/Cowork GHC.exe`.
- Clean isolated user-data profile.
- Clean isolated fixture workspace.
- No stale `Cowork GHC.exe` or `opencode.exe` owned by previous verification runs.
- `DEEPSEEK_API_KEY` available through environment or local `.env`, but never printed or placed in command history.
- Confirmed provider model/base URL in the app settings.
- CDP port used by the rerun is free.

No live/paid LLM request was run during this triage.

## 9. Clean rerun procedure

Copy-paste checklist:

```text
[ ] Confirm HEAD is the intended commit.
[ ] Confirm working tree is clean.
[ ] Confirm packaged build was produced from the intended HEAD.
[ ] Kill stale Cowork/OpenCode process trees owned by prior verification runs.
[ ] Confirm no Cowork GHC.exe process remains.
[ ] Confirm no opencode.exe process remains.
[ ] Confirm chosen CDP port is free.
[ ] Create a clean isolated profile directory.
[ ] Create a clean isolated fixture workspace.
[ ] Sanitize child environment: ensure ELECTRON_RUN_AS_NODE is not inherited by packaged app.
[ ] Confirm provider credential availability without printing the secret.
[ ] Confirm provider model and base URL in Settings.
[ ] Capture startup trace with COWORK_GHC_STARTUP_TRACE.
[ ] Launch packaged app with the clean profile and fixture workspace.
[ ] Confirm authenticated local service readiness in the topbar.
[ ] Activate workspace and record the displayed workspace context.
[ ] Save credential through UI and record only redacted credential status.
[ ] Run connection test and record success/failure text without secrets.
[ ] Start Journey A prompt.
[ ] Capture runtime session ID/conversation ID after send.
[ ] Capture permission pending snapshot before clicking Allow.
[ ] Confirm permission request target is create-blue.txt or equivalent workspace-relative path.
[ ] Click Allow once and capture /v1/permission/decision response.
[ ] Capture OpenCode/runtime logs or event frames around permission reply.
[ ] Capture execution status transitions until terminal.
[ ] Capture tool_call and file_mutation events, if any.
[ ] Verify create-blue.txt on disk.
[ ] Capture activity timeline text.
[ ] Verify review artifact exists and contains CREATE-BLUE-314.
[ ] If any step fails, preserve profile/workspace/logs and stop; do not continue B-L.
[ ] Cleanup only after evidence is copied.
[ ] Check no orphan Cowork/OpenCode process remains.
```

Recommended command shape, with no API key in the command:

```powershell
node tools/verify/file-review-packaged.mjs
```

## 10. Required logs/evidence

Cursor should capture these in the next live rerun:

- `COWORK_GHC_STARTUP_TRACE` file for the File Review run.
- Process list before launch and after cleanup.
- Packaged exe path, timestamp/version/hash or packaging evidence.
- CDP local-service status text.
- Workspace path displayed in UI and actual fixture path.
- Redacted provider readiness/settings status.
- Conversation ID and runtime session ID.
- Pending permission JSON projection from `/v1/permission/pending`.
- Permission decision response from `/v1/permission/decision`.
- OpenCode event frames or service activity containing `permission.asked`, `tool_call`, `file_mutation`, `terminal`, and `error`.
- Final assistant text for Journey A.
- Disk listing of the fixture workspace after Journey A failure/success.
- Activity snapshot and persisted conversation activity, including `fileReviews[]`.
- Whether temp profile/workspace were preserved on failure.

## 11. Stop conditions

Stop the rerun and preserve evidence when any of these happens:

- Local service readiness is not reached.
- Provider credential/configuration cannot be confirmed without printing a secret.
- Connection test fails.
- Send preflight blocks the prompt.
- No permission request appears within the bounded wait.
- Permission request target is not the expected workspace file.
- Permission decision response is not `resolved`.
- Runtime enters terminal state without `tool_call` or `file_mutation`.
- `create-blue.txt` does not appear on disk after terminal.
- Disk file exists but no review artifact is created.
- Any secret value appears in log, screenshot, transcript, or docs.

Do not continue from Journey A into B-L after a failure; the later journeys depend on the
same environment and would add noise.

## 12. Minimal likely fixes

Do not apply these in this triage task. These are candidate fixes for Cursor after evidence:

1. Harness observability fix: add `COWORK_GHC_STARTUP_TRACE`, preserve profile/workspace on failure, and dump redacted Journey A diagnostics.
2. Harness assertion fix: require a visible permission dialog or non-empty `/v1/permission/pending` before clicking Allow.
3. Harness decision fix: capture and assert the permission decision response instead of only checking terminal UI text.
4. Harness event fix: wait for `file_mutation` or an explicit no-tool terminal diagnostic before `waitForDiskFile`.
5. Product/runtime fix, if proven: debug permission reply bridge, event pump demux, workspace cwd/config, or OpenCode tool mutation handling for the packaged runtime.
6. Prompt robustness fix, if model skip is proven: make Journey A prompt/tool expectation more deterministic without bypassing permission.

## 13. Exact recommended Cursor task

### Case 1 - harness issue

Patch `tools/verify/file-review-packaged.mjs` only. Add redacted startup trace, Journey A
permission/session/activity diagnostics, failure-preserve mode for temp profile/workspace,
and explicit assertions that permission appeared and the decision resolved before waiting for
disk file. Then rerun:

```powershell
npm run verify:release
node tools/verify/file-review-packaged.mjs
```

Acceptance: Journey A failure, if still present, must name the exact failed step and preserve
enough evidence to distinguish harness, product, runtime/provider, and environment.

### Case 2 - product/runtime issue

Debug the packaged execution path:

```text
permission.asked -> permission gate -> /v1/permission/decision -> runtime reply adapter
-> OpenCode tool execution -> file_mutation EV -> app-shell finalizeFileMutationReview
```

Collect the required logs above. Fix only the proven broken boundary, then rerun focused
unit tests and `file-review-packaged.mjs`.

### Case 3 - missing live environment

Do not change code first. Prepare the clean rerun environment:

```text
clean processes -> clean profile -> clean fixture workspace -> packaged build from HEAD
-> redacted provider credential available -> startup trace enabled -> run Journey A only
-> preserve evidence on stop condition
```

If the live credential/model/base URL cannot be confirmed, report the missing prerequisite
and leave File Work Review as `PARTIAL PASS`.
