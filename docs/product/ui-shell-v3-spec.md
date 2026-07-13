# Cowork GHC UI Shell V3 — Design Specification

**Status:** design prototype R1 — **not** implemented product capability.

**Prototype path:** `design/ui-shell-v3/` (`index.html`, `styles.css`, `prototype.js`)

**Production code:** unchanged (`app/ui/`, Electron shell, service/runtime).

---

## 1. Purpose

Refine V3 information architecture and responsive behavior while keeping the established neutral visual palette. R1 addresses Product Owner feedback before any production shell port.

Goals:

- **Contextual sidebar tabs** — Cowork and Workspace never shown together.
- **Document tab model** — files open as main tabs, not floating overlays.
- **Dedicated D1–D4 surfaces** — integration views replace entire main content.
- **Bottom status bar** — workspace, service, runtime, provider (no topbar pills).
- **900px drawer UX** — one overlay at a time, scrim, Escape, focus trap.

Implementation into `app/ui/` remains a **separate** decision after acceptance.

---

## 2. Layout architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Topbar (brand, context, icon actions, window controls)      │
├──┬──────────┬──────────────────────────────┬───────────────┤
│R │ Sidebar  │ Main workspace               │ Inspector     │
│a │ Cowork | │ (conversation / document /   │ (docked or    │
│i │ Workspace│  integration empty)          │  overlay)     │
│l │ tabs     │                              │               │
├──┴──────────┴──────────────────────────────┴───────────────┤
│ Status bar (workspace · service · runtime · provider)       │
└─────────────────────────────────────────────────────────────┘
```

| Region | Width | Collapse behavior |
|---|---|---|
| Product rail | 48–52px | Always visible |
| Context sidebar | ~280px | Cowork **or** Workspace tab; drawer overlay at ≤900px |
| Main | `minmax(680px, 1fr)` at 1366; flex at 900 | **Never collapses** |
| Inspector | 340–360px docked | Overlay at ≤1366px |
| Status bar | full width | Always visible |

---

## 3. Navigation model

### Product rail (icon-only)

| Surface | Production mapping | Prototype state |
|---|---|---|
| Cowork | `cowork` available | Active default; sidebar tabs inside |
| Dispatch | D1 `awaiting_integration` | Dedicated integration surface |
| Gateway | D4 `awaiting_integration` | Dedicated integration surface |
| Knowledge | D3 `awaiting_integration` | Dedicated integration surface |
| Knowledge Graph | D3 `awaiting_integration` | Full empty canvas |
| Microsoft 365 | D2 `awaiting_integration` | Dedicated integration surface |
| Code | `planned` | Dedicated integration surface |

**R1 change:** Workspace is **not** a separate rail entry. Workspace file tree lives in the **Workspace** sidebar tab when Cowork surface is active.

**Rules:**

- One Cowork icon only (no duplicate brand in rail + sidebar header).
- Tooltip + `aria-label` on every rail button.
- Awaiting surfaces show badge dot; tooltip includes `Chờ tích hợp D*`.

### Context sidebar tabs

| Tab | Content |
|---|---|
| **Cowork** | Conversation search, conversation list, icon-only New Conversation, three-dot actions |
| **Workspace** | Workspace identity, search/filter, recent/changed filters, refresh, full-height file tree |

Only one tab panel renders at a time. Conversation list and file tree are **never** stacked vertically.

---

## 4. Main workspace modes

### Cowork — conversation document

- Document tab: `[ Cuộc trò chuyện ]` (default).
- Conversation header (title 20–22px).
- Chat transcript (content max ~760–900px centered).
- Compact composer (icon attach + icon send).
- Optional banners: waiting permission, provider recovery (text CTA allowed).

### Cowork — file document

When user clicks a file in Workspace tab:

- Opens as a closable document tab, e.g. `[ Cuộc trò chuyện ] [ README.md × ]`.
- File tab shows: breadcrumb, metadata, read-only preview.
- Optional File Review in inspector (Review or Files tab).
- **When file tab is active:** composer hidden, transcript hidden, no floating file preview.

### D1–D4 / Code integration surfaces

Selecting Dispatch, Gateway, Knowledge, Knowledge Graph, Microsoft, or Code:

- Replaces **entire** main content area.
- No conversation header, provider banner, permission banner, composer, transcript, or file preview.
- No Cowork inspector File Review.
- Sidebar column hidden (`shell--integration`).

Unintegrated copy example:

```text
Gateway
Chờ tích hợp D4
```

No mock backend data. Knowledge Graph uses full empty canvas only.

---

## 5. Topbar

Minimal chrome:

- Compact product identity (mark + name).
- Document/conversation context when a file tab is active.
- Icon-only: sidebar toggle, inspector toggle, info, settings.
- Window controls (prototype decoration).

Service, provider, and runtime status **moved to bottom status bar**. No long center pills.

---

## 6. Bottom status bar

Compact persistent footer:

```text
Workspace: cowork-athon-ghc    Service ●    Runtime ○ Nhàn rỗi    DeepSeek ●
```

| Segment | States |
|---|---|
| Workspace | Active workspace name (tooltip with path) |
| Service | Ready / not ready |
| Runtime | Nhàn rỗi · Đang khởi động · Đang chạy · Chờ quyền · Lỗi |
| Provider | DeepSeek: Sẵn sàng · Chưa kiểm tra · Provider: Chưa cấu hình · Kết nối thất bại |

**Removed:** `OpenCode chỉ chạy khi bạn gửi yêu cầu` inline hint.

**Provider missing:** status bar amber + subtle pulse (respect `prefers-reduced-motion`); click opens settings. Main recovery banner only when recovery is truly needed.

Fixture states must be internally consistent — never show configured provider and “Chưa cấu hình” together.

---

## 7. Inspector

| Tab | Content rule |
|---|---|
| Plan | Ordered steps only |
| Activity | Short status lines |
| Files | Path list |
| Review | One review summary |

**Only the active tab renders** — no simultaneous empty cards.

Docked ≥1367px; overlay drawer ≤1366px. When a file document is selected, default to Files or Review as appropriate.

Icon-only open/close in topbar and inspector header.

---

## 8. Icon-only chrome

| Control | Icon | Tooltip + aria-label |
|---|---|---|
| New conversation | SquarePen | Required |
| Continue | PlayCircle | Required |
| Sidebar open/close | PanelLeftOpen / PanelLeftClose | Required |
| Inspector open/close | PanelRightOpen / PanelRightClose | Required |
| Settings | Settings | Required |
| Search, refresh, attach, send, menu | Matching icons | Required |

Text CTA reserved for: Allow/Deny permission, provider recovery, destructive confirmation, onboarding CTA.

---

## 9. Typography & visual language

Unchanged from V3 baseline:

- Segoe UI Variable / Inter Variable stack.
- Neutral white / light gray surfaces.
- Orange (`#e85d1a`) accent only.
- Light borders; drawer shadow only.
- 4/8px spacing scale.

