---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Current Status

Active product plan: [Cowork GHC Product Plan](./cowork-ghc-product-plan.md)

Do not use a moving `HEAD hiện tại` field here. Use the latest verified slice commits
and the current working tree instead.

## UI Shell V3 commercial readiness remediation (2026-07-13)

| Item | Status |
|---|---|
| Independent audit branch | `audit/ui-shell-v3-commercial-readiness` |
| Audit commit | `ecce634` — `docs(quality): audit V3 commercial UI readiness` |
| Remediation branch | `fix/ui-shell-v3-commercial-readiness` |
| Audit verdict before fix | **PASS WITH BOUNDED FIXES** — commercial merge blocked by UI-CR-001 through UI-CR-005 |
| Commercial readiness pass | **Verified packaged baseline** - Settings is a full-screen application surface; workspace tree gap, provider untested status color, rail tooltip clipping, composer alignment, and inspector overlay placement are remediated |
| Packaged evidence | `reports/ui-shell-v3-commercial-readiness/` refreshed from packaged app on `4688f39`; screenshots are one batch from 2026-07-13 13:58:33-13:58:44 local time and `structural-state-check.json` records `gitHead` |
| UI Shell V3 commercial visual baseline | **PASS** |
| Product Owner visual acceptance | **Pending sign-off** - ready for PO visual review of the refreshed commercial-readiness screenshots |
| D1-D4 merge | **Not started** — integration surfaces remain passive slots |
| Multi-Provider Profiles | **Not implemented** |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Full L9 / RC | **Not complete** |

Settings is no longer a backdrop modal. The topbar Settings icon opens a full-screen surface inside the V3 application frame, below the native titlebar/topbar and above the status bar, with internal navigation for **Nhà cung cấp** and **Chung**.

Closure matrix from the final packaged verification:

| Issue | Closure |
|---|---|
| UI-CR-001 - Settings full-screen surface | **FIXED AND VERIFIED** |
| UI-CR-002 - Workspace whitespace/layout | **VERIFIED** |
| UI-CR-003 - Provider status color semantics | **VERIFIED** |
| UI-CR-004 - Product rail tooltip | **VERIFIED** |
| UI-CR-005 - Composer alignment/language/presentation | **VERIFIED** |

## Final PO Fixes (2026-07-13)

A final sweep of PO-confirmed fixes was applied on branch `fix/ui-shell-v3-final-po-fixes`:
- **Inspector**: Fixed as a docked grid column on desktop (≥1366px); only becomes overlay at narrower widths. Full-height flex column with internal scrolling.
- **Tooltip**: Removed duplicate native browser `title` attributes on elements using custom `data-tooltip`.
- **Inspector toggle**: Replaced "Thu gọn" text with icon-only (`panel-right-open`/`panel-right-close`).
- **Sidebar Height**: Workspace file tree uses `flex: 1` and `min-height: 0` for proper full-height display without gaps.
- **Transcript**: Removed white background/card around assistant messages; increased user bubble max-width.
- **Startup Behavior**: Clean new chat on startup; history remains in sidebar but is not auto-loaded/rendered. Continuation banner suppressed on startup.
- **Context Wrapper**: Fixed render path bug by applying `sanitizeAssistantForDisplay` when rendering historical records, ensuring envelope artifacts (e.g. `[Ngữ cảnh cuộc trò chuyện trước...]`) do not leak into the UI.

Final verification included `npm run typecheck`, targeted UI tests (141 pass, 0 fail including new context wrapper regression tests), `npm run build:renderer`, and a successful packaged build `scripts\build.bat`.

## UI Shell V3 production alignment (2026-07-13)

| Item | Status |
|---|---|
| Design prototype R3 (PO-approved direction) | **Complete** — `d96f205` on `design/ui-shell-v3-prototype` |
| Rejected production port | `794cb00` on `feature/ui-shell-v3-production` — PO rejected visual acceptance because packaged UI still looked like the old shell |
| Alignment branch | `fix/ui-shell-v3-production-alignment` |
| V3 shell in packaged renderer | **Aligned** — V3 frame/component composition replaces the legacy shell composition; `app-shell.ts` remains orchestration/state wiring |
| Major V3 composition | **Approved** — Product Owner accepted the replacement composition after R2 evidence |
| Product chrome / UX completion pass | **Applied** — global Settings restored, native Windows controls retained, provider status semantics clarified, rail/tooltips/composer/discoverability polished |
| Commercial UI Product Owner visual acceptance | **Pending** — awaiting review of `reports/ui-shell-v3-production-r3/` |
| D1–D4 merge | **Not started** — integration surfaces remain `awaiting_integration` |
| Multi-Provider Profiles | **Not implemented** — provider/model control opens existing Settings; no multi-profile dropdown registry |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Full external integration regression | **Deferred** to integration milestone |

