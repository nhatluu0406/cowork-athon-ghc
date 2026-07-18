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
File Work Review: PARTIAL PASS — delete journey blocked on OpenCode v1.17.11 tool surface
Live Journey A: PASS
Live Journey B: PASS
Journey C: BLOCKED (no patch/delete in LLM tool schema on pinned runtime)
Journeys D–L: not completed in latest deterministic run
Evidence: reports/file-work-review-completion/
```

## 1. Latest rerun summary (completion pass 2026-07-13)

Packaged live rerun after UI Shell V3 harness alignment and product fixes:

| Journey | Result | Evidence |
|---|---|---|
| A create (A01–A12) | **PASS** | `reports/file-work-review-completion/create-result.json` |
| B modify | **PASS** | `reports/file-work-review-completion/modify-result.json` |
| C delete (deterministic) | **BLOCKED** | `reports/file-work-review-completion/delete-result.json` + `opencode-agent-build.txt` |
| D–L | **NOT RUN** | Stopped after C |
| Historical integrity | **PASS (focused)** | `historical-relaunch-result.json` + service relaunch tests |
| Secret redaction | **PASS (focused)** | `redaction-result.json` + service redaction tests |

Prior artifact (pre-V3 harness): `%TEMP%\cghc-freview-artifacts-ubFNmc`

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

**Classification:** OpenCode pinned runtime tool surface — not a Cowork review-finalization defect.

Observed behavior in completion pass (deterministic mock gateway log):

- OpenCode **v1.17.11** build agent exposes LLM tools:
  `[edit, glob, grep, question, read, skill, task, todowrite, write]` only.
- `tools.patch: true` and `agent.build.tools.patch: true` in written `opencode.json` do **not**
  add `patch` / `apply_patch` to the LLM schema.
- Mock gateway correctly refuses to invent `delete`; fallback `edit` with `patchText` args fails —
  no permission, no `file_mutation`, file remains on disk.
- Cowork product path for delete via `apply_patch` `*** Delete File:` is implemented in
  `part-mapper.ts` and awaits a runtime that exposes the patch tool.

Live DeepSeek delete remains nondeterministic; do **not** use live-only proof for delete semantics.

**Next product/runtime action (out of this slice):** OpenCode pin upgrade or runtime config that
actually exposes `patch`/`apply_patch` to the LLM tool list on Windows packaged builds.

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

- Packaged app under `dist-app/win-unpacked/coworkghc.exe`.
- Clean isolated profile and fixture workspace.
- No stale `coworkghc.exe` / `opencode.exe`.
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
