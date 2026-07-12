---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Current Status

Active product plan: [Cowork GHC Product Plan](./cowork-ghc-product-plan.md)

Do not use a moving `HEAD hiện tại` field here. Use the latest verified slice commits
and the current working tree instead.

## Latest Verified Slice

| Field | Value |
|---|---|
| Slice | File Work Review and Before/After Diff |
| Feature commit | `c81fbc4` — feat(files): add persistent before-after review |
| Implementation Agent | Cursor |
| Packaged journeys | `file-review-packaged.mjs` A–L — **NOT PASS YET / PARTIAL** in this session (live agent file writes did not land on disk; `verify:release` PASS) |
| Regression | `npm run verify:release` PASS; `npm run package:win` PASS |
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
design reference only; no UI implementation was started. Recommended future shell direction
is `1a Airy`, staged after the packaged File Work Review blocker is closed. Code, Structure/RAG,
Microsoft 365, and concurrency surfaces remain future/dependency-gated surfaces, not current
product capability.

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

## File Work Review Slice (this session)

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

### Limits (configured)

| Limit | Value |
|---|---|
| Max snapshot bytes | 64 KiB (`FILE_REVIEW_MAX_SNAPSHOT_BYTES`) |
| Max preview bytes | 64 KiB (`FILE_REVIEW_MAX_PREVIEW_BYTES`) |
| Max diff chars | 32 KiB (`FILE_REVIEW_MAX_DIFF_CHARS`) |
| Max diff lines per side | 500 (`FILE_REVIEW_MAX_DIFF_LINES`) |

### Verification

- `npm run verify:release` PASS (includes `service/tests/file-review.test.ts`, router test, activity-model updates).
- `npm run package:win` PASS.
- `node tools/verify/file-review-packaged.mjs` — harness added for journeys A–L; live-agent file-write
  steps did not complete in this verification environment. The live packaged verification did
  not complete successfully. The failure may be related to runtime/environment instability,
  but the root cause is not yet proven.

Full L9 / release-candidate verification is **not** complete.

## Next Implementation Slice

Next Agent: Cursor.

Current blocker:

```text
Packaged File Work Review A–L verification is incomplete.
```

Next implementation action:

```text
Diagnose and re-run packaged File Work Review A–L
```

Minimal Workspace Navigator has not started. Do not start it until packaged File Work
Review A–L passes and the Product Owner issues that brief.

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/file-review-packaged.mjs
node tools/verify/skills-foundation-packaged.mjs
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/provider-readiness-packaged.mjs
```
