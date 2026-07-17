---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# UI Shell V3 Commercial Readiness Audit

## 1. Executive Verdict
**Verdict:** PASS WITH BOUNDED FIXES

Application core functionalities and major V3 composition are correctly ported. However, the UI still lacks essential commercial polish and violates specific Product Owner instructions (notably the Settings full-screen surface and status semantics). Once the bounded fixes are addressed, the shell will be ready to merge.

## 2. Correctness Distinctions
- **Functional Correctness:** PASS. The application correctly routes state, switches modes, and opens features.
- **Visual Correctness:** PARTIAL PASS. Some spacing and layout issues exist (e.g., Workspace file tree gaps, tooltip clipping).
- **UX Correctness:** PARTIAL PASS. Misleading semantic colors (e.g., "Chưa kiểm tra" in green) and cumbersome modal interactions.
- **Commercial Readiness:** NOT READY. Needs the bounded fixes below to be presentable as a premium product.

## 3. Issue Matrix

| ID | Severity | Surface | Evidence | Observable Behavior | Impact | Type | Component | Remediation | AC | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| UI-CR-001 | BLOCKER | Settings | `settings-provider.png` | Settings is a scrolling modal with a backdrop, lacking internal navigation for Provider vs. General. | Violates PO instruction for full-screen surface. Confusing navigation. | Refinement | `SettingsModal`, `SettingsView` | Make Settings a full-screen surface without a modal backdrop. Implement internal navigation tabs. | Settings occupies main area; Provider/General are separate tabs; no backdrop. | OPEN |
| UI-CR-002 | HIGH | Workspace | `workspace.png` | Large vertical gap before `> docs` and `> src` file tree. | Looks broken, poor vertical space usage. | Regression | `.workspace-nav--full`, `WorkspaceNavigator` | Fix flex/grid layout so hidden elements (`.workspace-recent`) don't consume space. | File tree begins immediately below the filter row. | OPEN |
| UI-CR-003 | HIGH | Status Bar | `cowork-ready-1920.png` | "DeepSeek · Chưa kiểm tra" text is colored green (`is-ok`). | Users misinterpret untested connection as working. | Refinement | `providerStatus()` in `provider-readiness.ts` | Remove `ok: true` when `connectionTestState === "unknown"`. | "Chưa kiểm tra" uses a neutral or warning color, not green. | OPEN |
| UI-CR-004 | MEDIUM | Product Rail | `rail-tooltips.png` | Tooltips clip or overlap awkwardly with the sidebar. | Unprofessional visual polish. | Regression | `.product-rail__item[data-tooltip]` CSS | Adjust tooltip positioning/z-index to float clearly above sidebar. | Hovering shows complete tooltips without clipping. | OPEN |
| UI-CR-005 | MEDIUM | Composer | `cowork-ready-1920.png` | Floating hint text and minor baseline misalignment. | Minor aesthetic gap. | Refinement | `.composer` CSS | Adjust margins and ensure baseline alignment for Attach, Skills, Provider, Send. | Bottom controls align vertically on centers. | OPEN |

## 4. Settings Full-Screen Information Architecture
- The current implementation traps all settings inside a long scrollable dialog.
- **Required Architecture:** The Settings area must replace the main Cowork/Workspace canvas completely when activated. It must provide an internal sidebar or tab system to switch between "Nhà cung cấp" (Provider) and "Chung" (General) without scrolling endlessly.
- **Navigation:** A clear "Đóng" (Close) or "Trở về" (Back) action must exist to return to the previous product surface.

## 5. Responsive and Windows Display Scaling
- **1920x1080 & 1366x768:** Main layouts hold up, but composer feels slightly detached at 1920px. Inspector works well as docked/overlay.
- **Display Scaling (125%, 150%):** The `px`-based fonts and paddings scale reasonably well with native OS zoom. Window chrome (titlebar) correctly utilizes native controls.
- **Action:** Ensure flex layouts (like `.inspector-shell`) reliably stretch from topbar to status bar across all viewport sizes and display scales.

## 6. Accessibility
- **Tab Order & Focus:** Generally acceptable, but the rail tooltips may obscure focused elements.
- **Aria Labels:** `aria-label` and `aria-expanded` are present on most interactive elements (e.g., product rail buttons).
- **Status Contrast:** Need to ensure the new non-green color for "Chưa kiểm tra" meets contrast requirements.

## 7. Good Things (Do Not Redesign)
- The global layout composition (Rail + Sidebar + Main + Inspector) is solid.
- Native Windows titlebar integration is correct and must not be replaced with custom controls.
- The typography (Be Vietnam Pro) and core design tokens are effective.
- Work mode switching (Cowork vs Workspace) is functional and correct.

## 8. Valid Deferred Things
- Multi-Provider Profiles (not required for Phase 1).
- Full D1–D4 integrations (slots are correctly implemented as placeholders).
- Direct file editor, PDF, and Office preview functionalities.

## 9. Bounded Remediation Scope
To close this pass, the implementation agent must:
1. Refactor Settings from a modal to a full-screen surface with internal navigation (UI-CR-001).
2. Fix the Workspace file tree whitespace bug (UI-CR-002).
3. Correct the "Chưa kiểm tra" semantic color in the status bar (UI-CR-003).
4. Fix tooltip z-index/clipping on the product rail (UI-CR-004).
5. Polish composer baseline alignments (UI-CR-005).

## 10. Final Recommendation
Do not merge into `feature/main` yet.
Apply the bounded remediation scope in a single focused pass. Once UI-CR-001 through UI-CR-005 are resolved, the V3 commercial UI will be ready for final acceptance and merge.
