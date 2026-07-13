---
name: cowork-ghc-commercial-ui
description: Implement and review Cowork GHC packaged Electron production GUI readiness. Use when translating an approved UI Shell design or Product Owner/audit findings into bounded production UI fixes, screenshots, and commercial-readiness evidence without claiming PASS from tests alone.
---

# Cowork GHC Commercial UI

## Goal

Turn approved Cowork GHC shell design into a packaged Electron UI that looks and behaves like a sellable product. Do not claim commercial PASS only because automated tests pass; use packaged screenshots and Product Owner observations as acceptance evidence.

## Source Of Truth

- Git branch, HEAD, status, and diff.
- Canonical docs under `docs/product/`, `docs/quality/`, and `docs/architecture/`.
- Packaged Electron app behavior and fresh production screenshots.
- Product Owner observations and independent audit reports.

Do not use prototype screenshots as production evidence.

## Workflow

1. Verify branch, HEAD, and clean/dirty tree.
2. Inspect current shell modules and define the bounded issue list from the audit.
3. Implement only the audited UI, layout, accessibility, and state-semantics fixes.
4. Run focused UI/unit tests, typecheck, renderer build, release verifier, packaged build, and visual smoke.
5. Capture packaged screenshots at desktop and narrow widths, including inspector, settings, provider states, tooltips, and long text.
6. Review responsive behavior, keyboard focus, Escape handling, overflow ownership, and display scaling when available.
7. Remove dead UI/CSS only after reference checks.
8. Record evidence, closure matrix, deferred items, and acceptance recommendation.

## UI Invariants

- Keep native Windows controls and correct drag/no-drag regions.
- Keep the stable product rail; no duplicate Workspace or Knowledge Graph rail items.
- Keep Cowork and Workspace mutually exclusive inside the Cowork surface.
- Panels must fill from below topbar to above status bar.
- Inspector open must not collapse the main canvas.
- Scrollbars belong to the active content panel, not the whole shell.
- Status semantics must distinguish Service, Runtime, Provider configured, Provider untested, Provider ready, and Provider failed.
- Tooltips must be accessible, keyboard reachable, collision-aware, and not clipped by sidebar bounds.
- Do not fake provider, D1-D4, graph, Microsoft, dispatch, gateway, or code capability.

## Screenshot Matrix

Capture at least:

- Cowork ready at 1920x1080 and 1366x768.
- Cowork narrow around 900-1024px.
- Inspector open and closed.
- Workspace normal and long path.
- Settings Provider and General.
- Provider missing, provider untested, and provider ready when safe.
- Rail tooltip and titlebar/native control evidence.
- Structural state JSON.

## Accessibility Checklist

- Visible focus for rail, tabs, settings navigation, composer controls, status actions, and inspector toggle.
- `aria-label` or visible label for icon-only controls.
- `aria-expanded` for collapsible inspector/sidebar controls.
- `aria-describedby` for tooltips where possible.
- Escape closes Settings or drawers without data loss.
- Keyboard tab order remains predictable.
- Status does not rely on color alone.

## Anti-Patterns

- CSS-only wrapping over legacy shell composition.
- Giant flat Settings modal or backdrop for application settings.
- Nested/double scroll in shell, settings, inspector, or workspace tree.
- Unexplained dots or badges.
- Technical provider IDs exposed when a friendly provider/model label is available.
- Green/healthy color for unverified provider connection.
- Hidden functionality without a discoverable entry point.
- Treating test PASS as commercial UI PASS.

## Definition Of Done

- All blocker, high, and core UX/layout/accessibility medium issues from the audit are fixed or explicitly deferred with impact.
- Packaged screenshots prove the production app state, not the prototype.
- Focused tests/builds pass or failures are explained honestly.
- No D1-D4, Multi-Provider Profiles, runtime/service behavior, File Work Review, or unrelated architecture scope was added.
- Canonical docs and handoff name the UI baseline, invariants, deferred work, and next integration intake action.
