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
> `tools/ui-audit/`) captured **45 screenshots** of the packaged `coworkghc.exe` across every rail
> surface, both themes, first-run and Settings states, **data-rich Knowledge** (an isolated
> seed workspace indexed in audit mode: document list, detail, FTS search, graph node/edge + select,
> re-sync prune, safe clear), the Code runtime panels' empty states (shots 32–35), **plus a real
> Code Web Preview LIVE-RUN** over a committed web fixture (`tools/ui-audit/fixtures/web-preview`):
> detect dev target → permission confirm → running on a real loopback port → embedded page serves the
> real fixture marker → Kết quả with real log lines → stop (no orphan) → deliberate error mode →
> Vấn đề with a real parsed `src/app.tsx:12:7` (shots 36–39/60/62/63, light+dark). Raw output is
> git-ignored under `reports/ui-audit/<run-id>/` (contact sheet: `contact-sheet.html`). The cold-start
> findings below are from a **fresh, unconfigured** profile (no provider) — the honest cold-start a
> newcomer sees. States requiring a live provider / Cowork streaming / error injection / DPI scaling
> are not yet covered (see Gaps).
>
> **Re-audit 2026-07-18 (`audit/exhibition-live-states`):** Full packaged re-capture confirms the
> product is exhibition-clean — every surface renders in both themes with honest empty states + a
> clear next action, no white screens, no clipping/overflow, no wrong-enabled buttons, no raw
> developer text. Several prior MEDIUM findings are now **resolved** in the shipped build: **F2**
> (Dispatch remote pane no longer exposes `CGHC_REMOTE_ENABLED` env-vars — friendly "mở lại bằng lối
> tắt Cowork GHC" copy), **F4** (status bar reads the blocking dependency "Cần chọn workspace", not a
> green "Sẵn sàng" contradiction), **F3** (Dispatch Chạy actions render gated). One new bounded
> commercial-consistency defect was found **and fixed** this pass — see **F10**.

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
| F10 | Code · Xem trước / Ứng dụng | 32/34-code | MEDIUM (**FIXED 2026-07-18**) | The Code runtime panes leaked English into the fully-Vietnamese commercial UI: preview status-bar kind label `"Preview"`, overlay title `"Web preview"`, and header runtime pills `"Preview: tắt"` / `"App: tắt"` — none matched the localized mode buttons (`Xem trước` / `Ứng dụng`). | Off-brand raw English on a demo surface; inconsistent with the commercial-UI standard. | Localize to `Xem trước` / `Ứng dụng` across the status bar, overlay title, and header pills. | code preview/app | No English `Preview`/`App` label in the Code runtime panes; header pill mirrors the active mode. **Done** (`preview-controller.ts`, `app-controller.ts`, `code-view.ts`; test `preview-controller` + packaged shots 32–35). |
| F11 | Code · Xem trước | 63-code-preview-problems (live-run) | MEDIUM (**FIXED 2026-07-18**) | On a **second** run (re-run/restart or a follow-up script), the "Kết quả"/"Vấn đề" panes stayed empty: the service restarts its output sequence at 0 on every launch, but the renderer kept its stale `lastSeq` cursor (and a poll tick during the permission prompt re-primed it from the previous buffer), so `since(lastSeq)` returned nothing and a real build error never surfaced. | A re-run's output and parsed problems silently vanish — misleads the user into thinking a failing run produced no diagnostics. | Stop polling for the whole start handshake, reset the cursor after the service (re)starts, and detect the sequence reset. | code preview | Second run shows its own output + parses the error into "Vấn đề". **Done** (`preview-controller.ts` `doStart`/`doRestart`/`doStop`; tests `preview-controller` "re-run resets the output cursor"; packaged live-run shot 63 shows `Vấn đề (1)` = `src/app.tsx:12:7`). |
| F12 | Code · Xem trước | preview-controller | LOW (**FIXED 2026-07-18**) | Re-entering Preview after switching the active workspace kept a stale `unsupported` detection (detect only ran when `info` was null), so a newly-web workspace's Start stayed disabled until a full reset. | A valid dev-server project can look unpreviewable after a workspace switch. | Re-detect capability on every (re)activation of Preview. | code preview | Start enables after switching to a web workspace. **Done** (`preview-controller.ts` `setActive`; test "re-detects capability each time Preview is re-activated"). |

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

### Top exhibition items (updated after the 2026-07-18 re-audit)

1. ~~F2 — developer env-var instructions in the Dispatch remote pane.~~ **Resolved** (friendly copy).
2. ~~F4/F3 — "Ready" contradicting "provider not configured".~~ **Resolved** (status bar shows the
   blocking dependency; Dispatch actions gated).
