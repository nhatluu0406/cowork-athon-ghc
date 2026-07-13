# Cowork GHC UI Shell V3 — Design Specification

**Status:** design prototype only — **not** implemented product capability.

**Prototype path:** `design/ui-shell-v3/` (`index.html`, `styles.css`, `prototype.js`)

**Production code:** unchanged (`app/ui/`, Electron shell, service/runtime).

---

## 1. Purpose

Replace the rejected packaged shell visual direction with a neutral, icon-first layout that:

- Keeps **main workspace always visible** (never collapses to zero).
- Uses **one contextual sidebar** (Cowork conversations OR Workspace file tree — never both stacked).
- Docks **inspector** on wide screens; uses **overlay drawer** at ≤1366px.
- Shows D1–D4 as **awaiting integration** without fake backend data.

This document is the Product Owner review artifact. Implementation into `app/ui/` is a **separate** decision after acceptance.

---

## 2. Layout architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Topbar (compact status, provider chip, icon actions)        │
├──┬──────────┬──────────────────────────────┬───────────────┤
│R │ Context  │ Main workspace               │ Inspector     │
│a │ sidebar  │ (Cowork | Workspace |         │ (docked or    │
│i │ (one)    │  Integration empty)          │  overlay)     │
│l │          │                              │               │
├──┴──────────┴──────────────────────────────┴───────────────┤
│ Status bar                                                  │
└─────────────────────────────────────────────────────────────┘
```

| Region | Width | Collapse behavior |
|---|---|---|
| Product rail | 48–52px | Always visible |
| Context sidebar | ~280px | Hidden → overlay at ≤900px |
| Main | `minmax(680px, 1fr)` at 1366; flex at 900 | **Never collapses** |
| Inspector | 340–360px docked | Overlay at ≤1366px |

---

## 3. Navigation model

### Product rail (icon-only)

| Surface | Production mapping | Prototype state |
|---|---|---|
| Cowork | `cowork` available | Active default |
| Workspace | Workspace navigator context | File tree sidebar |
| Dispatch | D1 `awaiting_integration` | Empty integration |
| Gateway | D4 `awaiting_integration` | Empty integration |
| Knowledge | D3 `awaiting_integration` | Empty integration |
| Knowledge Graph | D3 `awaiting_integration` | Empty integration |
| Microsoft 365 | D2 `awaiting_integration` | Empty integration |
| Code | `planned` | Empty integration |

**Rules:**

- One Cowork icon only (no duplicate brand in rail + sidebar header).
- Tooltip + `aria-label` on every rail button.
- Awaiting surfaces show badge dot; tooltip includes `Chờ tích hợp D*`.

### Context sidebar

| Rail selection | Sidebar content |
|---|---|
| Cowork | Search, conversation list, icon New Conversation in header |
| Workspace | File tree (VS Code style), filter chips, refresh — **no** conversation list |

Workspace tree is **not** placed under conversation list.

---

## 4. Main workspace modes

### Cowork mode

- Conversation header (title 20–22px).
- Chat transcript (content max ~760–900px centered).
- Compact composer (icon attach + icon send).
- Optional banners: missing provider, waiting permission (text CTA allowed).

### Workspace mode

- File metadata header.
- Text preview (no direct editor).
- Contextual File Review snippet (not a tab farm).

### D1–D4 / Code mode

- Single integration empty state in main area.
- Dependency badge (`Chờ tích hợp D1` … `planned`).
- No mock tasks, graphs, costs, or Microsoft data.

---

## 5. Inspector

| Tab | Content rule |
|---|---|
| Plan | Ordered steps only |
| Activity | Short status lines |
| Files | Path list |
| Review | One review summary |

**Only the active tab renders** — no simultaneous empty cards.

Docked ≥1367px viewport width; overlay drawer ≤1366px. Icon-only open/close in topbar and inspector header.

---

## 6. Icon-only chrome

| Former text control | V3 icon | Tooltip required |
|---|---|---|
| Cuộc trò chuyện mới | SquarePen | Yes |
| Tiếp tục cuộc trò chuyện này | PlayCircle | Yes |
| Thu gọn sidebar | PanelLeftClose | Yes |
| Mở sidebar | PanelLeftOpen | Yes |
| Mở inspector | PanelRightOpen | Yes |
| Đóng inspector | PanelRightClose | Yes |
| Cài đặt | Settings | Yes |

Text CTA reserved for onboarding, error recovery, confirmation, permission approve/deny.

---

## 7. Typography

```css
font-family:
  "Segoe UI Variable",
  "Inter Variable",
  "Segoe UI",
  sans-serif;
