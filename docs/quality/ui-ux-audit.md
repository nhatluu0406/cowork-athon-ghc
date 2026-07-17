---
language: "en"
status: "active"
updated_at: "2026-07-18"
owner: "quality"
---

# UI/UX Commercial Audit

Findings from reviewing **real screenshots of the packaged app**, against
`.agents/skills/cowork-ghc-commercial-ui/SKILL.md` and the current design tokens.

> **Status: awaiting evidence.** The audit session that created this file scoped *out* packaging and
> the automated UI-capture tool (by Product-Owner decision). The screenshot base is produced by the
> next slice — **ER-013** in `../product/exhibition-readiness-plan.md §4`. This document is the
> destination for those findings; the method, quality bar, and finding schema below are fixed now so
> the capture slice can populate it directly.

## Quality bar to preserve

The Product Owner considers **Cowork** and **Workspace** the two strongest surfaces today. They are
the reference bar. **Do not redesign them** absent a regression; audit other surfaces up to their
level.

## Method

1. Run `npm run audit:ui` (ER-013) to capture every surface/state (light + dark; 1440×900 + 1920×1080
   for key surfaces) into `reports/ui-audit/<run-id>/`.
2. Open every image and review against the criteria below.
3. File findings in the table with screenshot evidence.
4. Roll up into scores, cross-product findings, top blockers, and "preserve" list.

## Criteria

Visual hierarchy · alignment/grid · density/whitespace · typography · icon consistency · component
consistency · light/dark · color/contrast · empty/loading/error states · readiness/status clarity ·
discoverability · navigation · onboarding · primary action · dangerous action · permission clarity ·
progress feedback · responsive desktop sizing · overflow/clipping · Windows DPI · keyboard/focus ·
tooltip · modal/dialog · perceived completeness · exhibition readiness.

## Finding schema

| ID | Surface | Screenshot | Severity | Observation | User impact | Proposed fix | Scope (shared/screen) | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Severity: BLOCKER / HIGH / MEDIUM / LOW. Classify each as: functional defect · visual inconsistency ·
missing state · confusing UX · unfinished placeholder · polish.

## Findings

_None yet — populated by the ER-013 capture slice._

## Roll-ups (to be completed)

- Score per surface (1–5)
- Cross-product findings (shared components)
- Top exhibition blockers
- Strengths to preserve (baseline: Cowork, Workspace)
- Screens needing redesign vs polish-only