---

## 10. Responsive breakpoints

| Viewport | Behavior |
|---|---|
| **1920** | Rail + sidebar + main + optional docked inspector |
| **1366** | Inspector → overlay; main `min-width` 680px |
| **900** | Rail remains; main fills width; sidebar and inspector are drawer overlays; **one drawer at a time**; scrim; Escape closes; focus trapped; no horizontal overflow; main width unchanged when drawer opens |

---

## 11. Prototype states

Query: `?state=<id>` or footer **Prototype states** panel.

| State ID | Demonstrates |
|---|---|
| `cowork-active` | Default conversation, DeepSeek configured |
| `sidebar-workspace` | Workspace sidebar tab |
| `file-document` | File document tab + inspector |
| `cowork-inspector-open` | Inspector visible |
| `gateway` | Gateway awaiting D4 (dedicated surface) |
| `knowledge-graph` | Knowledge Graph awaiting D3 (full canvas) |
| `narrow-900` | 900px layout (dev preview) |
| `provider-missing` | Provider not configured (consistent fixture) |
| `waiting-permission` | Permission banner with text CTA |

Fixture copy only — no FPT branding, no live provider.

---

## 12. Screenshots (R1)

Captured under `reports/ui-shell-v3-r1/`:

| File | State / size |
|---|---|
| `cowork-1920.png` | cowork-active · 1920×1080 |
| `cowork-1366.png` | cowork-active · 1366×768 |
| `cowork-900.png` | cowork-active · 900×768 |
| `sidebar-workspace.png` | sidebar-workspace · 1920×1080 |
| `file-document.png` | file-document · 1920×1080 |
| `inspector.png` | cowork-inspector-open · 1920×1080 |
| `gateway.png` | gateway · 1366×768 |
| `knowledge-graph.png` | knowledge-graph · 1366×768 |
| `provider-missing.png` | provider-missing · 1920×1080 |

Regenerate: `node design/ui-shell-v3/capture-screenshots.mjs`

---

## 13. Production mapping (for future implementation)

### Keep from current baseline

- Service/runtime boundaries, keyring, permissions, conversation store.
- Surface registry concept (`surface-registry.ts`, integration slots).
- File Review service path (behavior unchanged in V3 design).
- Packaged lifecycle scripts.

### Replace / rework in production shell (after PO acceptance)

- Dual sidebar + collapsed mini-columns layout.
- Workspace as separate rail entry (if PO accepts R1 IA).
- Text-heavy chrome buttons and giant orange CTA.
- Floating file preview over transcript.
- Cowork chrome bleeding into D1–D4 surfaces.
- Topbar status pills duplicating status bar.
- `OpenCode chỉ chạy khi bạn gửi yêu cầu` as primary runtime hint.

### Open Product Owner decisions

| ID | Question |
|---|---|
| PO-V3-1 | Accept V3 R1 as target shell for post-integration implementation? |
| PO-V3-2 | Inter Variable bundled vs Segoe-only on Windows? |
| PO-V3-3 | Inspector default tab when opening file (Files vs Review)? |
| PO-V3-4 | Confirm Workspace as sidebar tab only (no rail entry)? |
| PO-V3-5 | When to schedule production port relative to D4→D1 merge order? |

---

## Revision log

| Date | Change |
|---|---|
| 2026-07-13 | Initial V3 design prototype + spec on branch `design/ui-shell-v3-prototype` |
| 2026-07-13 | **R1:** sidebar tabs, document tabs, dedicated surfaces, status bar, topbar simplification, 900px drawers, fixture consistency, new screenshots |
