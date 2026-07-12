---
language: "vi"
status: "triage"
updated_at: "2026-07-13"
---

# File Work Review packaged triage

This document records triage, rerun evidence, and closed/open root causes for packaged
File Work Review journeys A–L. It does not change product scope or UI design.

Current required status:

```text
File Work Review: PARTIAL PASS
Live Journey A: PASS
Live Journey B: PASS
Journey C: blocked by nondeterministic model/tool selection
Journeys D–L: not completed in the latest run
```

## 1. Latest rerun summary

After verifier hardening (`d3ab6d8`) and product capture fixes, a clean packaged rerun with
live DeepSeek produced:

| Journey | Result | Evidence |
|---|---|---|
| A create (A01–A12) | **PASS** | Disk `create-blue.txt`, review artifact, permission approved |
| B modify | **PASS** | `modify-me.txt` → `SECOND_VERSION`, unified diff, `reviewId` persisted |
| C delete | **FAIL** | Model did not reliably invoke delete tool; sometimes bash/edit or no tool |
| D–L | **NOT RUN** | Verifier stopped after C |

Best artifact root: `%TEMP%\cghc-freview-artifacts-ubFNmc`

First-rerun artifact (pre-harness-fix): `%TEMP%\cghc-freview-artifacts-p8eavF` — failed at
A07 because verifier required `create-blue.txt` in permission dialog fields while OpenCode
emitted `file_edit` with empty `relativePath`. Permission **was** observed; harness was wrong.

## 2. Closed root causes

### Product (fixed)

| ID | Symptom | Root cause | Fix commit area |
|---|---|---|---|
| RC2 | A11 timeout — review not persisted though disk file exists | `toRelativePath()` failed on Windows 8.3 vs long path → snapshot API received shortened path | `activity-model.ts` |
| RC4 | Multi-turn permission wait could exceed 90s watchdog | Watchdog treated permission pending as stream stall | `app-shell.ts` watchdog |
| RC5 | Edit diff missing when permission has no `targetPath` | Before snapshot only captured at permission time with known path | `captureBeforeOnToolStart` + early `filePath` in `tool_call.summary` (`part-mapper.ts`) |

### Harness (fixed)

| ID | Symptom | Root cause | Fix commit area |
|---|---|---|---|
| RC1 | A07 false fail — permission target mismatch | Verifier required filename in dialog; OpenCode may emit path-empty `file_edit` | `file-review-packaged.mjs` |
| RC3 | B+ turns completed without mutation | `waitTerminalAfterPermission` clicked allow opportunistically without proving dialog | Staged permission wait + approve |
| — | B diff check failed despite disk correct | `clickFirstFileChange` opened Journey A row | `clickFileChange(relativePath)` |

## 3. Open blocker — Journey C

**Classification:** insufficient proof of product delete-path failure.

Observed behavior in latest runs:

- Model sometimes completes turn with tool events but no delete permission.
- Model sometimes requests `bash` (`command_exec`) or `file_edit` instead of `file_delete`.
- When delete tool is not invoked, disk file remains — verifier correctly fails.

This is **not** documented as a proven product defect in the delete permission bridge or
review finalization path. The delete product path was not exercised because the live model
did not reliably select the delete tool.

Do **not** conclude the failure is provider-only; deterministic packaged coverage is still
required for delete semantics.

## 4. Open verification decision

```text
Live LLM behavior must not be the sole mechanism used to verify deterministic
delete/deny/redaction/persistence File Review semantics.
```

### Proposed suite split (design only — not implemented)

**Live-agent integration journeys** (keep in `file-review-packaged.mjs` or sibling):

- Create mutation through live model (Journey A).
- Modify mutation through live model (Journey B).
- At least one live permission approve flow and one live deny flow.

**Deterministic packaged product-path journeys** (new harness — must traverse full seam):

```text
packaged renderer → bridge → local service → permission path → event mapping
→ File Review artifact → persistence → UI rendering
```

Coverage target: delete, deny-without-fake-diff, attachment vs runtime read, relaunch
persistence, later file hash mismatch, large-file truncation, binary metadata-only review,
secret redaction, process cleanup.

Constraint: do not inject fake `fileReviews[]` directly into the store to force PASS.

## 5. Journey A flow (post-fix)

| Stage | Status after fix |
|---|---|
| A01 launch | PASS |
| A02 local service ready | PASS |
| A03 workspace active | PASS |
| A04 provider ready | PASS |
| A05 conversation created | PASS |
| A06 runtime turn started | PASS |
| A07 permission requested | PASS — accepts `Tạo tệp` / `Sửa tệp` without filename in dialog |
| A08 permission approved | PASS |
| A09 mutation event observed | PASS |
| A10 file exists on disk | PASS |
| A11 file review persisted | PASS — after RC2 path fix |
| A12 terminal assistant response | PASS |

## 6. Required environment (unchanged)

- Packaged app under `dist-app/win-unpacked/Cowork GHC.exe`.
- Clean isolated profile and fixture workspace.
- No stale `Cowork GHC.exe` / `opencode.exe`.
- `DEEPSEEK_API_KEY` via environment or `.env` (never in logs/docs).
- `COWORK_GHC_STARTUP_TRACE` enabled by verifier.

## 7. Artifact locations

```text
%TEMP%\cghc-freview-artifacts-*\file-review-verification-result.json
%TEMP%\cghc-freview-artifacts-*\file-review-verification-summary.md
%TEMP%\cghc-freview-artifacts-*\startup.trace
%TEMP%\cghc-freview-profile-*
%TEMP%\cghc-freview-ws-*
```

Preserve failure artifacts until root cause is understood.

## 8. Stop conditions (updated)

Stop and preserve evidence when:

- A or B regress after hardening fixes.
- Permission decision does not resolve after staged approve.
- Disk file exists but review artifact cannot be built (product path).
- Journey C is used alone to prove delete product-path correctness without deterministic coverage.

Do not mark File Work Review PASS until all required journeys have evidence under the
agreed live + deterministic split.