Production evidence: `reports/ui-shell-v3-production-r3/` (product chrome/UX screenshots + structural state JSON). R2 remains historical alignment evidence. Regenerate:

```powershell
scripts\build.bat
node tools/verify/ui-shell-v3-production-screenshots.mjs
scripts\stop.bat
```

Design spec: [UI Shell V3 Spec](./ui-shell-v3-spec.md). Prototype reference: `design/ui-shell-v3/`, R3 evidence `reports/ui-shell-v3-r3/`. Prior rejected evidence remains in `reports/ui-shell-v3-production/`.

## Pre-merge stabilization (2026-07-13)

| Item | Status |
|---|---|
| Comprehensive project audit | **Complete** — [audit report](../quality/cowork-ghc-comprehensive-project-audit.md) |
| Commercial UI Product Owner acceptance | **FAIL** — collapsed layout and polish gaps identified before stabilization |
| Pre-merge stabilization | **Applied** — dead verifiers removed, File Review CLI consolidated, shell layout collapse fixes |
| File Work Review | **PARTIAL PASS** — live Journey A–B PASS; Journey C blocked; D–L not completed |
| D1–D4 external integration | **Not merged** — surfaces remain `awaiting_integration` slots only |
| Next milestone | **External integration intake** (D1–D4 merge) — [readiness doc](../integration/external-systems-integration-readiness.md) |
| Architecture refactor (`app-shell.ts`, snapshot/watchdog to service) | **Deferred** until after combined external integration merge |
| Full regression at integration milestone | Planned after D1–D4 code lands |

Baseline commit: `eaeb3eb` — chore(project): stabilize pre-integration baseline

Baseline tag (local, not pushed): `pre-external-integration-2026-07-14`

Canonical intake doc: [External Systems Integration Readiness](../integration/external-systems-integration-readiness.md)

## External integration intake (next milestone)

| Item | Status |
|---|---|
| Baseline commit / tag | **Ready** — `eaeb3eb` / `pre-external-integration-2026-07-14` |
| Next milestone | **External integration intake** (D1–D4) |
| Architecture refactor | **Deferred** until after **combined** external integration merge |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Commercial UI acceptance | **FAIL** (unchanged) |

## Latest Verified Slice

| Field | Value |
|---|---|
| Slice | Integration-Ready UI Shell Foundation |
| Feature commit | `0746112` — feat(ui): establish integration-ready Cowork shell |
| Hardening commits | `fix(files): harden packaged file review capture`; `test(verify): stabilize packaged file review stages`; `fix(files): canonicalize workspace paths in service`; `test(verify): add deterministic file review gateway` |
| Implementation Agent | Cursor |
| Packaged File Review | **PARTIAL PASS** — live Journey A–B PASS; Journey C blocked; D–L not completed in latest run |
| Regression | Latest UI shell foundation: targeted UI tests PASS; `npm run typecheck` PASS; `npm run build:renderer` PASS; `npm run verify:release` PASS. |
| Prior slices still PASS | Skills Foundation A–J; Provider Readiness A–J; Attachment Honesty A–J |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `1604761` | Skills packaged disable/deny recovery strengthened. |
| `97f53bf` | Skills Foundation feature. |
| `4f1e804` | Docs: provider readiness slice record. |
| `3cc4ba6` | Attachment honesty + secret-file safety. |

## Product State

Cowork GHC is a packaged Windows desktop POC (`poc-v0.1`). It is local-first,
workspace-centered, uses OpenCode as the current agent runtime, and supports a
replaceable LLM endpoint. DeepSeek is the current provider used for testing; it is not
a permanent product dependency.

Daily source of truth is Git plus active docs in `docs/product/`, `docs/quality/`,
`docs/architecture/`, and `AGENTS.md`. `.loop-engineer/` is maintenance-only provenance.

