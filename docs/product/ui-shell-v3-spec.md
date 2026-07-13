# Cowork GHC UI Shell V3 — Design Specification

**Status:** design prototype R3 approved; **production port applied** on `feature/ui-shell-v3-production`.

**Prototype path:** `design/ui-shell-v3/` (`index.html`, `styles.css`, `prototype.js`)

**Production code:** `app/ui/src/ui-shell/` + orchestration in `app/ui/src/app-shell.ts`.

**Prototype evidence:** `reports/ui-shell-v3-r3/` (+ `visual-state-check.json`).

**Production evidence:** `reports/ui-shell-v3-production/` — Product Owner packaged visual acceptance **pending**.

---

## 1. Product Owner decisions (R3)

| Decision | Spec |
|---|---|
| Cowork / Workspace | Two **work modes** — switching tabs changes sidebar **and** main area |
| Workspace tabs | File tabs only — **no** `Cuộc trò chuyện` tab |
| Click file in Cowork | Switches to Workspace mode and opens file |
| Knowledge | **One** rail surface; internal tabs `Kho tri thức \| Đồ thị` |
| Graph tab | Capability-gated by D3 contract (`knowledge-no-graph` vs `knowledge-with-graph` fixtures) |
| Provider selector | **Conversation-level** in composer (Phase 1) — not per-turn override |
| Bottom status bar | **Connectivity/status only** — not primary provider picker |
| Workspace Phase 1 | Read-only preview + File Review — no direct editor |
| Inspector labels | Vietnamese: Kế hoạch, Hoạt động, Tệp, Xem lại |

Implementation into `app/ui/` is **ported** (2026-07-13). D1–D4 backends, Multi-Provider Profiles, and full regression remain deferred.

---