```

| Use | Size | Weight |
|---|---|---|
| Metadata | 12px | 400–500 |
| Secondary / compact body | 13–14px | 400–500 |
| Body | 15px | 400 |
| Section heading | 17px | 600 |
| Conversation title | 20–22px | 600 |

Avoid 700/800 except where platform requires.

---

## 8. Visual language

- Neutral white / light gray surfaces.
- Orange (`#e85d1a`) accent only — no large orange fills or giant CTA buttons.
- Light borders; minimal shadow (drawer only).
- 4/8px spacing scale.
- No gradients, no decorative animation.

---

## 9. Responsive breakpoints

| Viewport | Behavior |
|---|---|
| **1920** | Rail + sidebar + main + optional docked inspector; chat ~860px |
| **1366** | Inspector → overlay; main `min-width` 680px |
| **900** | Sidebar + inspector → overlay; rail + main only; no word-per-line wraps; no horizontal scroll |

---

## 10. Prototype states

Query: `?state=<id>` or footer **Prototype states** panel.

| State ID | Demonstrates |
|---|---|
| `cowork-active` | Default conversation |
| `cowork-sidebar-hidden` | Sidebar collapsed / overlay mode |
| `cowork-inspector-open` | Inspector visible |
| `workspace` | File tree + preview |
| `gateway` | Awaiting D4 |
| `knowledge-graph` | Awaiting D3 |
| `narrow-900` | 900px layout |
| `missing-provider` | Provider error banner |
| `waiting-permission` | Permission banner |

Fixture copy only — no FPT branding, no live provider.

---

## 11. Screenshots

Captured under `reports/ui-shell-v3/`:

| File | State / size |
|---|---|
| `main-1920.png` | cowork-active · 1920×1080 |
| `main-1366.png` | cowork-active · 1366×768 |
| `main-900.png` | narrow-900 · 900×768 |
| `workspace.png` | workspace · 1920×1080 |
| `inspector-open.png` | cowork-inspector-open · 1920×1080 |
| `gateway.png` | gateway · 1366×768 |
| `knowledge-graph.png` | knowledge-graph · 1366×768 |

Regenerate: `node design/ui-shell-v3/capture-screenshots.mjs`

---

## 12. Production mapping (for future implementation)

### Keep from current baseline

- Service/runtime boundaries, keyring, permissions, conversation store.
- Surface registry concept (`surface-registry.ts`, integration slots).
- File Review service path (behavior unchanged in V3 design).
- Packaged lifecycle scripts.

### Replace / rework in production shell (after PO acceptance)

- Dual sidebar + collapsed mini-columns layout.
- Text-heavy chrome buttons (New Conversation, Thu gọn, giant orange CTA).
- Right panel that collapses to 58px strip.
- Multiple simultaneous empty cards in inspector.
- Workspace navigator under conversation list.
- Be Vietnam Pro + card-heavy visual pass (if PO selects V3 typography).

### Open Product Owner decisions

| ID | Question |
|---|---|
| PO-V3-1 | Accept V3 as target shell for post-integration implementation? |
| PO-V3-2 | Inter Variable bundled vs Segoe-only on Windows? |
| PO-V3-3 | Inspector default tab (Plan vs Activity)? |
| PO-V3-4 | Workspace rail entry vs Cowork sub-mode? |
| PO-V3-5 | When to schedule production port relative to D4→D1 merge order? |

---

## Revision log

| Date | Change |
|---|---|
| 2026-07-13 | Initial V3 design prototype + spec on branch `design/ui-shell-v3-prototype` |