## Reference analysis pass

Git/docs reference analysis is complete. Two reference reports were added:

- [CoworkLocalallOS_3 Capability Audit](../references/coworklocalallos3-capability-audit.md)
- [Cowork Frontend Design Assessment](../references/cowork-frontend-design-assessment.md)

D1-D4 have been mapped into the canonical product plan as external parallel tracks:

- D1: Dispatch / fan-out agent.
- D2: Microsoft automation: Teams, SharePoint, OneDrive, Graph.
- D3: Knowledge system: RAG, vector, graph.
- D4: Advanced LLM gateway: key pool, rotation, load balance, failover, cost routing.

Cowork GHC does not currently implement D1-D4. The frontend PDF has been assessed as
design reference only; the active shell direction is now hybrid `1a Airy + 1b rail`:
56px product rail, contextual Cowork sidebar, main chat workspace, and right information
panel. Dispatch, Gateway, Knowledge, Knowledge Graph, and Microsoft 365 are visible
registry-defined integration slots in `awaiting_integration` state only; Code is planned.
They do not show mock provider, task, graph, Microsoft, cost, or RAG data.

## Verified Baseline

- Local service lifecycle, workspace selection, provider/model settings, Windows keyring,
  OpenCode runtime, streaming, permissions, cancellation, provider recovery, and process
  cleanup have packaged POC evidence.
- Conversation persistence, multi-conversation sidebar, search, switch, rename/delete,
  relaunch restore, and linked multi-turn Cowork conversations have packaged/automated evidence.
- Context isolation is verified for new turns: bounded untrusted internal envelopes are not
  persisted or displayed as assistant output.
- Activity timeline, file-change panel, permission history, and bounded text file preview exist.
- **File Work Review**: service-owned bounded snapshot capture, deterministic unified diff,
  persisted review artifacts on conversation activity, attachment vs runtime-read separation,
  secret-like path redaction in review, hash-mismatch banner for stale historical snapshots,
  and activity-panel review surface (no universal Preview tab, no direct editor).
- Attachment Phase 1 plus honesty slice: workspace text files, dispatch preflight fail-fast,
  explicit inclusion metadata, secret-like filename blocking before read, activity wording
  `Đã đưa tệp vào ngữ cảnh`, and no raw attachment content in transcript.
- Provider readiness and Skills Foundation Phase 1 remain as previously verified.

## File Work Review Slice

### What shipped

- **Taxonomy**: `attachment_context`, `runtime_file_read`, `file_created`, `file_modified`,
  `file_deleted`, plus permission history outcomes; Vietnamese past-tense labels for terminal events.
- **Snapshots**: before/after capture at mutation time with SHA-256 hash, size, mtime, truncation flags.
- **Diff**: deterministic line-based unified diff with CRLF/LF normalization; binary metadata-only path.
- **Persistence**: `fileReviews` array on persisted activity snapshot survives relaunch.
- **Secret policy**: reuses `isSecretLikeAttachmentPath`; review shows
  `Nội dung bị ẩn vì file có thể chứa credential hoặc secret.` without raw content.
- **Skills**: file events inherit turn Skill provenance via existing turn metadata; Skills do not bypass permission.
- **UI**: activity right panel review (`Xem lại thay đổi`), copy relative path; open-file deferred.

### Packaged live verification (latest rerun)

```text
File Work Review: PARTIAL PASS
Live Journey A: PASS
Live Journey B: PASS
Journey C: blocked by nondeterministic model/tool selection
Journeys D–L: not completed in the latest run
```

Evidence artifact (best full run): `%TEMP%\cghc-freview-artifacts-ubFNmc`

| Stage / journey | Result | Notes |
|---|---|---|
| A01–A12 create | PASS | Permission, disk file, review artifact, terminal |
| B modify | PASS | `modify-me.txt` diff persisted (`review-11`) |
| C delete | NOT PASS | Model sometimes skips delete tool or uses bash/edit instead |
| D–L | NOT RUN | Stopped after C failure |

### Product bugs closed in hardening pass

