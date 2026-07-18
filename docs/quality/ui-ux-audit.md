---
language: "en"
status: "active"
updated_at: "2026-07-18"
owner: "quality"
---

# UI/UX Commercial Audit

Findings from reviewing **real screenshots of the packaged app**, against
`.agents/skills/cowork-ghc-commercial-ui/SKILL.md` and the current design tokens.

> **Status: evidence captured (2026-07-18).** The ER-013 tool (`npm run audit:ui`,
> `tools/ui-audit/`) captured **33 screenshots** of the packaged `coworkghc.exe` across every rail
> surface, both themes, first-run and Settings states, **plus data-rich Knowledge** (an isolated
> seed workspace indexed in audit mode: document list, detail, FTS search, graph node/edge + select,
> re-sync prune, safe clear). Raw output is git-ignored under `reports/ui-audit/<run-id>/` (contact
> sheet: `contact-sheet.html`). The cold-start findings below are from a **fresh, unconfigured**
> profile (no provider) — the honest cold-start a newcomer sees. States requiring a live provider /
> Cowork streaming / error injection are not yet covered (see Gaps).

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

Screenshot IDs refer to files under `reports/ui-audit/<run-id>/screenshots/`. Severity here is
UI/UX only; none of these are functional crashes (the packaged app renders every surface cleanly).

| ID | Surface | Screenshot | Severity | Observation | User impact | Proposed fix | Scope | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | First-run | 01/02-first-run-setup | MEDIUM | The `.app-lock` setup/unlock card renders dark in **both** light and dark themes (theme-independent). | The very first screen ignores the chosen/system light theme — feels off-brand at cold start. | Theme the lock card via `data-theme` tokens (or confirm the dark "spotlight" is intentional and document it). | shared (`app-lock`) | Card matches active theme, or intent recorded. |
| F2 | Dispatch | 07-surface-dispatch | MEDIUM | Remote pane instructs the user to "Khởi động lại với `CGHC_REMOTE_ENABLED=1` (và `CGHC_REMOTE_LAN=1`)". | Exposing env-var + restart steps in product UI is developer-facing, not exhibition-grade. | Replace with an in-app enable toggle, or hide the remote pane unless the capability is available. | dispatch remote | No env-var/restart instructions in the shipped UI. |
| F3 | Dispatch | 07-surface-dispatch | MEDIUM | Built-in dispatch tasks show active **Chạy** buttons while `Provider · Chưa cấu hình`. | Running a task with no provider will fail; the enabled button implies readiness it lacks. | Gate the actions on provider-ready; show a disabled state with a "configure a provider" reason. | dispatch | Actions disabled + explained until a provider is configured. |
| F4 | Cowork / all | 03-surface-cowork, status bar | MEDIUM | Status bar reads green **Sẵn sàng** while `Provider · Chưa cấu hình` (orange) and chat is impossible. | Mixed readiness signal — "Ready" contradicts "provider not configured". | Make the readiness chip reflect the blocking dependency (needs-config) per the ER-007 model. | shared status bar | Readiness chip never shows "Ready" when a required dependency is missing. |
| F5 | Microsoft 365 | 09-surface-microsoft | LOW | Suggestion chips + composer are interactive while `Chưa kết nối` and no provider is set. | Inviting input that cannot succeed yet; click leads to failure/no-op. | Disable chips/composer until connected + provider-ready, or route them to the connect flow. | microsoft | Input gated until prerequisites met. |
| F6 | Gateway | 08 | LOW | Gateway remains a pure "awaiting integration" placeholder (centered hero + pill). Knowledge (D3) is now a real unified-store surface, no longer a placeholder — this finding no longer applies to it. | Placeholder-only concern for D4. | Keep the honest "awaiting integration" template for D4 Gateway (ER-010). | shared placeholder | Only D4 remains a placeholder surface. |
| F7 | Cowork | 03-surface-cowork | LOW | Provider-not-configured is stated twice (composer "Provider chưa cấu hình" + status bar "Provider · Chưa cấu hình"). | Minor redundancy/visual noise. | Keep one primary indicator + one actionable CTA. | cowork | Single clear provider-config affordance. |
| F8 | Settings · Chung | 22-settings-general | LOW | "Giao diện" column is sparse (control at top, large empty area) while "Chẩn đoán" is full — unbalanced. | Wasted whitespace; asymmetric density. | Balance the two-column layout or add theme-preview/description to the left column. | settings | Columns visually balanced. |
| F9 | Top bar | 03 vs 05 vs 06/08/09 | LOW | Top-right controls vary by surface (Cowork: inspector-toggle + settings; Code: sparkle + settings; placeholders: settings only). | Slightly inconsistent affordance placement. | Standardise the top-bar control set / order across surfaces. | shared topbar | Consistent top-bar controls. |

