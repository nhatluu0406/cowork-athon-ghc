---
name: cowork-ghc-commercial-ui
description: Design, implement, and review the Cowork GHC packaged Electron interface as a coherent commercial desktop product. Use for shell, Cowork chat, Workspace, Settings, Skills, provider profiles, permissions, Inspector, status, themes, icons, motion, and visual acceptance.
version: 2.0.0
user-invocable: false
---

# Cowork GHC Commercial UI

## Product standard

Cowork GHC must feel like one intentional Windows desktop product—not a collection of forms, test panels, and legacy CSS. The interface should communicate trust, calm, control, and speed before it communicates technical detail.

A successful pass must preserve working product behavior while improving clarity, consistency, and perceived quality. Never trade truthful runtime state, permission enforcement, credential safety, or file integrity for a prettier screenshot.

## Source of truth

Use, in order:

1. Current Git diff and active production source.
2. Canonical documents linked from `docs/README.md`.
3. Packaged Electron behavior on Windows.
4. Product Owner observations.
5. Focused tests and fresh evidence.

Automated tests support acceptance; they do not replace product observation.

## Visual DNA

- **Personality:** precise, calm, premium, local-first, trustworthy.
- **Primary accent:** Cowork orange. Use it for primary actions, focus, active navigation, and meaningful emphasis—not every border.
- **Surfaces:** layered neutral surfaces with subtle borders; avoid pure black/pure white blocks.
- **Density:** compact desktop productivity UI, not a spacious marketing website.
- **Shape language:** 10–16 px radii, with larger radii reserved for composer, dialogs, and hero empty states.
- **Typography:** strong hierarchy, comfortable line height, and readable Vietnamese. Avoid oversized page titles and repeated headings.
- **Motion:** 100–180 ms, restrained, purposeful, and disabled by `prefers-reduced-motion`.

## Theme tokens

All UI colors must use semantic tokens. Do not hardcode light-only or dark-only colors inside feature components.

Required semantic groups:

```text
canvas
surface-1 / surface-2 / surface-raised
text-primary / text-secondary / text-muted
border-subtle / border-strong
accent / accent-hover / accent-soft
success / warning / danger / info
focus-ring
shadow-sm / shadow-md / shadow-lg
```

Dark mode must not produce white cards with white text, beige scrollbars, or a light native titlebar. Light and dark themes must preserve the same hierarchy and interaction meaning.

## Application layout invariants

### Cowork

```text
product rail | conversation sidebar | conversation canvas | optional Inspector
```

- Inspector exists only when Cowork owns and opens it.
- Closing Inspector removes its grid column; hidden panels must not reserve space.
- Conversation header stays compact.
- Composer floats near the bottom of the usable conversation column.

### Workspace

```text
product rail | file tree | file editor/preview | optional Cowork companion panel
```

- Workspace does not inherit the Cowork Inspector column.
- File tree uses the remaining vertical space and owns its scrollbar.
- Editor/preview fills the canvas; never center a narrow editor inside a mostly empty page.
- Use an IDE-inspired file tree and tab/editor model without attempting to clone a full IDE.

### Settings

```text
product rail | settings navigation | settings content
```

- Settings is a product surface, not a giant modal.
- Use one page title only.
- Page body must not scroll when only a panel needs scrolling.
- Primary actions remain visible and grouped by intent.

### Integration surfaces

D1–D4 placeholders and future integrations use the full application surface. Their content is centered against the actual usable area, with no invisible Cowork sidebar or Inspector reservation.

## Component rules

### Product rail

- One consistent icon set.
- Icon-only controls require accessible tooltip and `aria-label`.
- No decorative notification dots unless they represent real state.
- Active state is visible without relying only on color.

### Buttons

- Use icon-only buttons for universally understood compact actions: back, refresh, open folder, settings, Inspector, save, rename, delete.
- Keep text for ambiguous or consequential actions: Add connection, Create Skill, Allow once, Deny.
- Avoid rows of five equally weighted buttons. Use one primary action and an overflow menu for secondary/destructive actions.

### Tooltips

- One tooltip owner only; remove native `title` when custom tooltip exists.
- Maximum width about 260 px.
- Must not be clipped by shell, sidebar, titlebar, or native control regions.
- Support hover and keyboard focus.
- Delay briefly; do not cover the control immediately.

### Composer

```text
[Attach] [Permission mode] [Skills] [Provider/model]                 [Send]
```

- Permission default is `Hỏi trước` unless the user explicitly persisted another valid choice.
- Anchored menus render in a portal/layer that cannot be clipped by the composer.
- Shortcut guidance aligns with the composer width or hides after first successful send.
- Composer must remain usable in light/dark themes and at 1366×768.

### Chat messages

- User message: content-sized bubble, natural wrapping, sane min/max width, 12–16 px padding.
- Assistant prose: readable transcript content; do not place all prose inside a giant card.
- Tool activity, permission, file review, and errors may use dedicated cards.
- Skill and attachment metadata belong in a compact metadata row, not inside the message text bubble.
- Never render internal context envelopes, runtime IDs, tool narration, or verification plumbing as user-facing prose.