## 2. Layout architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Topbar (brand, icon actions, window controls)               │
├──┬──────────┬──────────────────────────────┬───────────────┤
│R │ Sidebar  │ Main (work mode or surface)  │ Inspector     │
│a │ Cowork | │                              │ (docked/      │
│i │ Workspace│                              │  overlay)     │
│l │ work tabs│                              │               │
├──┴──────────┴──────────────────────────────┴───────────────┤
│ Status bar (workspace · service · runtime · connectivity)   │
└─────────────────────────────────────────────────────────────┘
```

Main workspace **never collapses**. Palette, typography, icon system, and visibility model from R2 are preserved.

---

## 3. Product rail

```text
Cowork | Dispatch | Gateway | Knowledge | Microsoft 365 | Code
```

No separate **Knowledge Graph** rail item.

| Surface | Prototype |
|---|---|
| Cowork | Work modes (Cowork / Workspace) via sidebar tabs |
| Dispatch / Gateway / Microsoft / Code | Integration empty — no Cowork chrome |
| Knowledge | Header + `Kho tri thức \| Đồ thị` tabs — no Cowork chrome |

---

## 4. Work modes (Cowork rail surface)

Sidebar tabs **Cowork | Workspace** switch the **entire** work mode.

### Cowork mode

**Shows:** conversation search, list, icon New Conversation, conversation title, transcript, composer (attach, skills, provider selector, send), permission/recovery banners when needed.

**Hides:** file document tabs, file preview, workspace empty state, `Cuộc trò chuyện` document tab.

### Workspace mode

**Shows:** workspace identity, search/filter, filters, refresh, file tree, file tabs (files only), breadcrumb, metadata, read-only preview (max-width ~1160px), optional inspector (Tệp / Xem lại).

**Hides:** conversation list, title, transcript, composer, Cowork permission banners.

**Empty main:** `Chọn một tệp để xem trước` + hint to click **Cowork** tab.

### Click file from Cowork

Transcript attachment / file link → Workspace mode → tree selection → file tab → optional File Review in inspector. Never overlays transcript.

---

## 5. Knowledge surface

Single rail entry **Knowledge** with:

```text
Knowledge
[Kho tri thức | Đồ thị]
```

| Tab | Unintegrated copy |
|---|---|
| Kho tri thức | `Kho tri thức` + `Chờ tích hợp D3` |
| Đồ thị | `Đồ thị tri thức` + `Chờ tích hợp D3` — full main canvas |

**Capability gate:** `Đồ thị` tab visible only when D3 reports graph support (`knowledge-no-graph` fixture hides it).

No mock sources, indexes, retrieval, or graph data.

---

## 6. Composer — provider & skills (Phase 1 semantics)

Footer layout:

```text
Attach | Skills: N | ● DeepSeek / deepseek-chat ▾ | spacer | Send
```

**Provider selector** sets the **active provider profile for the current conversation** (snapshot on new conversation from global default). Changing provider applies to **future turns** only — does not rewrite history.

| State | UI |
|---|---|
| Configured | Selector visible; status bar green `DeepSeek · Sẵn sàng` |
| Missing | Selector hidden/disabled; status bar amber; recovery CTA when needed |
| Failed | Selector + `Kết nối thất bại` text; status bar red |

**Skills:** compact `Skills: 1` (or badge) opens popover — not a sidebar tab.

---

## 7. Status bar

Left: `Workspace` · `Service` · `Runtime`

Right: provider **connectivity** (green / amber / red / gray) — click may open settings/details. **Not** the conversation profile picker.

---

## 8. Inspector

| Mode | Tabs |
|---|---|
| Cowork | Kế hoạch, Hoạt động, Tệp, Xem lại — not open by default |
| Workspace | Prefer Tệp, Xem lại — default Xem lại when File Review relevant |
| D1–D4 / Knowledge | No Cowork inspector reuse |

---

## 9. Topbar

Brand + sidebar/inspector toggles + info + settings + window controls. No filename, no service/provider/runtime pills.

---

## 10. Responsive

| Width | Behavior |
|---|---|
| 1920 | Rail + sidebar + main + optional docked inspector |
| 1366 | Inspector overlay; main min ~680px |
| 900 | Rail + main; sidebar/inspector drawers; one at a time; scrim; Escape; focus trap; no horizontal overflow |

---

## 11. Visibility invariants and screenshot validation

Global rule (from R2):

```css
[hidden] {
  display: none !important;
}
```

Harness: `assertVisualState`, `applyStateAndSettle`, `runSequentialTransitionTest`, `assertClickFromChat`. Fresh browser context per screenshot. Non-zero exit on failure.

**R1/R2 screenshots are invalid** for overlapping views; **R3** is current evidence (not PO-accepted).

---

## 12. Prototype states

| State ID | Demonstrates |
|---|---|
| `cowork-active` | Cowork mode, provider configured |
| `cowork-inspector-open` | Inspector open in Cowork mode |
| `workspace-empty` | Workspace mode, no file |
| `workspace-file` | File tab + preview |
| `workspace-file-review` | File + inspector Xem lại |
| `knowledge-no-graph` | Knowledge — Kho only |
| `knowledge-base` | Knowledge — both tabs, base selected |
| `knowledge-graph` | Knowledge — graph tab (capability on) |
| `gateway` | Gateway integration |
| `provider-missing` | Amber status, no selector |
| `provider-failed` | Red status + failure text |
| `waiting-permission` | Permission banner |
| `cowork-900` / `workspace-900` | Narrow layouts |

Regenerate: `node design/ui-shell-v3/capture-screenshots.mjs`

---

## 13. Screenshots (R3)

`reports/ui-shell-v3-r3/` — 15 PNGs + `visual-state-check.json`:

`cowork-1920`, `cowork-1366`, `cowork-900`, `cowork-inspector`, `workspace-empty`, `workspace-file` (redacted from R3 — sensitive content), `workspace-file-review`, `workspace-900`, `knowledge-no-graph`, `knowledge-base`, `knowledge-graph`, `gateway`, `provider-missing`, `provider-failed`, `waiting-permission`.

---

## 14. Open Product Owner decisions (post-R3)

| ID | Question |
|---|---|
| PO-V3-6 | Confirm conversation provider change requires confirmation when history exists? |
| PO-V3-7 | Default inspector tab in Workspace without File Review? |
| PO-V3-8 | Skills popover vs modal for Phase 1 production? |
| PO-V3-9 | Schedule production port relative to D3/D4 intake? |

---

## Revision log

| Date | Change |
|---|---|
| 2026-07-13 | Initial V3 prototype |
| 2026-07-13 | R1: sidebar tabs, document tabs, status bar |
| 2026-07-13 | R2: visibility invariants; R1/R2 screenshot overlap invalidated |
| 2026-07-13 | **R3:** work modes, unified Knowledge, provider/skills composer, PO decisions, R3 screenshots |