## Roll-ups

### Score per surface (1–5)

| Surface | Score | Note |
| --- | --- | --- |
| Cowork | 5 | Reference bar — clean hierarchy, honest empty state. **Preserve.** |
| Code (Workspace) | 5 | Reference bar — three-pane Explorer/editor/Agent, honest empty states. **Preserve.** |
| Skill & MCP | 4 | Clear catalog, create/detail flow, honest "Đang tắt" state. |
| Settings (Nhà cung cấp / Chung) | 4 | Clean; minor whitespace balance (F8). |
| Knowledge (D3) | 4.5 | Real unified store (2 tabs `Kho tri thức`/`Đồ thị`, no source tabs); status/doc list/search/graph + provenance badges + source filter; Microsoft 365 = honest readiness (no fake, no network). **Data-rich packaged states captured** (audit 21/21, 33 shots via isolated seed workspace: index ready 7 docs/10 nodes/15 edges, list/detail/FTS snippet/graph node-select/prune/safe clear). |
| Gateway (D4) | 4 | Honest "không hiển thị dữ liệu giả trước khi team tích hợp". |
| Microsoft 365 (D2) | 3.5 | Good connect card; interactive-while-disconnected (F5). |
| First-run lock | 3.5 | Clear + localized; dark-in-light-theme (F1). |
| Dispatch (D1) | 3 | Env-var UX (F2) + ungated actions (F3). |

### Cross-product (shared components)

Readiness signalling (F3/F4/F5) and placeholder treatment (F6) recur across surfaces — fix once in
the shared status bar + a shared "awaiting integration"/"needs config" component (ER-007, ER-010).

### Top exhibition items (from this cold-start pass)

1. F2 — remove developer env-var instructions from the Dispatch remote pane.
2. F4/F3 — coherent readiness model so "Ready" never contradicts "provider not configured".
3. F1 — first-run card should honour the light theme (or document the intent).

No BLOCKER-severity UI defects in the cold-start set: every surface renders in both themes, and the
D1–D4 placeholders are honest (no fabricated capability).

### Preserve (do not redesign)

Cowork and Code are the quality bar. The **honesty** of the D3/D4/MS365 empty states is a strength —
keep the explicit "not integrated / no fake data" messaging when consolidating layouts.

### Redesign vs polish

All findings are **polish-only** (gating, theming, layout balance, copy). No surface needs a
redesign based on the cold-start evidence.

## Gaps (next capture passes)

The first pass used a fresh, unconfigured profile. Not yet captured, needed before exhibition sign-off:

- Provider **configured + connected**: Cowork streaming a turn, model switcher, provider status green.
- **Workspace loaded**: Code editor with a file open + dirty edit + diff; Workspace Companion preview.
- **Permission + File Work Review** dialogs; Inspector plan/activity/files populated.
- **Error/recovery** states (N1–N20 in `release-acceptance.md`): provider offline, DB locked,
  OpenCode crash, permission denied — needs fault injection in audit mode.
- **DPI 125/150%** and larger displays (this run's "large" viewport clamped to the work area).
