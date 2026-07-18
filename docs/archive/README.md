---
language: "en"
status: "archive-index"
updated_at: "2026-07-18"
---

# Documentation Archive

Historical Markdown that is **no longer canonical** but kept for provenance. Nothing here is a source
of truth — always prefer the canonical docs listed in [`../README.md`](../README.md). Git history
remains the final recovery source.

Policy note: this archive folder reverses the older "Git history is the only archive" rule in
`docs/README.md`. Historical reports/designs now live here instead of mixing with canonical docs.

## Contents

| Path | Origin | Why archived | Canonical replacement |
| --- | --- | --- | --- |
| `legacy-reports/BUG_FIX_SUMMARY.md` | repo root | one-off bug-fix summary | `../quality/known-limitations.md` + Git history |
| `legacy-reports/CODE-REVIEW-COMPLETE.md` | repo root | historical code-review report (LLM config) | `../quality/known-limitations.md` |
| `legacy-reports/LLM-CONFIG-FINAL-REPORT.md` | repo root | historical implementation report | `../llm-config-security-design.md` (design) |
| `legacy-reports/LLM-CONFIG-IMPLEMENTATION-SUMMARY.md` | repo root | historical implementation summary | `../llm-config-security-design.md` |
| `legacy-reports/ui-shell-v3-commercial-readiness-audit.md` | `docs/quality/` | superseded UI readiness audit | `../quality/ui-ux-audit.md` |
| `legacy-reports/file-review-independent-review.md` | `docs/quality/` | historical File Work Review audit | `../quality/known-limitations.md` |
| `legacy-reports/file-review-packaged-triage.md` | `docs/quality/` | historical File Work Review triage | `../quality/known-limitations.md` |
| `legacy-design/superpowers/` | `docs/superpowers/` | per-slice MS365/dispatch implementation plans + specs (historical) | `../product/feature-matrix.md`, `../product/current-status.md`, ADRs |

## Notes

- The MS365/dispatch `superpowers/plans` and `specs` document *how each shipped slice was built*.
  The current capability truth is in `../product/current-status.md` and `../product/feature-matrix.md`;
  the active decision records are the ADRs under `../architecture/decisions/`.
- Within the archived `superpowers/` tree, cross-references between sibling plan/spec files were
  preserved (moved as a group). Absolute `docs/superpowers/...` mentions in prose now point here.
- `agent-harness-plan.md` moved to `legacy-design/superpowers/plans/`. ADR prose that references
  "agent-harness-plan.md (repo root)" refers to the still-present root `AGENT-HARNESS.md`.
- Not archived (still active): ADRs, `docs/integration/` contracts (D1–D3 intake), `docs/references/`,
  `docs/architecture/`, `docs/product/`, `docs/quality/` canonical set, `docs/demo/`.
