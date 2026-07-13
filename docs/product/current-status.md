---
language: "vi"
status: "active"
updated_at: "2026-07-13"
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
| Packaged journeys | `file-review-packaged.mjs` A–L — **PARTIAL** in this session (live agent file writes did not land on disk; `verify:release` PASS) |
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
  steps did not complete in this verification environment (re-run in clean profile recommended).

Full L9 / release-candidate verification is **not** complete.

## Renderer Toolchain Slice (this session)

`app/ui` (the Cowork GHC renderer) now builds with React, executing the stack already named
in ADR 0008 §5 ("Electron + React", bundler/version choice deferred to the UI task) and the
`@cowork-ghc/ui` package description ("React/UI in later tasks"). This is a foundation slice
only — one representative module was converted end-to-end to prove the pattern; the remaining
~35 `app/ui/src` modules (including the `app-shell.ts` chat shell) are still vanilla
TypeScript/DOM and will convert one at a time in later slices.

### What shipped

- Toolchain: `react`/`react-dom` 19.2.7 (in `app/ui/package.json`), `@vitejs/plugin-react`
  ^4.7.0 + `@types/react`/`@types/react-dom` (root devDependencies, matching the
  `vite`/`typescript`/`electron` convention). Stayed on the monorepo's existing Vite 6 /
  TypeScript 5.7 pins rather than adopting newer majors.
- `app/ui/vite.config.ts` and `app/ui/tsconfig.json` updated for JSX (`react-jsx` runtime);
  all existing build invariants (`base: "./"`, `sourcemap: false`, loopback-only CSP) unchanged.
- Pilot conversion: `skills-panel.ts`'s `mountSkillsPanel` DOM builder replaced by a
  `SkillsPanel`/`SkillCard` React component (`app/ui/src/SkillsPanel.tsx`), with `skills-panel.ts`
  kept as a thin `createRoot`/`useImperativeHandle` shim so the existing call site in
  `app-shell.ts` needed no changes. Markup, classnames, and Vietnamese copy preserved 1:1.
- Tailwind/CVA/`cn()` and `@testing-library/react` deliberately deferred — not needed until a
  second component requires shared variant-driven styling.

### Verification

- `npm run typecheck` — no new errors (2 pre-existing errors in `knowledge-graph-view.ts` /
  `knowledge-settings.ts`, unrelated to this slice, confirmed present on the unmodified baseline).
- `app/ui` test suite (`npm test --workspace @cowork-ghc/ui`) — 185/188 runnable tests pass;
  the 3 failures are pre-existing, in `knowledge-e2e-timeout.test.ts` /
  `knowledge-e2e-unavailable.test.ts` (files untouched by this slice, confirmed via `git diff`
  against the baseline).
- `npm run build:renderer` — production Vite build succeeds, no sourcemaps emitted.
- `git diff --stat app/ui/src/app-shell.ts` — no changes (chat shell untouched).

## Next Implementation Slice

Next Agent: Cursor.

Recommended next slice after File Work Review packaged PASS:

```text
Minimal Workspace Navigator
```

Do not start the next slice until Product Owner issues its brief.

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/file-review-packaged.mjs
node tools/verify/skills-foundation-packaged.mjs
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/provider-readiness-packaged.mjs
```