### Permission

- Show action, target, concise reason, impact, and clear decision.
- Primary action: `Cho phép một lần`.
- Secondary action: `Từ chối`.
- Optional split-menu choices must be explicit and never silently selected.
- Prevent double submit and restore focus after resolution.
- Closing/backdrop/Escape must never approve.

### Provider profiles

- Default page shows saved connections and one `Thêm kết nối` action.
- Provider type selection appears inside the add flow, not permanently above saved profiles.
- Each saved profile shows friendly provider/model/state.
- Use overflow menu for edit, test, set active, and delete.
- `Chưa kiểm tra` is warning/neutral, never healthy green.
- Technical adapter IDs stay out of primary UI.

### Skills

- Settings section with search/filter, list, and editor/detail panel.
- Built-in Skills are clearly read-only.
- User Skills support create/edit/delete and enable/disable.
- Keep list/editor scroll ownership separate; avoid page-level and nested scrollbars.

### Workspace

- Compact header with workspace name, open-folder icon, and refresh icon.
- Dense file rows, extension-aware icons, clear selection, ellipsis for long names.
- Use editor tabs and dirty indicator when editing.
- No decorative grid behind content.
- Agent-driven file changes refresh the selected file when safe; dirty local edits require conflict notice rather than overwrite.

### Status bar

- Compact segmented status, about 24 px high.
- Workspace path is muted.
- Service ready is success.
- Runtime idle is neutral; running is active/info.
- Provider untested is warning; ready is success; failure is danger.
- Only clickable segments receive hover state.

## Icon system

Prefer one coherent line-icon family, for example Lucide-style geometry:

```text
Cowork: MessageCircle
Dispatch: Workflow
Gateway: Route
Knowledge: Library
Microsoft 365: Cloud
Code: Code2
Inspector: PanelRightOpen / PanelRightClose
Settings: Settings / SlidersHorizontal
Workspace: FolderOpen
Refresh: RotateCw
New chat: SquarePen
Save: Save
Rename: Pencil
Delete: Trash2
Info: Info
```

Do not substitute ambiguous icons such as lamps, generic squares, or unexplained dots.

## Interaction and motion

- Surface change: 140–180 ms fade/translate, no dramatic slide.
- Menu/tooltip: 100–140 ms.
- Inspector/drawer: about 180 ms.
- Hover movement: at most 1–2 px.
- Avoid animating editor layout, long lists, or status continuously.
- Respect `prefers-reduced-motion`.

## Accessibility

- Visible focus on every interactive element.
- `aria-label` for icon-only buttons.
- `aria-expanded` for menus, Inspector, and collapsible controls.
- Predictable tab order and focus restoration.
- Color is never the only state signal.
- Minimum comfortable pointer target about 32–36 px for compact desktop controls.
- Escape closes transient UI without losing data or granting permission.

## Implementation workflow

1. Confirm branch, HEAD, and clean working tree.
2. Reproduce the visible issue in the packaged app or production DOM.
3. Find the ownership problem: state, component, grid/flex, overflow, token, or stale CSS.
4. Fix the smallest shared primitive or layout invariant; do not stack another override blindly.
5. Run typecheck, focused tests, and relevant build.
6. Perform one packaged happy-path check for the changed surface.
7. Capture only the few states needed for Product Owner review.
8. Update canonical status/limitations when product truth changes.

## Evidence policy

Routine UI task:

```text
typecheck + focused tests + renderer/app build + one manual happy path
```

UI milestone:

```text
fresh packaged capture of core surfaces, light and dark, 1366×768 and primary desktop size
```

Do not create a screenshot matrix for every minor change. Generated evidence remains untracked unless it is the accepted baseline.

## Anti-patterns

- Adding a CSS override without removing or understanding the previous owner.
- Hidden columns reserving layout space.
- Page-level scroll plus panel-level scroll.
- Giant Settings headers and repeated titles.
- Technical tool/skill narration inside chat messages.
- Treating assistant prose as proof that a file action succeeded.
- Green color for untested provider state.
- Native `alert`, `confirm`, or `prompt` in production UI.
- Five equal buttons where one primary action plus overflow is clearer.
- Custom Windows minimize/maximize/close that breaks Snap Layout or DPI behavior.
- Faking D1–D4 data or capability for screenshots.
- Claiming commercial PASS from tests alone.

## Definition of done

- Happy-path behavior still works and reports truthful state.
- Light and dark themes are readable and consistent.
- No overlap, clipped tooltip, invisible reserved column, or unnecessary page scrollbar at 1366×768.
- Permission and destructive actions are clear and fail-safe.
- Cowork, Workspace, Settings, Skills, provider profiles, and integration surfaces share the same visual language.
- Focused tests/build pass, or remaining limitations are documented honestly.
- Product Owner can complete the intended flow without explanation of internal implementation details.