3. F10 — English `Preview`/`App` labels in the Code runtime panes. **Resolved** (localized).
4. Remaining, lower priority: F1 (first-run card theme — likely intentional dark "spotlight"), F5
   (MS365 interactive-while-disconnected), F8/F9 (settings whitespace / top-bar consistency).

No BLOCKER- or HIGH-severity UI defects in either pass: every surface renders in both themes, the
D1–D4 placeholders are honest (no fabricated capability), and the fix-now bounded categories
(readiness contradiction, wrong-enabled buttons, blank/confusing screens, clipping/overflow,
first-run errors, raw developer text, missing next action, commercial regressions) are all clear.

### Preserve (do not redesign)

Cowork and Code are the quality bar. The **honesty** of the D3/D4/MS365 empty states is a strength —
keep the explicit "not integrated / no fake data" messaging when consolidating layouts.

### Redesign vs polish

All findings are **polish-only** (gating, theming, layout balance, copy). No surface needs a
redesign based on the cold-start evidence.

## Code screen — exhibition evaluation (2026-07-18)

Answers to the four Code-screen questions, from the packaged shots 05/31 (editor) + 32–35 (runtime
panels):

- **Is the current layout enough for the exhibition? — Yes.** The three-pane shell (Explorer +
  Source Control on the left, Code/Xem trước center with a Web/Ứng dụng segmented control and a
  Kết quả/Vấn đề output drawer, Agent on the right) renders cleanly, with honest empty states and a
  clear next action on every pane. No white screen, clipping, or overflow at 1440×900 or 1920×1080.
- **Does the left sidebar need to become `Workspace | Agent` now? — No.** The Explorer already owns
  Workspace (file tree + Tất cả/Gần đây/Đã đổi + Source Control) on the left and Agent has its own
  collapsible right panel; folding them into one tab set would *reduce* usable width and add a
  WebContentsView bounds-sync risk. Defer.
- **Does the right-side `Xem trước | Kết quả | Vấn đề` layout block anything? — No.** It ships today
  as `Xem trước` (a center mode) + a `Kết quả`/`Vấn đề` drawer, now proven end-to-end **packaged**:
  a real dev-server serves content in the embedded view, `Kết quả` shows real log lines, and `Vấn đề`
  parses a real `file:line:col` on a failing run (shots 36–39/60/62/63). Restructuring into a single
  right panel is polish, not a blocker.
- **Are dependency-install and the Python tier needed before the exhibition? — No.** With a non-web/
  non-app workspace the panes show clear, honest guidance ("Chưa xem trước được: thiếu index.html và
  package.json", "Chưa chạy được ứng dụng: thiếu package.json"). Node/TS + Electron detection is the
  demoable path (the packaged live-run above uses exactly `npm run dev`); dependency-install and
  Python/Go/Rust/Java/.NET tiers stay deferred (no fake capability). See `current-status.md` and
  `feature-matrix.md`.

**Verdict:** the Code screen is exhibition-ready as-is, and the Web Preview run path now has a
**packaged live-run acceptance** (not just layout). Code defects this pass — F10 (English labels),
F11 (re-run output/problems empty), F12 (stale re-detect) — are all fixed. The remaining Code work
(right-panel restructure, dependency install, Python tier, Desktop-App live-run, editor edit+save
live) is optional polish/scope, not exhibition-blocking.

## Gaps (next capture passes)

Automated audit mode cannot exercise these — they need a live provider / real device / DPI harness /
fault injection and are **Product-Owner manual** acceptance steps. Not yet captured, needed before
exhibition sign-off:

- Provider **configured + connected**: Cowork streaming a turn, model switcher, provider status green.
- **Workspace loaded**: Code editor with a file open + dirty edit + diff; Workspace Companion Office/
  PDF preview. *(Code **Web Preview** live-run is now covered — automated packaged acceptance over a
  real web fixture; see the status block + F11. The **Desktop App / Ứng dụng** live-run and editor
  edit+save live remain PO-manual.)*
- **Embedded preview pixels**: the embedded `WebContentsView` content is verified by reading its DOM
  (the fixture marker) in audit mode; a **pixel** screenshot of that child view returns an empty frame
  when the audit window is not OS-foreground, so the visual is a PO-manual confirmation.
- **Permission + File Work Review** dialogs; Inspector plan/activity/files populated.
- **Error/recovery** states (N1–N20 in `release-acceptance.md`): provider offline, DB locked,
  OpenCode crash, permission denied — needs fault injection in audit mode.
- **Dispatch** live phone round-trip via `start.bat` (Remote/LAN); **MS365** live tenant connect.
- **DPI 125/150%** and larger displays (this run's "large" viewport clamped to the work area).