| ID | Issue | Fix |
|---|---|---|
| RC2 | Windows 8.3 short path (`NHATLU~1`) did not map to long workspace root → review snapshot failed | `toRelativePath()` folder-segment match |
| RC4 | Stream watchdog (90s) treated permission wait as stall | Pause watchdog while permission `pending` |
| RC5 | Before snapshot missing when permission has no `targetPath` | Capture on `tool_call` start via early `filePath` in summary |

### Harness fixes (verifier only)

| ID | Issue | Fix |
|---|---|---|
| RC1 | A07 required filename in permission dialog when OpenCode emits empty path | Accept file write/edit permission kinds |
| RC3 | `waitTerminalAfterPermission` approved without visible dialog | Staged `waitPermissionRequest` + `approveObservedPermission` |
| — | Review click targeted wrong file row | `clickFileChange(relativePath)` |

### Open verification decision

```text
Live LLM behavior must not be the sole mechanism used to verify deterministic
delete/deny/redaction/persistence File Review semantics.
```

### Limits (configured)

| Limit | Value |
|---|---|
| Max snapshot bytes | 64 KiB (`FILE_REVIEW_MAX_SNAPSHOT_BYTES`) |
| Max preview bytes | 64 KiB (`FILE_REVIEW_MAX_PREVIEW_BYTES`) |
| Max diff chars | 32 KiB (`FILE_REVIEW_MAX_DIFF_CHARS`) |
| Max diff lines per side | 500 (`FILE_REVIEW_MAX_DIFF_LINES`) |

### Verification

- `npm run verify:release` PASS (includes file-review unit/router tests, activity-model 8.3 path test).
- `npm run package:win` PASS.
- `node tools/verify/file-review-packaged.mjs` — A–B PASS in latest clean rerun; C–L incomplete.

Full L9 / release-candidate verification is **not** complete.

## Commercial UI Foundation and Workspace Shell

### What shipped

- Hybrid `1a Airy + 1b rail` is the active shell direction: 56px product rail,
  contextual Cowork sidebar, central chat workspace, and right information panel.
- Typography is standardized on bundled local `Be Vietnam Pro` with Segoe/Noto fallback;
  no runtime CDN font load is required.
- Central design tokens now cover semantic background/surface/border/text/accent,
  status colors, spacing, typography, radius, shadow, and transition.
- The inline SVG icon system covers Cowork, Dispatch, Gateway, Knowledge,
  Knowledge Graph, Microsoft 365, Code, Workspace, Folder, File, Attachment,
  Settings, Permission, Activity, Create, Modify, Delete, Search, Refresh, and
  collapse/expand affordances.
- A top-level surface registry defines `cowork`, `dispatch`, `gateway`, `knowledge`,
  `knowledge-graph`, `microsoft`, and `code`; `cowork` is `available`, D1-D4 surfaces
  are `awaiting_integration`, and `code` is `planned`.
- D1-D4 UI contracts exist as passive integration slot interfaces only. No backend
  adapter, fake production data, or mock provider was added for those surfaces.
- Minimal Workspace Navigator is implemented as a read-only service-backed tree:
  direct children only, lazy folder expansion, bounded list size, no recursive scan,
  and no renderer filesystem access.
- Workspace file preview supports bounded text/Markdown/JSON/YAML/source-code style
  text through the existing safe preview boundary. PDF, Office, image, and direct editor
  are not started.
- Right information panel now has active tab semantics: Kế hoạch, Hoạt động, Tệp,
  and Xem lại. Empty states remain honest when there is no runtime data.

### Status constraints

```text
File Work Review: PARTIAL PASS
D1-D4: not merged / not implemented
Minimal Workspace Navigator: read-only implemented
Direct editor/PDF/Office/image preview: not started
```

Full live regression remains deferred until after the external integration milestone.

## Next Implementation Slice

Next Agent: Cursor.

Current blocker:

```text
File Work Review: PARTIAL PASS
Packaged journeys C–L need a verification redesign split (live-agent vs deterministic product-path).
```

Next implementation action:

```text
Receive D1–D4 intake reports per docs/integration/external-systems-integration-readiness.md.
Do not merge until matrix row is filled and track acceptance gates pass.
```

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/file-review-packaged.mjs --mode live
node tools/verify/file-review-packaged.mjs --mode deterministic
node tools/verify/skills-foundation-packaged.mjs
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/provider-readiness-packaged.mjs
node tools/verify/ui-shell-v3-production-screenshots.mjs
```
