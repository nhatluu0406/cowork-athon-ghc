# Microsoft 365 & Claude Code Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two shell surfaces in `app/ui` per the approved spec `docs/superpowers/specs/2026-07-13-microsoft-claudecode-surfaces-design.md`: a Microsoft 365 surface rendered honestly in `disconnected` state (no mock data), and a Claude Code surface (3-column Explorer | Editor | Claude panel) wired to REAL data: workspace tree, read-only file preview, File Review diffs, and the existing Cowork conversation session.

**Architecture:** Plain-TypeScript DOM modules following the existing `app/ui/src/ui-shell/` pattern (`el`/`icon` helpers, `create*View()` + `render*()` functions, CSS files linked from `app/ui/index.html`). No framework. State stays in `app-shell.ts` (view-model) and is passed into pure render functions. All service data flows through the existing typed `ServiceClient`; no renderer filesystem access.

**Tech Stack:** TypeScript strict, happy-dom + `node --test` (via tsx) for unit tests, Vite renderer build.

## Global Constraints

- **No mock data.** Never render fabricated Microsoft/Graph/diff/session data. Empty states carry honest Vietnamese copy.
- **UI copy is Vietnamese**; identifiers/CSS classes/enum values are English.
- Production source files target **< 250 lines**; split if a file approaches 300.
- TypeScript **strict**; no `any`, no casts to hide errors; exhaustive `switch` on unions.
- UI never calls filesystem or credential store directly; only `ServiceClient`.
- No secrets in DOM/logs. File Review redaction messages pass through unchanged.
- Interactive controls need `aria-label` (or text content) and keyboard operability.
- Tests: `import "./setup-dom.js"` first, `node:test` + `node:assert/strict`, files in `app/ui/tests/`.
- Run single test file from `app/ui/`: `node --import tsx --test tests/<name>.test.ts`
- Commit after each task with a conventional message ending in the Claude co-author trailer.
- Working branch: create `feature/ms365-claudecode-surfaces` from `main` before Task 1.

---

### Task 1: Surface registry + product icons

**Files:**
- Modify: `app/ui/src/surface-registry.ts:91-100` (the `code` entry), `:89` (`microsoft` component)
- Modify: `app/ui/src/product-icons.ts` (icon union + `PATHS`)
- Test: `app/ui/tests/surface-registry.test.ts` (update), `app/ui/tests/product-icons.test.ts` (create)

**Interfaces:**
- Consumes: existing `ProductSurfaceDefinition`, `ProductIconName`.
- Produces: `code` surface `availability: "available"`, label `"Claude Code"`, component `"ClaudeCodeSurface"`; `microsoft` component `"MicrosoftSurfaceView"` (availability stays `"awaiting_integration"`). New icons: `"sparkle" | "shield" | "history" | "split" | "play" | "git-branch"`.

- [ ] **Step 1: Write failing tests**

Append to `app/ui/tests/surface-registry.test.ts`:

```ts
test("code surface is available as Claude Code", () => {
  const code = PRODUCT_SURFACES.find((s) => s.id === "code");
  assert.equal(code?.availability, "available");
  assert.equal(code?.label, "Claude Code");
  assert.equal(code?.component, "ClaudeCodeSurface");
});

test("microsoft surface keeps awaiting_integration with its own view component", () => {
  const ms = PRODUCT_SURFACES.find((s) => s.id === "microsoft");
  assert.equal(ms?.availability, "awaiting_integration");
  assert.equal(ms?.component, "MicrosoftSurfaceView");
});
```

Create `app/ui/tests/product-icons.test.ts`:

```ts
import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProductIcon } from "../src/product-icons.js";

test("new tool icons render as svg", () => {
  for (const name of ["sparkle", "shield", "history", "split", "play", "git-branch"] as const) {
    const svg = createProductIcon(name, name);
    assert.equal(svg.tagName.toLowerCase(), "svg");
    assert.ok(svg.querySelector("path"));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `app/ui/`): `node --import tsx --test tests/surface-registry.test.ts tests/product-icons.test.ts`
Expected: FAIL (availability is `"planned"`, icons not in union → TS error via tsx).

If `tests/surface-registry.test.ts` contains an existing assertion that `code` is `"planned"`, update that assertion to `"available"` as part of this step.

- [ ] **Step 3: Implement**

In `app/ui/src/surface-registry.ts` replace the `code` entry and `microsoft` component:

```ts
  {
    id: "microsoft",
    label: "Microsoft 365",
    icon: "microsoft",
    featureFlag: "d2.microsoft",
    requiredCapability: "microsoft_connector_backend",
    availability: "awaiting_integration",
    dependency: "D2",
    description: "Surface này đã sẵn sàng về giao diện và contract. Backend Microsoft 365 chưa được merge vào Cowork GHC.",
    component: "MicrosoftSurfaceView",
  },
  {
    id: "code",
    label: "Claude Code",
    icon: "code",
    featureFlag: "code.workspace",
    requiredCapability: "workspace_code_surface",
    availability: "available",
    description: "IDE surface: Explorer, xem diff chỉ đọc và panel Claude Code dùng chung phiên Cowork.",
    component: "ClaudeCodeSurface",
  },
```

In `app/ui/src/product-icons.ts` extend the union after `"collapse"`:

```ts
  | "sparkle"
  | "shield"
  | "history"
  | "split"
  | "play"
  | "git-branch";
```

and add to `PATHS`:

```ts
  sparkle: ["M12 4l1.8 4.6L18.5 10l-4.7 1.4L12 16l-1.8-4.6L5.5 10l4.7-1.4L12 4Z", "M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z"],
  shield: ["M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6l7-3Z", "M9.5 12l2 2 3.5-3.5"],
  history: ["M4 12a8 8 0 1 1 2.3 5.7", "M4 12H2.5M4 12l-1.5 3", "M12 8v4l3 2"],
  split: ["M5 5h6v14H5zM13 5h6v14h-6z"],
  play: ["M8 6l10 6-10 6V6Z"],
  "git-branch": ["M7 5a2 2 0 1 0 0 .1M7 19a2 2 0 1 0 0 .1M17 7a2 2 0 1 0 0 .1", "M7 7v10", "M17 9a6 6 0 0 1-6 6"],
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --import tsx --test tests/surface-registry.test.ts tests/product-icons.test.ts`
Expected: PASS. Also run `npm run typecheck` from repo root — PASS.

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/surface-registry.ts app/ui/src/product-icons.ts app/ui/tests/surface-registry.test.ts app/ui/tests/product-icons.test.ts
git commit -m "feat(ui): activate Claude Code surface and add surface icons"
```

---

### Task 2: Unified-diff parser (`parse-unified-diff.ts`)

**Files:**
- Create: `app/ui/src/ui-shell/code/parse-unified-diff.ts`
- Test: `app/ui/tests/parse-unified-diff.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `type DiffLineType = "ctx" | "add" | "del"`
  - `interface DiffLine { readonly type: DiffLineType; readonly oldN: number | null; readonly newN: number | null; readonly text: string }`
  - `function parseUnifiedDiff(unified: string): readonly DiffLine[]`
  - `function diffStats(unified: string | undefined): { readonly adds: number; readonly dels: number }`

- [ ] **Step 1: Write failing tests**

Create `app/ui/tests/parse-unified-diff.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, diffStats } from "../src/ui-shell/code/parse-unified-diff.js";

const SAMPLE = [
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export {};",
].join("\n");

test("parses hunks with old/new line numbers", () => {
  const lines = parseUnifiedDiff(SAMPLE);
  assert.deepEqual(lines[0], { type: "ctx", oldN: 1, newN: 1, text: "const a = 1;" });
  assert.deepEqual(lines[1], { type: "del", oldN: 2, newN: null, text: "const b = 2;" });
  assert.deepEqual(lines[2], { type: "add", oldN: null, newN: 2, text: "const b = 3;" });
  assert.deepEqual(lines[3], { type: "add", oldN: null, newN: 3, text: "const c = 4;" });
  assert.deepEqual(lines[4], { type: "ctx", oldN: 3, newN: 4, text: "export {};" });
});

test("ignores headers, handles multiple hunks and no-newline marker", () => {
  const multi = ["@@ -10,1 +10,1 @@", "-x", "+y", "\\ No newline at end of file", "@@ -20,1 +21,1 @@", " z"].join("\n");
  const lines = parseUnifiedDiff(multi);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[2], { type: "ctx", oldN: 20, newN: 21, text: "z" });
});

test("diffStats counts adds/dels and tolerates undefined", () => {
  assert.deepEqual(diffStats(SAMPLE), { adds: 2, dels: 1 });
  assert.deepEqual(diffStats(undefined), { adds: 0, dels: 0 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test tests/parse-unified-diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/ui/src/ui-shell/code/parse-unified-diff.ts`:

```ts
/**
 * Deterministic renderer-side parser for the service-produced unified diff
 * (FileReviewArtifact.unifiedDiff). Pure; no DOM, no service access.
 */

export type DiffLineType = "ctx" | "add" | "del";

export interface DiffLine {
  readonly type: DiffLineType;
  readonly oldN: number | null;
  readonly newN: number | null;
  readonly text: string;
}

export interface DiffStats {
  readonly adds: number;
  readonly dels: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(unified: string): readonly DiffLine[] {
  const out: DiffLine[] = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const raw of unified.split("\n")) {
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk !== null) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      out.push({ type: "add", oldN: null, newN: newN++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ type: "del", oldN: oldN++, newN: null, text: raw.slice(1) });
    } else {
      out.push({ type: "ctx", oldN: oldN++, newN: newN++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return out;
}

export function diffStats(unified: string | undefined): DiffStats {
  if (unified === undefined || unified.length === 0) return { adds: 0, dels: 0 };
  let adds = 0;
  let dels = 0;
  for (const line of parseUnifiedDiff(unified)) {
    if (line.type === "add") adds += 1;
    else if (line.type === "del") dels += 1;
  }
  return { adds, dels };
}
```

- [ ] **Step 4: Run tests → PASS**, then **Step 5: Commit**

```bash
git add app/ui/src/ui-shell/code/parse-unified-diff.ts app/ui/tests/parse-unified-diff.test.ts
git commit -m "feat(ui): add unified diff parser for code surface"
```

---

### Task 3: Microsoft 365 surface view

**Files:**
- Create: `app/ui/src/ui-shell/microsoft/ms-logo.ts`, `ms-connect-view.ts`, `ms-assistant-view.ts`, `microsoft-view.ts`, `microsoft.css`
- Modify: `app/ui/index.html` (add `<link rel="stylesheet" href="./src/ui-shell/microsoft/microsoft.css" />` after the `context-sidebar.css` link)
- Test: `app/ui/tests/microsoft-view.test.ts`

**Interfaces:**
- Consumes: `MicrosoftIntegrationView`, `MicrosoftConnectionState` from `../../integration-slots.js`; `el`, `icon` from `../dom-utils.js`.
- Produces:
  - `interface MicrosoftViewDom { readonly root: HTMLElement; readonly body: HTMLElement; readonly tabAssistant: HTMLButtonElement; readonly tabConnect: HTMLButtonElement; msTab: "assistant" | "connect" }`
  - `function createMicrosoftView(): MicrosoftViewDom` — root is `section.view.view--microsoft.ms-surface`, `hidden = true`, `dataset.view = "microsoft"`.
  - `function renderMicrosoftSurface(dom: MicrosoftViewDom, view: MicrosoftIntegrationView): void`
  - `function createMicrosoftLogo(size?: number): SVGSVGElement` (4 fill rects `#F25022 #7FBA00 #00A4EF #FFB900`)

- [ ] **Step 1: Write failing tests**

Create `app/ui/tests/microsoft-view.test.ts`:

```ts
import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MicrosoftIntegrationView } from "../src/integration-slots.js";
import { createMicrosoftView, renderMicrosoftSurface } from "../src/ui-shell/microsoft/microsoft-view.js";

const DISCONNECTED: MicrosoftIntegrationView = {
  connectionState: "disconnected",
  services: [],
  scopes: [],
  actionHistory: [],
};

test("assistant tab shows honest not-connected card and disabled composer", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  assert.equal(dom.msTab, "assistant");
  assert.match(dom.body.textContent ?? "", /Chưa kết nối Microsoft 365/);
  const composerInput = dom.body.querySelector<HTMLTextAreaElement>(".ms-composer__input");
  assert.equal(composerInput?.disabled, true);
  const send = dom.body.querySelector<HTMLButtonElement>(".ms-composer__send");
  assert.equal(send?.disabled, true);
});

test("connect tab shows disabled sign-in with D2 note and requested scopes", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  const signIn = dom.body.querySelector<HTMLButtonElement>(".ms-connect__signin");
  assert.equal(signIn?.disabled, true);
  assert.match(dom.body.textContent ?? "", /Backend D2 \(Microsoft Graph\) chưa được tích hợp/);
  assert.match(dom.body.textContent ?? "", /Mail\.Send/);
});

test("no fabricated account or service data is rendered when disconnected", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  dom.tabConnect.click();
  assert.doesNotMatch(dom.body.textContent ?? "", /Đã kết nối/);
  assert.equal(dom.body.querySelectorAll(".ms-service-card").length, 0);
});

test("'Mở trang kết nối' switches to connect tab", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  const cta = dom.body.querySelector<HTMLButtonElement>(".ms-assistant__connect-cta");
  cta?.click();
  assert.equal(dom.msTab, "connect");
});
```

- [ ] **Step 2: Run to verify failure** — `node --import tsx --test tests/microsoft-view.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement modules**

`app/ui/src/ui-shell/microsoft/ms-logo.ts`:

```ts
const SVG_NS = "http://www.w3.org/2000/svg";
const CELLS: readonly (readonly [string, number, number])[] = [
  ["#F25022", 0, 0],
  ["#7FBA00", 13, 0],
  ["#00A4EF", 0, 13],
  ["#FFB900", 13, 13],
];

/** Microsoft 4-square logo — the only fill-based icon (design handoff exception). */
export function createMicrosoftLogo(size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Microsoft");
  for (const [fill, x, y] of CELLS) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", "11");
    rect.setAttribute("height", "11");
    rect.setAttribute("fill", fill);
    svg.append(rect);
  }
  return svg;
}
```

`app/ui/src/ui-shell/microsoft/ms-connect-view.ts`:

```ts
import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";

/** Scopes the connector will request once D2 lands — capability description, not data. */
export const MS365_REQUESTED_SCOPES: readonly { readonly scope: string; readonly note: string }[] = [
  { scope: "User.Read", note: "Đọc hồ sơ người dùng cơ bản" },
  { scope: "Mail.ReadWrite", note: "Đọc và soạn thư Outlook" },
  { scope: "Mail.Send", note: "Gửi thư (luôn qua thẻ phê duyệt)" },
  { scope: "Calendars.ReadWrite", note: "Xem và tạo sự kiện lịch" },
  { scope: "Files.Read.All", note: "Đọc tệp OneDrive/SharePoint" },
  { scope: "Sites.Read.All", note: "Đọc site SharePoint" },
  { scope: "Tasks.ReadWrite", note: "Đọc và cập nhật task Planner" },
  { scope: "ChannelMessage.Send", note: "Đăng tin nhắn Teams (cần phê duyệt)" },
  { scope: "offline_access", note: "Duy trì kết nối giữa các phiên" },
];

export function renderMsConnect(container: HTMLElement, view: MicrosoftIntegrationView): void {
  container.replaceChildren();
  const wrap = el("div", "ms-connect");
  if (view.connectionState !== "connected") {
    wrap.append(renderSignInCard());
  } else {
    wrap.append(renderConnectedSummary(view));
  }
  container.append(wrap);
}

function renderSignInCard(): HTMLElement {
  const card = el("section", "ms-card ms-connect__signin-card");
  const logoWrap = el("div", "ms-connect__logo");
  logoWrap.append(createMicrosoftLogo(34));
  const signIn = el("button", "ms-connect__signin", "Đăng nhập với Microsoft") as HTMLButtonElement;
  signIn.type = "button";
  signIn.disabled = true;
  const note = el(
    "p",
    "ms-connect__note",
    "Backend D2 (Microsoft Graph) chưa được tích hợp. Nút đăng nhập sẽ được kích hoạt khi backend được merge.",
  );
  const scopeTitle = el("h3", "ms-section-label", "Quyền sẽ xin khi kết nối");
  const scopeList = el("ul", "ms-scope-list");
  for (const item of MS365_REQUESTED_SCOPES) {
    const li = el("li", "ms-scope-list__item");
    li.append(el("code", "ms-scope-list__scope", item.scope), el("span", "ms-scope-list__note", item.note));
    scopeList.append(li);
  }
  const oauthNote = el(
    "p",
    "ms-connect__oauth-note",
    "Đăng nhập dùng OAuth loopback; token được lưu trong Windows Credential Manager, không nằm trong trạng thái UI.",
  );
  card.append(logoWrap, el("h2", "ms-card__title", "Kết nối Microsoft 365"), signIn, note, scopeTitle, scopeList, oauthNote);
  return card;
}

function renderConnectedSummary(view: MicrosoftIntegrationView): HTMLElement {
  const card = el("section", "ms-card ms-connect__summary");
  card.append(el("h2", "ms-card__title", "Microsoft 365"), el("span", "ms-pill ms-pill--ok", "Đã kết nối"));
  const services = el("div", "ms-service-grid");
  for (const service of view.services) {
    const item = el("div", "ms-service-card");
    item.append(
      el("div", "ms-service-card__name", service.label),
      el("div", "ms-service-card__state", service.connected ? "Đang bật" : "Chờ quyền"),
    );
    services.append(item);
  }
  const scopeList = el("div", "ms-granted-scopes");
  for (const scope of view.scopes) scopeList.append(el("code", "ms-scope-pill", scope));
  card.append(el("h3", "ms-section-label", "Dịch vụ khả dụng"), services, el("h3", "ms-section-label", "Quyền đã cấp"), scopeList);
  return card;
}
```

`app/ui/src/ui-shell/microsoft/ms-assistant-view.ts`:

```ts
import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";

const SUGGESTIONS = [
  "Task trễ trên Planner",
  "Mail chưa đọc hôm nay",
  "Tìm tệp trên SharePoint",
  "Đăng thông báo lên Teams",
] as const;

export function renderMsAssistant(
  container: HTMLElement,
  view: MicrosoftIntegrationView,
  handlers: { readonly onOpenConnect: () => void },
): void {
  container.replaceChildren();
  const column = el("div", "ms-assistant");
  const transcript = el("div", "ms-assistant__transcript");
  if (view.connectionState !== "connected") {
    const card = el("section", "ms-card ms-assistant__empty");
    const logo = el("div", "ms-assistant__logo");
    logo.append(createMicrosoftLogo(30));
    const cta = el("button", "ms-assistant__connect-cta", "Mở trang kết nối") as HTMLButtonElement;
    cta.type = "button";
    cta.addEventListener("click", handlers.onOpenConnect);
    card.append(
      logo,
      el("h2", "ms-card__title", "Chưa kết nối Microsoft 365"),
      el("p", "ms-card__copy", "Kết nối tài khoản để trợ lý thao tác trên Outlook, Teams, SharePoint và Planner thay bạn."),
      cta,
    );
    transcript.append(card);
  }
  column.append(transcript, renderComposer(view.connectionState === "connected"));
  container.append(column);
}

function renderComposer(enabled: boolean): HTMLElement {
  const composer = el("div", "ms-composer");
  const chips = el("div", "ms-composer__chips");
  for (const suggestion of SUGGESTIONS) {
    const chip = el("button", "ms-composer__chip", suggestion) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled;
    chips.append(chip);
  }
  const inputRow = el("div", "ms-composer__row");
  const input = el("textarea", "ms-composer__input") as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder = "Hỏi trợ lý về Microsoft 365…";
  input.setAttribute("aria-label", "Soạn yêu cầu Microsoft 365");
  input.disabled = !enabled;
  const send = el("button", "ms-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.textContent = "➤";
  send.disabled = !enabled;
  inputRow.append(input, send);
  const hint = el(
    "p",
    "ms-composer__hint",
    "Hành động ghi (gửi mail, đăng Teams…) luôn cần phê duyệt trước khi thực thi qua Microsoft Graph.",
  );
  composer.append(chips, inputRow, hint);
  return composer;
}
```

`app/ui/src/ui-shell/microsoft/microsoft-view.ts`:

```ts
import type { MicrosoftIntegrationView } from "../../integration-slots.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import { renderMsAssistant } from "./ms-assistant-view.js";
import { renderMsConnect } from "./ms-connect-view.js";

export type MicrosoftTab = "assistant" | "connect";

export interface MicrosoftViewDom {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly tabAssistant: HTMLButtonElement;
  readonly tabConnect: HTMLButtonElement;
  msTab: MicrosoftTab;
  lastView: MicrosoftIntegrationView | null;
}

export function createMicrosoftView(): MicrosoftViewDom {
  const root = el("section", "view view--microsoft ms-surface");
  root.dataset["view"] = "microsoft";
  root.hidden = true;

  const header = el("header", "ms-surface__header");
  const titleWrap = el("div", "ms-surface__title-wrap");
  titleWrap.append(createMicrosoftLogo(22), el("h1", "ms-surface__title", "Microsoft 365"));
  const segmented = el("div", "ms-segmented");
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Chế độ Microsoft 365");
  const tabAssistant = segmentedButton("Trợ lý AI", true);
  const tabConnect = segmentedButton("Kết nối", false);
  segmented.append(tabAssistant, tabConnect);
  header.append(titleWrap, segmented);

  const body = el("div", "ms-surface__body");
  root.append(header, body);

  const dom: MicrosoftViewDom = { root, body, tabAssistant, tabConnect, msTab: "assistant", lastView: null };
  const select = (tab: MicrosoftTab): void => {
    dom.msTab = tab;
    if (dom.lastView !== null) renderMicrosoftSurfaceInternal(dom, dom.lastView);
  };
  tabAssistant.addEventListener("click", () => select("assistant"));
  tabConnect.addEventListener("click", () => select("connect"));
  for (const tab of [tabAssistant, tabConnect]) {
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const target = tab === tabAssistant ? tabConnect : tabAssistant;
      target.focus();
      target.click();
    });
  }
  return dom;
}

function segmentedButton(label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "ms-segmented__item", label) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", active ? "true" : "false");
  if (active) button.classList.add("ms-segmented__item--active");
  return button;
}

export function renderMicrosoftSurface(dom: MicrosoftViewDom, view: MicrosoftIntegrationView): void {
  dom.lastView = view;
  renderMicrosoftSurfaceInternal(dom, view);
}

function renderMicrosoftSurfaceInternal(dom: MicrosoftViewDom, view: MicrosoftIntegrationView): void {
  const assistantActive = dom.msTab === "assistant";
  dom.tabAssistant.classList.toggle("ms-segmented__item--active", assistantActive);
  dom.tabConnect.classList.toggle("ms-segmented__item--active", !assistantActive);
  dom.tabAssistant.setAttribute("aria-selected", assistantActive ? "true" : "false");
  dom.tabConnect.setAttribute("aria-selected", assistantActive ? "false" : "true");
  if (assistantActive) {
    renderMsAssistant(dom.body, view, {
      onOpenConnect: () => {
        dom.msTab = "connect";
        renderMicrosoftSurfaceInternal(dom, view);
      },
    });
  } else {
    renderMsConnect(dom.body, view);
  }
}
```

`app/ui/src/ui-shell/microsoft/microsoft.css` (tokens per handoff):

```css
.ms-surface { display: flex; flex-direction: column; background: #f7f8fa; overflow: hidden; }
.ms-surface__header { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; background: #fff; border-bottom: 1px solid #eceff3; }
.ms-surface__title-wrap { display: flex; align-items: center; gap: 10px; }
.ms-surface__title { font-size: 20px; font-weight: 600; color: #1a2332; margin: 0; }
.ms-segmented { display: flex; background: #f1f3f6; border-radius: 10px; padding: 3px; gap: 2px; }
.ms-segmented__item { border: 0; background: transparent; border-radius: 8px; padding: 6px 14px; font-size: 13px; color: #4b5565; cursor: pointer; }
.ms-segmented__item--active { background: #fff; color: #1a2332; box-shadow: 0 1px 2px rgba(16,24,40,.06); }
.ms-surface__body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.ms-card { background: #fff; border: 1px solid #e2e6ec; border-radius: 14px; box-shadow: 0 1px 2px rgba(16,24,40,.06); padding: 24px; }
.ms-card__title { font-size: 17px; font-weight: 600; color: #1a2332; margin: 10px 0 6px; }
.ms-card__copy { font-size: 14px; line-height: 1.6; color: #4b5565; margin: 0 0 14px; }
.ms-assistant { display: flex; flex-direction: column; flex: 1; max-width: 840px; width: 100%; margin: 0 auto; padding: 24px 16px 0; }
.ms-assistant__transcript { flex: 1; display: flex; align-items: center; justify-content: center; }
.ms-assistant__empty { text-align: center; max-width: 420px; }
.ms-assistant__connect-cta { background: #e85d1a; color: #fff; border: 0; border-radius: 10px; padding: 9px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
.ms-assistant__connect-cta:hover { background: #d1500f; }
.ms-composer { padding: 16px 0 20px; background: linear-gradient(transparent, #f7f8fa 30%); }
.ms-composer__chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ms-composer__chip { border: 1px solid #e2e6ec; background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #4b5565; cursor: pointer; }
.ms-composer__chip:not(:disabled):hover { border-color: #f0c9ad; color: #e85d1a; background: #fff3eb; }
.ms-composer__chip:disabled, .ms-composer__input:disabled, .ms-composer__send:disabled { opacity: .55; cursor: not-allowed; }
.ms-composer__row { display: flex; gap: 8px; align-items: flex-end; }
.ms-composer__input { flex: 1; border: 1px solid #e2e6ec; border-radius: 14px; padding: 10px 14px; font: inherit; font-size: 14px; resize: none; background: #fff; }
.ms-composer__send { width: 34px; height: 34px; border-radius: 10px; border: 0; background: #e85d1a; color: #fff; cursor: pointer; }
.ms-composer__hint { text-align: center; font-size: 11px; color: #9aa4b2; margin: 10px 0 0; }
.ms-connect { max-width: 1080px; width: 100%; margin: 0 auto; padding: 24px 16px; }
.ms-connect__signin-card { max-width: 460px; margin: 40px auto; text-align: center; }
.ms-connect__signin { background: #1a2332; color: #fff; border: 0; border-radius: 10px; padding: 10px 18px; font-size: 14px; font-weight: 600; }
.ms-connect__note { font-size: 12px; color: #b45309; background: #fff4e5; border-radius: 8px; padding: 8px 10px; margin: 12px 0; }
.ms-section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #6b7585; margin: 18px 0 8px; text-align: left; }
.ms-scope-list { list-style: none; margin: 0; padding: 0; text-align: left; }
.ms-scope-list__item { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid #eceff3; align-items: baseline; }
.ms-scope-list__scope { font-family: "Cascadia Code", ui-monospace, Consolas, monospace; font-size: 12.5px; color: #1a2332; }
.ms-scope-list__note { font-size: 12px; color: #6b7585; }
.ms-connect__oauth-note { font-size: 11px; color: #9aa4b2; margin-top: 14px; }
.ms-pill { border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
.ms-pill--ok { background: #eafaf0; color: #1f8f55; }
.ms-service-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 12px; }
.ms-service-card { border: 1px solid #eceff3; border-radius: 10px; padding: 12px; }
.ms-service-card__name { font-size: 13px; font-weight: 600; color: #1a2332; }
.ms-service-card__state { font-size: 12px; color: #6b7585; }
.ms-granted-scopes { display: flex; flex-wrap: wrap; gap: 6px; }
.ms-scope-pill { font-family: "Cascadia Code", ui-monospace, Consolas, monospace; font-size: 12px; background: #f1f3f6; border-radius: 999px; padding: 3px 10px; color: #1a2332; }
```

Add to `app/ui/index.html` after line 19:

```html
    <link rel="stylesheet" href="./src/ui-shell/microsoft/microsoft.css" />
```

- [ ] **Step 4: Run tests → PASS** (`node --import tsx --test tests/microsoft-view.test.ts`), `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/ui/src/ui-shell/microsoft app/ui/index.html app/ui/tests/microsoft-view.test.ts
git commit -m "feat(ui): Microsoft 365 surface with honest disconnected state"
```

---

### Task 4: Code editor column (`code-editor.ts`)

**Files:**
- Create: `app/ui/src/ui-shell/code/code-editor.ts`
- Test: `app/ui/tests/code-editor.test.ts`

**Interfaces:**
- Consumes: `parseUnifiedDiff`, `diffStats` (Task 2); `FileReviewArtifact` type from `@cowork-ghc/service/file-review`; `el`, `icon` from `../dom-utils.js`.
- Produces:
  - `type ChangeBadge = "A" | "M" | "D"`
  - `function badgeForReview(review: Pick<FileReviewArtifact, "eventKind">): ChangeBadge` — `file_created → "A"`, `file_deleted → "D"`, else `"M"`.
  - `interface OpenCodeFile { readonly key: string; readonly relativePath: string; readonly kind: "file" | "review"; readonly reviewId?: string }`
  - `function fileTabKey(kind: "file" | "review", relativePath: string): string` — returns `` `${kind}:${relativePath}` ``.
  - `interface CodeEditorDom { readonly root: HTMLElement; readonly tabBar: HTMLElement; readonly body: HTMLElement }`
  - `function createCodeEditor(): CodeEditorDom`
  - `interface CodeEditorHandlers { readonly onSelect: (key: string) => void; readonly onClose: (key: string) => void; readonly onLoadFile: (relativePath: string, body: HTMLElement) => void }`
  - `function renderCodeEditor(dom: CodeEditorDom, state: { readonly openFiles: readonly OpenCodeFile[]; readonly activeKey: string | null; readonly reviews: readonly FileReviewArtifact[] }, handlers: CodeEditorHandlers): void`

Behavior: no active file → welcome screen (`icon("code")`, "Chưa mở tệp nào", hướng dẫn). Active `review` → toolbar (breadcrumb mono + `+a −d`) + 3-column diff grid from `parseUnifiedDiff(review.unifiedDiff ?? "")`; `contentRedacted` → render only the redaction notice `"Nội dung bị ẩn vì file có thể chứa credential hoặc secret."`; `isBinary` → metadata-only line "Tệp nhị phân — chỉ có metadata."; deleted (`afterExists === false`) shows pill "Đã xoá". Active `file` → toolbar (breadcrumb + pill "Chỉ đọc") + `<pre class="code-editor__plain">`; content is loaded by the host via `onLoadFile(relativePath, bodyEl)` (async service preview stays in app-shell).

- [ ] **Step 1: Write failing tests**

Create `app/ui/tests/code-editor.test.ts`:

```ts
import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import {
  badgeForReview,
  createCodeEditor,
  fileTabKey,
  renderCodeEditor,
  type OpenCodeFile,
} from "../src/ui-shell/code/code-editor.js";

const REVIEW: FileReviewArtifact = {
  id: "review-1",
  eventKind: "file_modified",
  relativePath: "src/app.ts",
  at: "2026-07-13T00:00:00.000Z",
  seq: 1,
  source: "runtime",
  beforeExists: true,
  afterExists: true,
  unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+new",
  truncated: false,
  diffTruncated: false,
  previewTruncated: false,
  isBinary: false,
  contentRedacted: false,
} as FileReviewArtifact;

const NO_HANDLERS = { onSelect: () => undefined, onClose: () => undefined, onLoadFile: () => undefined };

test("badge mapping", () => {
  assert.equal(badgeForReview({ eventKind: "file_created" }), "A");
  assert.equal(badgeForReview({ eventKind: "file_deleted" }), "D");
  assert.equal(badgeForReview({ eventKind: "file_modified" }), "M");
});

test("welcome screen when nothing open", () => {
  const dom = createCodeEditor();
  renderCodeEditor(dom, { openFiles: [], activeKey: null, reviews: [] }, NO_HANDLERS);
  assert.match(dom.body.textContent ?? "", /Chưa mở tệp nào/);
});

test("diff tab renders add/del rows and stats", () => {
  const dom = createCodeEditor();
  const open: OpenCodeFile = { key: fileTabKey("review", "src/app.ts"), relativePath: "src/app.ts", kind: "review", reviewId: "review-1" };
  renderCodeEditor(dom, { openFiles: [open], activeKey: open.key, reviews: [REVIEW] }, NO_HANDLERS);
  assert.equal(dom.body.querySelectorAll(".code-diff__row--add").length, 1);
  assert.equal(dom.body.querySelectorAll(".code-diff__row--del").length, 1);
  assert.match(dom.root.textContent ?? "", /\+1/);
  assert.equal(dom.root.querySelector(".code-editor__accept"), null); // no fake accept/reject
});

test("redacted review shows notice and no diff content", () => {
  const dom = createCodeEditor();
  const redacted = { ...REVIEW, id: "review-2", contentRedacted: true, relativePath: ".env" } as FileReviewArtifact;
  const open: OpenCodeFile = { key: fileTabKey("review", ".env"), relativePath: ".env", kind: "review", reviewId: "review-2" };
  renderCodeEditor(dom, { openFiles: [open], activeKey: open.key, reviews: [redacted] }, NO_HANDLERS);
  assert.match(dom.body.textContent ?? "", /credential hoặc secret/);
  assert.equal(dom.body.querySelectorAll(".code-diff__row").length, 0);
});

test("plain file tab shows read-only pill and close fires handler", () => {
  const dom = createCodeEditor();
  let closed: string | null = null;
  const open: OpenCodeFile = { key: fileTabKey("file", "README.md"), relativePath: "README.md", kind: "file" };
  renderCodeEditor(
    dom,
    { openFiles: [open], activeKey: open.key, reviews: [] },
    { ...NO_HANDLERS, onClose: (key) => { closed = key; } },
  );
  assert.match(dom.root.textContent ?? "", /Chỉ đọc/);
  dom.tabBar.querySelector<HTMLButtonElement>(".code-tab__close")?.click();
  assert.equal(closed, open.key);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement** `app/ui/src/ui-shell/code/code-editor.ts`:

```ts
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { el, icon } from "../dom-utils.js";
import { diffStats, parseUnifiedDiff } from "./parse-unified-diff.js";

export type ChangeBadge = "A" | "M" | "D";

export function badgeForReview(review: Pick<FileReviewArtifact, "eventKind">): ChangeBadge {
  if (review.eventKind === "file_created") return "A";
  if (review.eventKind === "file_deleted") return "D";
  return "M";
}

export interface OpenCodeFile {
  readonly key: string;
  readonly relativePath: string;
  readonly kind: "file" | "review";
  readonly reviewId?: string;
}

export function fileTabKey(kind: "file" | "review", relativePath: string): string {
  return `${kind}:${relativePath}`;
}

export interface CodeEditorDom {
  readonly root: HTMLElement;
  readonly tabBar: HTMLElement;
  readonly body: HTMLElement;
}

export interface CodeEditorHandlers {
  readonly onSelect: (key: string) => void;
  readonly onClose: (key: string) => void;
  readonly onLoadFile: (relativePath: string, body: HTMLElement) => void;
}

export function createCodeEditor(): CodeEditorDom {
  const root = el("div", "code-editor");
  const tabBar = el("div", "code-editor__tabs");
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Tệp đang mở");
  const body = el("div", "code-editor__body");
  root.append(tabBar, body);
  return { root, tabBar, body };
}

export function renderCodeEditor(
  dom: CodeEditorDom,
  state: {
    readonly openFiles: readonly OpenCodeFile[];
    readonly activeKey: string | null;
    readonly reviews: readonly FileReviewArtifact[];
  },
  handlers: CodeEditorHandlers,
): void {
  renderTabs(dom.tabBar, state, handlers);
  dom.body.replaceChildren();
  const active = state.openFiles.find((file) => file.key === state.activeKey) ?? null;
  if (active === null) {
    dom.body.append(renderWelcome());
    return;
  }
  if (active.kind === "review") {
    const review = state.reviews.find((r) => r.id === active.reviewId) ?? null;
    dom.body.append(review === null ? renderMissingReview() : renderDiff(review));
    return;
  }
  dom.body.append(renderPlainToolbar(active));
  const pre = el("pre", "code-editor__plain", "Đang tải xem trước...");
  dom.body.append(pre);
  handlers.onLoadFile(active.relativePath, pre);
}

function renderTabs(
  tabBar: HTMLElement,
  state: Parameters<typeof renderCodeEditor>[1],
  handlers: CodeEditorHandlers,
): void {
  tabBar.replaceChildren();
  for (const file of state.openFiles) {
    const tab = el("div", "code-tab");
    tab.classList.toggle("code-tab--active", file.key === state.activeKey);
    const select = el("button", "code-tab__select") as HTMLButtonElement;
    select.type = "button";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", file.key === state.activeKey ? "true" : "false");
    if (file.kind === "review") {
      const review = state.reviews.find((r) => r.id === file.reviewId);
      if (review !== undefined) {
        const badge = badgeForReview(review);
        select.append(el("span", `code-badge code-badge--${badge.toLowerCase()}`, badge));
      }
    }
    select.append(el("span", "code-tab__name", fileName(file.relativePath)));
    select.title = file.relativePath;
    select.addEventListener("click", () => handlers.onSelect(file.key));
    const close = el("button", "code-tab__close", "×") as HTMLButtonElement;
    close.type = "button";
    close.setAttribute("aria-label", `Đóng ${fileName(file.relativePath)}`);
    close.addEventListener("click", () => handlers.onClose(file.key));
    tab.append(select, close);
    tabBar.append(tab);
  }
}

function fileName(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? relativePath;
}

function renderWelcome(): HTMLElement {
  const wrap = el("div", "code-editor__welcome");
  const iconWrap = el("div", "code-editor__welcome-icon");
  iconWrap.append(icon("code", "Claude Code"));
  wrap.append(
    iconWrap,
    el("h2", "code-editor__welcome-title", "Chưa mở tệp nào"),
    el("p", "code-editor__welcome-copy", "Chọn tệp trong Explorer để xem nội dung (chỉ đọc), hoặc mở một thay đổi trong SOURCE CONTROL để xem diff."),
  );
  return wrap;
}

function renderMissingReview(): HTMLElement {
  return el("p", "code-editor__notice", "Không tìm thấy dữ liệu review cho tệp này trong cuộc trò chuyện hiện tại.");
}

function renderPlainToolbar(file: OpenCodeFile): HTMLElement {
  const toolbar = el("div", "code-editor__toolbar");
  toolbar.append(el("span", "code-editor__breadcrumb", file.relativePath), el("span", "code-pill", "Chỉ đọc"));
  return toolbar;
}

function renderDiff(review: FileReviewArtifact): HTMLElement {
  const wrap = el("div", "code-diff");
  const toolbar = el("div", "code-editor__toolbar");
  const stats = diffStats(review.unifiedDiff);
  toolbar.append(el("span", "code-editor__breadcrumb", review.relativePath));
  toolbar.append(el("span", "code-diff__adds", `+${stats.adds}`), el("span", "code-diff__dels", `−${stats.dels}`));
  if (review.afterExists === false) toolbar.append(el("span", "code-pill code-pill--deleted", "Đã xoá"));
  if (review.diffTruncated) toolbar.append(el("span", "code-pill", "Diff đã cắt bớt"));
  wrap.append(toolbar);
  if (review.contentRedacted) {
    wrap.append(el("p", "code-editor__notice", "Nội dung bị ẩn vì file có thể chứa credential hoặc secret."));
    return wrap;
  }
  if (review.isBinary) {
    wrap.append(el("p", "code-editor__notice", "Tệp nhị phân — chỉ có metadata, không có diff nội dung."));
    return wrap;
  }
  const grid = el("div", "code-diff__grid");
  for (const line of parseUnifiedDiff(review.unifiedDiff ?? "")) {
    const row = el("div", `code-diff__row code-diff__row--${line.type}`);
    row.append(
      el("span", "code-diff__gutter", line.oldN === null ? "" : String(line.oldN)),
      el("span", "code-diff__gutter", line.newN === null ? "" : String(line.newN)),
      el("code", "code-diff__text", line.text),
    );
    grid.append(row);
  }
  wrap.append(grid);
  return wrap;
}
```

- [ ] **Step 4: Run tests → PASS**, `npm run typecheck` → PASS.
- [ ] **Step 5: Commit**

```bash
git add app/ui/src/ui-shell/code/code-editor.ts app/ui/tests/code-editor.test.ts
git commit -m "feat(ui): read-only code editor with review diff view"
```

---

### Task 5: Explorer column (`code-explorer.ts`)

**Files:**
- Create: `app/ui/src/ui-shell/code/code-explorer.ts`
- Test: `app/ui/tests/code-explorer.test.ts`

**Interfaces:**
- Consumes: `FileReviewArtifact`, `badgeForReview`, `diffStats`, `el`, `icon`.
- Produces:
  - `interface CodeExplorerDom { readonly root: HTMLElement; readonly sourceControl: HTMLElement; readonly treeSlot: HTMLElement; readonly collapseButton: HTMLButtonElement }`
  - `function createCodeExplorer(): CodeExplorerDom` — header "EXPLORER" + collapse button; section label "SOURCE CONTROL" + badge count + list; `treeSlot` (host mounts `mountWorkspaceNavigator` into it).
  - `function latestReviewsByPath(reviews: readonly FileReviewArtifact[]): readonly FileReviewArtifact[]` — one review per `relativePath`, highest `seq` wins, sorted by path.
  - `function renderSourceControl(dom: CodeExplorerDom, reviews: readonly FileReviewArtifact[], onOpenReview: (review: FileReviewArtifact) => void): void` — empty → honest copy "Chưa có thay đổi tệp nào trong cuộc trò chuyện này."

- [ ] **Step 1: Write failing tests**

Create `app/ui/tests/code-explorer.test.ts`:

```ts
import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { createCodeExplorer, latestReviewsByPath, renderSourceControl } from "../src/ui-shell/code/code-explorer.js";

function review(partial: Partial<FileReviewArtifact>): FileReviewArtifact {
  return {
    id: "r", eventKind: "file_modified", relativePath: "a.ts", at: "2026-07-13T00:00:00.000Z",
    seq: 1, source: "runtime", beforeExists: true, afterExists: true,
    truncated: false, diffTruncated: false, previewTruncated: false, isBinary: false, contentRedacted: false,
    ...partial,
  } as FileReviewArtifact;
}

test("latestReviewsByPath keeps highest seq per path", () => {
  const rows = latestReviewsByPath([
    review({ id: "r1", relativePath: "a.ts", seq: 1 }),
    review({ id: "r2", relativePath: "a.ts", seq: 3 }),
    review({ id: "r3", relativePath: "b.ts", seq: 2 }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["r2", "r3"]);
});

test("empty source control is honest", () => {
  const dom = createCodeExplorer();
  renderSourceControl(dom, [], () => undefined);
  assert.match(dom.sourceControl.textContent ?? "", /Chưa có thay đổi tệp nào/);
});

test("rows show badge and stats, click opens review", () => {
  const dom = createCodeExplorer();
  let opened: string | null = null;
  const r = review({ id: "r9", eventKind: "file_created", relativePath: "src/new.ts", unifiedDiff: "@@ -0,0 +1,2 @@\n+a\n+b" });
  renderSourceControl(dom, [r], (rev) => { opened = rev.id; });
  const row = dom.sourceControl.querySelector<HTMLButtonElement>(".code-scm__row");
  assert.match(row?.textContent ?? "", /A/);
  assert.match(row?.textContent ?? "", /\+2/);
  row?.click();
  assert.equal(opened, "r9");
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `app/ui/src/ui-shell/code/code-explorer.ts`:

```ts
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { el, icon } from "../dom-utils.js";
import { badgeForReview } from "./code-editor.js";
import { diffStats } from "./parse-unified-diff.js";

export interface CodeExplorerDom {
  readonly root: HTMLElement;
  readonly sourceControl: HTMLElement;
  readonly treeSlot: HTMLElement;
  readonly collapseButton: HTMLButtonElement;
}

export function createCodeExplorer(): CodeExplorerDom {
  const root = el("aside", "code-explorer");
  root.setAttribute("aria-label", "Explorer");
  const header = el("div", "code-explorer__header");
  header.append(el("span", "code-explorer__title", "EXPLORER"));
  const collapseButton = el("button", "code-explorer__collapse") as HTMLButtonElement;
  collapseButton.type = "button";
  collapseButton.title = "Thu gọn Explorer";
  collapseButton.setAttribute("aria-label", "Thu gọn Explorer");
  collapseButton.append(icon("collapse", "Thu gọn Explorer"));
  header.append(collapseButton);

  const scmSection = el("section", "code-explorer__section");
  scmSection.append(el("h3", "code-explorer__label", "SOURCE CONTROL"));
  const sourceControl = el("div", "code-scm");
  scmSection.append(sourceControl);

  const treeSection = el("section", "code-explorer__section code-explorer__section--tree");
  const treeSlot = el("div", "code-explorer__tree");
  treeSection.append(treeSlot);

  root.append(header, scmSection, treeSection);
  return { root, sourceControl, treeSlot, collapseButton };
}

export function latestReviewsByPath(reviews: readonly FileReviewArtifact[]): readonly FileReviewArtifact[] {
  const byPath = new Map<string, FileReviewArtifact>();
  for (const review of reviews) {
    const existing = byPath.get(review.relativePath);
    if (existing === undefined || review.seq > existing.seq) byPath.set(review.relativePath, review);
  }
  return [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function renderSourceControl(
  dom: CodeExplorerDom,
  reviews: readonly FileReviewArtifact[],
  onOpenReview: (review: FileReviewArtifact) => void,
): void {
  dom.sourceControl.replaceChildren();
  const rows = latestReviewsByPath(reviews);
  if (rows.length === 0) {
    dom.sourceControl.append(el("p", "code-scm__empty", "Chưa có thay đổi tệp nào trong cuộc trò chuyện này."));
    return;
  }
  for (const review of rows) {
    const row = el("button", "code-scm__row") as HTMLButtonElement;
    row.type = "button";
    row.title = review.relativePath;
    const badge = badgeForReview(review);
    const stats = diffStats(review.unifiedDiff);
    row.append(
      el("span", `code-badge code-badge--${badge.toLowerCase()}`, badge),
      el("span", "code-scm__name", baseName(review.relativePath)),
      el("span", "code-scm__dir", dirName(review.relativePath)),
      el("span", "code-scm__stats", `+${stats.adds} −${stats.dels}`),
    );
    row.addEventListener("click", () => onOpenReview(review));
    dom.sourceControl.append(row);
  }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dirName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).join("/");
}
```

- [ ] **Step 4: Run tests → PASS.** **Step 5: Commit**

```bash
git add app/ui/src/ui-shell/code/code-explorer.ts app/ui/tests/code-explorer.test.ts
git commit -m "feat(ui): code explorer with real source-control rows"
```

---

### Task 6: Claude panel + onboarding

**Files:**
- Create: `app/ui/src/ui-shell/code/claude-panel.ts`, `app/ui/src/ui-shell/code/code-onboarding.ts`
- Test: `app/ui/tests/claude-panel.test.ts`

**Interfaces:**
- Consumes: `ConversationMessage` from `../../service-client.js`; `RuntimePhase` from `../../conversation-controller.js`; `el`, `icon`.
- Produces:
  - `interface ClaudePanelDom { readonly root: HTMLElement; readonly title: HTMLElement; readonly transcript: HTMLElement; readonly streaming: HTMLElement; readonly input: HTMLTextAreaElement; readonly send: HTMLButtonElement }`
  - `function createClaudePanel(handlers: { readonly onSend: (text: string) => void }): ClaudePanelDom` — header tab "CLAUDE CODE", session subheader (sparkle icon + title), transcript, streaming block (hidden), composer with suggestion chips ("Chạy test", "Commit thay đổi", "Giải thích diff", "Sửa lỗi lint") that only fill the textarea; Enter sends, Shift+Enter newline.
  - `function renderClaudePanel(dom: ClaudePanelDom, input: { readonly title: string | null; readonly messages: readonly ConversationMessage[]; readonly phase: RuntimePhase; readonly disabled: boolean; readonly disabledReason: string | null }): void`
  - `function setClaudePanelStreaming(dom: ClaudePanelDom, text: string, active: boolean): void`
  - `function createCodeOnboarding(onStart: () => void): HTMLElement` — 4 numbered steps (Phiên chạy cục bộ / Ranh giới thực thi / Xem lại diff / Provider trung lập), button "Bắt đầu phiên làm việc", architecture chip row `UI ⇄ Local service ⇄ OpenCode runtime ⇄ LLM endpoint`.

- [ ] **Step 1: Write failing tests**

Create `app/ui/tests/claude-panel.test.ts`:

```ts
import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConversationMessage } from "../src/service-client.js";
import { createClaudePanel, renderClaudePanel, setClaudePanelStreaming } from "../src/ui-shell/code/claude-panel.js";
import { createCodeOnboarding } from "../src/ui-shell/code/code-onboarding.js";

const MSGS: ConversationMessage[] = [
  { id: "m1", role: "user", text: "Chạy test", at: "2026-07-13T00:00:00.000Z" },
  { id: "m2", role: "assistant", text: "Đã chạy xong.", at: "2026-07-13T00:00:01.000Z" },
];

test("renders messages from the shared conversation record", () => {
  const dom = createClaudePanel({ onSend: () => undefined });
  renderClaudePanel(dom, { title: "Phiên A", messages: MSGS, phase: "completed", disabled: false, disabledReason: null });
  assert.equal(dom.transcript.querySelectorAll(".cc-msg--user").length, 1);
  assert.equal(dom.transcript.querySelectorAll(".cc-msg--assistant").length, 1);
  assert.match(dom.title.textContent ?? "", /Phiên A/);
});

test("Enter sends, Shift+Enter does not; empty text never sends", () => {
  let sent: string | null = null;
  const dom = createClaudePanel({ onSend: (text) => { sent = text; } });
  renderClaudePanel(dom, { title: null, messages: [], phase: "idle", disabled: false, disabledReason: null });
  dom.input.value = "";
  dom.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(sent, null);
  dom.input.value = "xin chào";
  dom.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(sent, null);
  dom.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(sent, "xin chào");
});

test("disabled panel blocks send and shows reason", () => {
  let sent = 0;
  const dom = createClaudePanel({ onSend: () => { sent += 1; } });
  renderClaudePanel(dom, { title: null, messages: [], phase: "idle", disabled: true, disabledReason: "Cấu hình provider trong Cài đặt trước." });
  assert.equal(dom.input.disabled, true);
  assert.equal(dom.send.disabled, true);
  assert.match(dom.root.textContent ?? "", /Cấu hình provider/);
  dom.send.click();
  assert.equal(sent, 0);
});

test("streaming block toggles", () => {
  const dom = createClaudePanel({ onSend: () => undefined });
  setClaudePanelStreaming(dom, "đang gõ…", true);
  assert.equal(dom.streaming.hidden, false);
  assert.match(dom.streaming.textContent ?? "", /đang gõ/);
  setClaudePanelStreaming(dom, "", false);
  assert.equal(dom.streaming.hidden, true);
});

test("onboarding renders 4 steps and start button", () => {
  let started = false;
  const node = createCodeOnboarding(() => { started = true; });
  assert.equal(node.querySelectorAll(".cc-onboarding__step").length, 4);
  node.querySelector<HTMLButtonElement>(".cc-onboarding__start")?.click();
  assert.equal(started, true);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`app/ui/src/ui-shell/code/claude-panel.ts`:

```ts
import type { RuntimePhase } from "../../conversation-controller.js";
import type { ConversationMessage } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";

const SUGGESTIONS = ["Chạy test", "Commit thay đổi", "Giải thích diff", "Sửa lỗi lint"] as const;

export interface ClaudePanelDom {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly transcript: HTMLElement;
  readonly streaming: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly send: HTMLButtonElement;
}

export function createClaudePanel(handlers: { readonly onSend: (text: string) => void }): ClaudePanelDom {
  const root = el("aside", "cc-panel");
  root.setAttribute("aria-label", "Panel Claude Code");

  const tabBar = el("div", "cc-panel__tabbar");
  tabBar.append(el("span", "cc-panel__tab", "CLAUDE CODE"));

  const subheader = el("div", "cc-panel__session");
  const chip = el("span", "cc-panel__spark");
  chip.append(icon("sparkle", "Claude Code"));
  const title = el("span", "cc-panel__title", "Chưa có phiên");
  subheader.append(chip, title);

  const transcript = el("div", "cc-panel__transcript");
  transcript.setAttribute("aria-live", "polite");
  const streaming = el("div", "cc-panel__streaming");
  streaming.hidden = true;

  const composer = el("div", "cc-composer");
  const chips = el("div", "cc-composer__chips");
  for (const suggestion of SUGGESTIONS) {
    const chipButton = el("button", "cc-composer__chip", suggestion) as HTMLButtonElement;
    chipButton.type = "button";
    chipButton.addEventListener("click", () => {
      const input = root.querySelector<HTMLTextAreaElement>(".cc-composer__input");
      if (input !== null && !input.disabled) {
        input.value = suggestion;
        input.focus();
      }
    });
    chips.append(chipButton);
  }
  const row = el("div", "cc-composer__row");
  const input = el("textarea", "cc-composer__input") as HTMLTextAreaElement;
  input.rows = 2;
  input.placeholder = "Yêu cầu Claude Code…";
  input.setAttribute("aria-label", "Soạn yêu cầu Claude Code");
  const send = el("button", "cc-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.append(icon("paper-plane", "Gửi"));
  row.append(input, send);
  const reason = el("p", "cc-composer__reason");
  reason.hidden = true;
  composer.append(chips, row, reason);

  const doSend = (): void => {
    const text = input.value.trim();
    if (text.length === 0 || input.disabled) return;
    input.value = "";
    handlers.onSend(text);
  };
  send.addEventListener("click", doSend);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    doSend();
  });

  root.append(tabBar, subheader, transcript, streaming, composer);
  return { root, title, transcript, streaming, input, send };
}

export function renderClaudePanel(
  dom: ClaudePanelDom,
  state: {
    readonly title: string | null;
    readonly messages: readonly ConversationMessage[];
    readonly phase: RuntimePhase;
    readonly disabled: boolean;
    readonly disabledReason: string | null;
  },
): void {
  dom.title.textContent = state.title ?? "Chưa có phiên";
  dom.transcript.replaceChildren();
  if (state.messages.length === 0) {
    dom.transcript.append(el("p", "cc-panel__empty", "Gửi yêu cầu để bắt đầu — panel này dùng chung phiên với surface Cowork."));
  }
  for (const message of state.messages) {
    const node = el("div", `cc-msg cc-msg--${message.role}`);
    node.append(el("p", "cc-msg__text", message.text));
    dom.transcript.append(node);
  }
  const running = state.phase === "running" || state.phase === "starting" || state.phase === "cancelling";
  dom.root.classList.toggle("cc-panel--running", running);
  const locked = state.disabled || running;
  dom.input.disabled = locked;
  dom.send.disabled = locked;
  const reason = dom.root.querySelector<HTMLElement>(".cc-composer__reason");
  if (reason !== null) {
    reason.hidden = state.disabledReason === null;
    reason.textContent = state.disabledReason ?? "";
  }
  dom.transcript.scrollTop = dom.transcript.scrollHeight;
}

export function setClaudePanelStreaming(dom: ClaudePanelDom, text: string, active: boolean): void {
  dom.streaming.hidden = !active;
  dom.streaming.replaceChildren();
  if (!active) return;
  const dot = el("span", "cc-panel__pulse");
  dom.streaming.append(dot, el("span", "cc-panel__streaming-text", text.length > 0 ? text : "Đang xử lý…"));
  dom.streaming.scrollTop = dom.streaming.scrollHeight;
}
```

`app/ui/src/ui-shell/code/code-onboarding.ts`:

```ts
import { el } from "../dom-utils.js";

const STEPS: readonly { readonly title: string; readonly copy: string }[] = [
  { title: "Phiên chạy cục bộ", copy: "Mọi phiên chạy trên máy bạn qua local service; không có backend đám mây ẩn." },
  { title: "Ranh giới thực thi", copy: "Ghi tệp và lệnh chạy đều qua permission — Từ chối là chặn thật ở service." },
  { title: "Xem lại diff", copy: "Mỗi thay đổi tệp có snapshot trước/sau và diff chỉ đọc trong SOURCE CONTROL." },
  { title: "Provider trung lập", copy: "Model/provider cấu hình trong Cài đặt; surface này không khoá vào một LLM cụ thể." },
];

export function createCodeOnboarding(onStart: () => void): HTMLElement {
  const wrap = el("section", "cc-onboarding");
  wrap.append(el("h2", "cc-onboarding__title", "Claude Code Desktop hoạt động thế nào"));
  const list = el("ol", "cc-onboarding__steps");
  for (const step of STEPS) {
    const item = el("li", "cc-onboarding__step");
    item.append(el("h3", "cc-onboarding__step-title", step.title), el("p", "cc-onboarding__step-copy", step.copy));
    list.append(item);
  }
  const start = el("button", "cc-onboarding__start", "Bắt đầu phiên làm việc") as HTMLButtonElement;
  start.type = "button";
  start.addEventListener("click", onStart);
  const arch = el("div", "cc-onboarding__arch");
  for (const part of ["UI", "Local service", "OpenCode runtime", "LLM endpoint"]) {
    arch.append(el("span", "cc-onboarding__arch-chip", part));
  }
  wrap.append(list, start, arch);
  return wrap;
}
```

- [ ] **Step 4: Run tests → PASS.** **Step 5: Commit**

```bash
git add app/ui/src/ui-shell/code/claude-panel.ts app/ui/src/ui-shell/code/code-onboarding.ts app/ui/tests/claude-panel.test.ts
git commit -m "feat(ui): Claude panel bound to shared session + onboarding screen"
```

---

### Task 7: Code view assembly + shell integration

**Files:**
- Create: `app/ui/src/ui-shell/code/code-view.ts`, `app/ui/src/ui-shell/code/code.css`
- Modify: `app/ui/index.html` (add `<link rel="stylesheet" href="./src/ui-shell/code/code.css" />`)
- Modify: `app/ui/src/ui-shell/create-app-frame.ts` (instantiate + append both views, extend `AppFrameDom`)
- Modify: `app/ui/src/app-shell.ts` (state, renderState routing, handlers, navigator mount, streaming hook)
- Test: `app/ui/tests/code-view.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6; `mountWorkspaceNavigator` (host side); `sendPrompt`, `renderState`, `AppState` internals of `app-shell.ts`.
- Produces:
  - `interface ClaudeCodeViewDom { readonly root: HTMLElement; readonly repoChip: HTMLElement; readonly explorer: CodeExplorerDom; readonly editor: CodeEditorDom; readonly panel: ClaudePanelDom; readonly sessionBody: HTMLElement; readonly onboardingBody: HTMLElement; codeTab: "session" | "onboarding" }`
  - `function createClaudeCodeView(handlers: { readonly onSendPrompt: (text: string) => void }): ClaudeCodeViewDom` — root `section.view.view--code.cc-surface`, hidden, `dataset.view = "code"`; header (icon `code` + "Claude Code" + repo chip + segmented "Phiên làm việc / Cách hoạt động"); session body = 3-column grid (explorer 230px | editor 1fr | panel 372px); onboarding body hosts `createCodeOnboarding`.
  - `interface ClaudeCodeRenderInput { readonly workspaceName: string | null; readonly reviews: readonly FileReviewArtifact[]; readonly openFiles: readonly OpenCodeFile[]; readonly activeKey: string | null; readonly sessionTitle: string | null; readonly messages: readonly ConversationMessage[]; readonly phase: RuntimePhase; readonly composerDisabled: boolean; readonly composerDisabledReason: string | null }`
  - `function renderClaudeCodeSurface(dom: ClaudeCodeViewDom, input: ClaudeCodeRenderInput, handlers: { readonly onSelectTab: (key: string) => void; readonly onCloseTab: (key: string) => void; readonly onOpenReview: (review: FileReviewArtifact) => void; readonly onLoadFile: (relativePath: string, body: HTMLElement) => void }): void`

- [ ] **Step 1: Write failing test**

Create `app/ui/tests/code-view.test.ts`:

```ts
import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeCodeView, renderClaudeCodeSurface } from "../src/ui-shell/code/code-view.js";

const EMPTY_INPUT = {
  workspaceName: "cowork-athon-ghc",
  reviews: [],
  openFiles: [],
  activeKey: null,
  sessionTitle: null,
  messages: [],
  phase: "idle",
  composerDisabled: false,
  composerDisabledReason: null,
} as const;

const NOOP = {
  onSelectTab: () => undefined,
  onCloseTab: () => undefined,
  onOpenReview: () => undefined,
  onLoadFile: () => undefined,
};

test("session layout has 3 columns and repo chip", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.repoChip.textContent, "cowork-athon-ghc");
  assert.ok(dom.sessionBody.querySelector(".code-explorer"));
  assert.ok(dom.sessionBody.querySelector(".code-editor"));
  assert.ok(dom.sessionBody.querySelector(".cc-panel"));
});

test("segmented switches to onboarding and back via start button", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  const tabs = dom.root.querySelectorAll<HTMLButtonElement>(".cc-segmented__item");
  tabs[1]?.click();
  assert.equal(dom.codeTab, "onboarding");
  assert.equal(dom.sessionBody.hidden, true);
  dom.onboardingBody.querySelector<HTMLButtonElement>(".cc-onboarding__start")?.click();
  assert.equal(dom.codeTab, "session");
  assert.equal(dom.sessionBody.hidden, false);
});

test("explorer collapse toggles a class on the surface", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  dom.explorer.collapseButton.click();
  assert.equal(dom.root.classList.contains("cc-surface--explorer-collapsed"), true);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `app/ui/src/ui-shell/code/code-view.ts`:

```ts
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import type { RuntimePhase } from "../../conversation-controller.js";
import type { ConversationMessage } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { createClaudePanel, renderClaudePanel, type ClaudePanelDom } from "./claude-panel.js";
import { createCodeEditor, renderCodeEditor, type CodeEditorDom, type OpenCodeFile } from "./code-editor.js";
import { createCodeExplorer, renderSourceControl, type CodeExplorerDom } from "./code-explorer.js";
import { createCodeOnboarding } from "./code-onboarding.js";

export type CodeTab = "session" | "onboarding";

export interface ClaudeCodeViewDom {
  readonly root: HTMLElement;
  readonly repoChip: HTMLElement;
  readonly explorer: CodeExplorerDom;
  readonly editor: CodeEditorDom;
  readonly panel: ClaudePanelDom;
  readonly sessionBody: HTMLElement;
  readonly onboardingBody: HTMLElement;
  codeTab: CodeTab;
}

export interface ClaudeCodeRenderInput {
  readonly workspaceName: string | null;
  readonly reviews: readonly FileReviewArtifact[];
  readonly openFiles: readonly OpenCodeFile[];
  readonly activeKey: string | null;
  readonly sessionTitle: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly phase: RuntimePhase;
  readonly composerDisabled: boolean;
  readonly composerDisabledReason: string | null;
}

export interface ClaudeCodeHandlers {
  readonly onSelectTab: (key: string) => void;
  readonly onCloseTab: (key: string) => void;
  readonly onOpenReview: (review: FileReviewArtifact) => void;
  readonly onLoadFile: (relativePath: string, body: HTMLElement) => void;
}

export function createClaudeCodeView(handlers: { readonly onSendPrompt: (text: string) => void }): ClaudeCodeViewDom {
  const root = el("section", "view view--code cc-surface");
  root.dataset["view"] = "code";
  root.hidden = true;

  const header = el("header", "cc-surface__header");
  const titleWrap = el("div", "cc-surface__title-wrap");
  const logoChip = el("span", "cc-surface__logo");
  logoChip.append(icon("code", "Claude Code"));
  const repoChip = el("span", "cc-surface__repo");
  titleWrap.append(logoChip, el("h1", "cc-surface__title", "Claude Code"), repoChip);
  const segmented = el("div", "cc-segmented");
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Chế độ Claude Code");
  const tabSession = segButton("Phiên làm việc", true);
  const tabHow = segButton("Cách hoạt động", false);
  segmented.append(tabSession, tabHow);
  header.append(titleWrap, segmented);

  const explorer = createCodeExplorer();
  const editor = createCodeEditor();
  const panel = createClaudePanel({ onSend: handlers.onSendPrompt });
  const sessionBody = el("div", "cc-surface__session");
  sessionBody.append(explorer.root, editor.root, panel.root);

  const onboardingBody = el("div", "cc-surface__onboarding");
  onboardingBody.hidden = true;

  root.append(header, sessionBody, onboardingBody);
  const dom: ClaudeCodeViewDom = { root, repoChip, explorer, editor, panel, sessionBody, onboardingBody, codeTab: "session" };

  onboardingBody.append(
    createCodeOnboarding(() => selectTab(dom, tabSession, tabHow, "session")),
  );
  tabSession.addEventListener("click", () => selectTab(dom, tabSession, tabHow, "session"));
  tabHow.addEventListener("click", () => selectTab(dom, tabSession, tabHow, "onboarding"));

  explorer.collapseButton.addEventListener("click", () => {
    root.classList.toggle("cc-surface--explorer-collapsed");
    const collapsed = root.classList.contains("cc-surface--explorer-collapsed");
    explorer.collapseButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  return dom;
}

function segButton(label: string, active: boolean): HTMLButtonElement {
  const button = el("button", "cc-segmented__item", label) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", active ? "true" : "false");
  if (active) button.classList.add("cc-segmented__item--active");
  return button;
}

function selectTab(dom: ClaudeCodeViewDom, tabSession: HTMLButtonElement, tabHow: HTMLButtonElement, tab: CodeTab): void {
  dom.codeTab = tab;
  const session = tab === "session";
  dom.sessionBody.hidden = !session;
  dom.onboardingBody.hidden = session;
  tabSession.classList.toggle("cc-segmented__item--active", session);
  tabHow.classList.toggle("cc-segmented__item--active", !session);
  tabSession.setAttribute("aria-selected", session ? "true" : "false");
  tabHow.setAttribute("aria-selected", session ? "false" : "true");
}

export function renderClaudeCodeSurface(
  dom: ClaudeCodeViewDom,
  input: ClaudeCodeRenderInput,
  handlers: ClaudeCodeHandlers,
): void {
  dom.repoChip.textContent = input.workspaceName ?? "Chưa chọn workspace";
  renderSourceControl(dom.explorer, input.reviews, handlers.onOpenReview);
  renderCodeEditor(
    dom.editor,
    { openFiles: input.openFiles, activeKey: input.activeKey, reviews: input.reviews },
    { onSelect: handlers.onSelectTab, onClose: handlers.onCloseTab, onLoadFile: handlers.onLoadFile },
  );
  renderClaudePanel(dom.panel, {
    title: input.sessionTitle,
    messages: input.messages,
    phase: input.phase,
    disabled: input.composerDisabled,
    disabledReason: input.composerDisabledReason,
  });
}
```

`app/ui/src/ui-shell/code/code.css` — layout + tokens (abbreviated names per handoff; keep every selector below):

```css
.cc-surface { display: flex; flex-direction: column; background: #f7f8fa; overflow: hidden; }
.cc-surface__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #fff; border-bottom: 1px solid #eceff3; }
.cc-surface__title-wrap { display: flex; align-items: center; gap: 10px; }
.cc-surface__logo { display: inline-flex; width: 28px; height: 28px; border-radius: 8px; background: #fff3eb; color: #e85d1a; align-items: center; justify-content: center; }
.cc-surface__title { font-size: 20px; font-weight: 600; color: #1a2332; margin: 0; }
.cc-surface__repo { font-family: "Cascadia Code", ui-monospace, Consolas, monospace; font-size: 12px; background: #f1f3f6; border-radius: 999px; padding: 3px 10px; color: #4b5565; }
.cc-segmented { display: flex; background: #f1f3f6; border-radius: 10px; padding: 3px; gap: 2px; }
.cc-segmented__item { border: 0; background: transparent; border-radius: 8px; padding: 6px 14px; font-size: 13px; color: #4b5565; cursor: pointer; }
.cc-segmented__item--active { background: #fff; color: #1a2332; box-shadow: 0 1px 2px rgba(16,24,40,.06); }
.cc-surface__session { flex: 1; display: grid; grid-template-columns: 230px 1fr 372px; min-height: 0; }
.cc-surface--explorer-collapsed .cc-surface__session { grid-template-columns: 0 1fr 372px; }
.cc-surface--explorer-collapsed .code-explorer { display: none; }
.code-explorer { border-right: 1px solid #eceff3; background: #fff; overflow-y: auto; display: flex; flex-direction: column; }
.code-explorer__header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; }
.code-explorer__title, .code-explorer__label { font-size: 11px; font-weight: 700; letter-spacing: .05em; color: #6b7585; }
.code-explorer__label { margin: 0 0 6px; padding: 0 12px; }
.code-explorer__collapse { border: 0; background: transparent; cursor: pointer; color: #6b7585; }
.code-explorer__section { padding: 6px 0; border-top: 1px solid #eceff3; }
.code-scm__empty { font-size: 12px; color: #9aa4b2; padding: 4px 12px; margin: 0; }
.code-scm__row { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; background: transparent; padding: 5px 12px; cursor: pointer; text-align: left; font-size: 12.5px; }
.code-scm__row:hover { background: #f1f3f6; }
.code-scm__name { color: #1a2332; font-family: "Cascadia Code", ui-monospace, Consolas, monospace; }
.code-scm__dir { color: #9aa4b2; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.code-scm__stats { color: #6b7585; font-size: 11px; font-family: "Cascadia Code", ui-monospace, Consolas, monospace; }
.code-badge { border-radius: 5px; font-size: 10px; font-weight: 700; padding: 1px 5px; }
.code-badge--a { background: #eafaf0; color: #1f8f55; }
.code-badge--m { background: #fff4e5; color: #b45309; }
.code-badge--d { background: #fdeeee; color: #c0392b; }
.code-editor { display: flex; flex-direction: column; min-width: 0; background: #fff; }
.code-editor__tabs { display: flex; background: #f1f3f6; border-bottom: 1px solid #e2e6ec; overflow-x: auto; }
.code-tab { display: flex; align-items: center; }
.code-tab--active { background: #fff; box-shadow: inset 0 2px 0 #e85d1a; }
.code-tab__select { display: flex; align-items: center; gap: 6px; border: 0; background: transparent; padding: 8px 6px 8px 12px; cursor: pointer; font-size: 12.5px; }
.code-tab__name { font-family: "Cascadia Code", ui-monospace, Consolas, monospace; color: #1a2332; }
.code-tab__close { border: 0; background: transparent; cursor: pointer; color: #9aa4b2; padding: 0 8px; font-size: 14px; }
.code-tab__close:hover { color: #c0392b; }
.code-editor__body { flex: 1; overflow: auto; min-height: 0; }
.code-editor__welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #6b7585; gap: 8px; }
.code-editor__welcome-icon { color: #c3cad4; }
.code-editor__welcome-title { font-size: 16px; color: #1a2332; margin: 0; }
.code-editor__welcome-copy { font-size: 13px; max-width: 360px; text-align: center; margin: 0; }
.code-editor__toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #eceff3; }
.code-editor__breadcrumb { font-family: "Cascadia Code", ui-monospace, Consolas, monospace; font-size: 12px; color: #4b5565; }
.code-pill { border-radius: 999px; background: #f1f3f6; color: #6b7585; font-size: 11px; padding: 2px 9px; }
.code-pill--deleted { background: #fdeeee; color: #c0392b; }
.code-editor__plain { margin: 0; padding: 14px; font-family: "Cascadia Code", ui-monospace, Consolas, monospace; font-size: 12.5px; line-height: 1.75; color: #1a2332; white-space: pre-wrap; }
.code-editor__notice { padding: 14px; font-size: 13px; color: #4b5565; }
.code-diff__adds { color: #136b3f; font-size: 12px; font-family: "Cascadia Code", ui-monospace, Consolas, monospace; }
.code-diff__dels { color: #a3302a; font-size: 12px; font-family: "Cascadia Code", ui-monospace, Consolas, monospace; }
.code-diff__grid { font-family: "Cascadia Code", ui-monospace, Consolas, monospace; font-size: 12.5px; line-height: 1.75; }
.code-diff__row { display: grid; grid-template-columns: 44px 44px 1fr; }
.code-diff__row--add { background: #eafaf0; color: #136b3f; }
.code-diff__row--del { background: #fdeeee; color: #a3302a; }
.code-diff__row--ctx { color: #3a4658; }
.code-diff__gutter { color: #c3cad4; text-align: right; padding-right: 8px; user-select: none; }
.code-diff__text { white-space: pre-wrap; }
.cc-panel { border-left: 1px solid #eceff3; background: #fff; display: flex; flex-direction: column; min-height: 0; }
.cc-panel__tabbar { border-bottom: 1px solid #eceff3; padding: 0 14px; }
.cc-panel__tab { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .05em; color: #1a2332; padding: 10px 2px; box-shadow: inset 0 -2px 0 #e85d1a; }
.cc-panel__session { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #eceff3; }
.cc-panel__spark { display: inline-flex; width: 20px; height: 20px; border-radius: 6px; background: #fff3eb; color: #e85d1a; align-items: center; justify-content: center; }
.cc-panel__title { font-size: 13px; font-weight: 600; color: #1a2332; }
.cc-panel__transcript { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }
.cc-panel__empty { font-size: 12.5px; color: #9aa4b2; }
.cc-msg--user { align-self: flex-end; max-width: 85%; background: #fffdfb; border: 1px solid #f0c9ad; border-radius: 14px 14px 4px 14px; padding: 8px 12px; }
.cc-msg--assistant { align-self: flex-start; max-width: 95%; }
.cc-msg__text { margin: 0; font-size: 13px; line-height: 1.55; color: #1a2332; white-space: pre-wrap; }
.cc-panel__streaming { display: flex; gap: 8px; padding: 0 14px 10px; font-size: 13px; color: #4b5565; align-items: baseline; }
.cc-panel__pulse { width: 8px; height: 8px; border-radius: 999px; background: #e85d1a; animation: cghc-pulse 1.6s infinite; flex: none; }
@keyframes cghc-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.cc-composer { border-top: 1px solid #eceff3; padding: 10px 14px 12px; }
.cc-composer__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.cc-composer__chip { border: 1px solid #e2e6ec; background: #fff; border-radius: 999px; padding: 4px 10px; font-size: 11.5px; color: #4b5565; cursor: pointer; }
.cc-composer__chip:hover { border-color: #f0c9ad; color: #e85d1a; background: #fff3eb; }
.cc-composer__row { display: flex; gap: 8px; align-items: flex-end; }
.cc-composer__input { flex: 1; border: 1px solid #e2e6ec; border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; resize: none; }
.cc-composer__send { width: 32px; height: 32px; border-radius: 9px; border: 0; background: #e85d1a; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.cc-composer__send:disabled, .cc-composer__input:disabled { opacity: .55; cursor: not-allowed; }
.cc-composer__reason { font-size: 11px; color: #b45309; margin: 6px 0 0; }
.cc-surface__onboarding { flex: 1; overflow-y: auto; display: flex; justify-content: center; padding: 32px 16px; }
.cc-onboarding { max-width: 640px; }
.cc-onboarding__title { font-size: 20px; font-weight: 600; color: #1a2332; }
.cc-onboarding__steps { padding-left: 20px; display: flex; flex-direction: column; gap: 14px; }
.cc-onboarding__step-title { font-size: 14px; font-weight: 600; color: #1a2332; margin: 0; }
.cc-onboarding__step-copy { font-size: 13px; color: #4b5565; margin: 2px 0 0; }
.cc-onboarding__start { margin-top: 18px; background: #e85d1a; color: #fff; border: 0; border-radius: 10px; padding: 9px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
.cc-onboarding__start:hover { background: #d1500f; }
.cc-onboarding__arch { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.cc-onboarding__arch-chip { font-size: 11.5px; background: #f1f3f6; border-radius: 999px; padding: 4px 10px; color: #4b5565; }
```

- [ ] **Step 4: Run `tests/code-view.test.ts` → PASS.**

- [ ] **Step 5: Integrate into the frame (`create-app-frame.ts`)**

Add imports:

```ts
import { createMicrosoftView, type MicrosoftViewDom } from "./microsoft/microsoft-view.js";
import { createClaudeCodeView, type ClaudeCodeViewDom } from "./code/code-view.js";
```

Extend `AppFrameDom` with:

```ts
  readonly microsoftView: MicrosoftViewDom;
  readonly codeView: ClaudeCodeViewDom;
  onCodePanelSend: (text: string) => void;
```

In `createAppFrame` (after `const integrationSurface = ...`):

```ts
  const microsoftView = createMicrosoftView();
  const codeView = createClaudeCodeView({ onSendPrompt: (text) => dom.onCodePanelSend(text) });
```

Append `microsoftView.root, codeView.root` to `shellFrame.append(...)` (after `integrationSurface`), add both to the returned `dom` object, and initialize `onCodePanelSend: () => undefined`.

- [ ] **Step 6: Integrate into `app-shell.ts`**

a. Imports:

```ts
import type { MicrosoftIntegrationView } from "./integration-slots.js";
import { renderMicrosoftSurface } from "./ui-shell/microsoft/microsoft-view.js";
import { renderClaudeCodeSurface } from "./ui-shell/code/code-view.js";
import { fileTabKey, type OpenCodeFile } from "./ui-shell/code/code-editor.js";
import { setClaudePanelStreaming } from "./ui-shell/code/claude-panel.js";
```

b. Module-level honest production view (no backend yet):

```ts
const MS_DISCONNECTED_VIEW: MicrosoftIntegrationView = Object.freeze({
  connectionState: "disconnected",
  services: [],
  scopes: [],
  actionHistory: [],
});
```

c. `AppState` additions: `codeOpenFiles: OpenCodeFile[]; codeActiveKey: string | null;` (initialize `[]` / `null` in the initial state literal near `activeSurface: "cowork"`).

d. In `renderState`, after the `isKnowledgeSurface` const add:

```ts
  const isMicrosoftSurface = state.activeSurface === "microsoft";
  const isCodeSurface = state.activeSurface === "code";
```

Change visibility block to:

```ts
  dom.integrationSurface.hidden =
    settingsOpen || isCoworkSurface || isKnowledgeSurface || isMicrosoftSurface || isCodeSurface;
  dom.microsoftView.root.hidden = settingsOpen || !isMicrosoftSurface;
  dom.codeView.root.hidden = settingsOpen || !isCodeSurface;
```

and the render branch to:

```ts
  if (isKnowledgeSurface) {
    setKnowledgeGraphCapability(dom.knowledgeView, hasKnowledgeGraphCapability());
    renderKnowledgeTab(dom.knowledgeView, state.knowledgeTab);
  } else if (isMicrosoftSurface) {
    renderMicrosoftSurface(dom.microsoftView, MS_DISCONNECTED_VIEW);
  } else if (isCodeSurface) {
    renderCodeSurface(dom, state, handlers);
  } else if (!isCoworkSurface) {
    renderIntegrationSurface(dom.integrationSurface, activeSurface);
  }
```

e. Add the render helper (near `renderIntegrationSurface`):

```ts
function renderCodeSurface(dom: AppDom, state: AppState, handlers: Parameters<typeof renderState>[2]): void {
  const record = state.conv.state.activeRecord;
  const preflight = assessSendPreflight(buildReadinessInput(state.localServiceReady, state));
  const reviews = state.fileReviews;
  const workspaceName =
    state.activeWorkspace === null ? null : (state.activeWorkspace.split(/[\\/]/).filter(Boolean).pop() ?? null);
  renderClaudeCodeSurface(
    dom.codeView,
    {
      workspaceName,
      reviews,
      openFiles: state.codeOpenFiles,
      activeKey: state.codeActiveKey,
      sessionTitle: record?.title ?? null,
      messages: record?.messages ?? [],
      phase: state.conv.state.runtimePhase,
      composerDisabled: !preflight.canSend || isComposerLocked(state),
      composerDisabledReason: preflight.canSend ? null : preflight.message,
    },
    {
      onSelectTab: (key) => {
        state.codeActiveKey = key;
        renderState(dom, state, handlers);
      },
      onCloseTab: (key) => {
        state.codeOpenFiles = state.codeOpenFiles.filter((f) => f.key !== key);
        if (state.codeActiveKey === key) state.codeActiveKey = state.codeOpenFiles[0]?.key ?? null;
        renderState(dom, state, handlers);
      },
      onOpenReview: (review) => {
        const key = fileTabKey("review", review.relativePath);
        if (!state.codeOpenFiles.some((f) => f.key === key)) {
          state.codeOpenFiles = [...state.codeOpenFiles, { key, relativePath: review.relativePath, kind: "review", reviewId: review.id }];
        }
        state.codeActiveKey = key;
        renderState(dom, state, handlers);
      },
      onLoadFile: (relativePath, body) => {
        void loadCodePreview(state, relativePath, body);
      },
    },
  );
}

async function loadCodePreview(state: AppState, relativePath: string, body: HTMLElement): Promise<void> {
  if (state.client === null) {
    body.textContent = "Service chưa sẵn sàng.";
    return;
  }
  try {
    const result = await state.client.previewWorkspaceFile(relativePath);
    if (result.kind === "binary") { body.textContent = "Chưa hỗ trợ xem trước loại tệp này."; return; }
    if (result.kind === "missing") { body.textContent = "Không tìm thấy tệp trong workspace."; return; }
    const suffix = result.truncated ? "\n\n[Đã cắt bớt — tệp lớn hơn giới hạn xem trước 64 KiB]" : "";
    body.textContent = `${result.content ?? ""}${suffix}`;
  } catch (error) {
    body.textContent = safeError(error);
  }
}
```

f. Explorer tree + file open: in the init block where `mountWorkspaceNavigator` is called (`app-shell.ts:1630`), mount a second navigator into the code explorer with a handler that opens files in the code editor:

```ts
          mountWorkspaceNavigator(dom.codeView.explorer.treeSlot, {
            client: dynamicClient,
            getWorkspaceRoot: () => state.activeWorkspace,
            onFileSelected: (relativePath) => {
              const key = fileTabKey("file", relativePath);
              if (!state.codeOpenFiles.some((f) => f.key === key)) {
                state.codeOpenFiles = [...state.codeOpenFiles, { key, relativePath, kind: "file" }];
              }
              state.codeActiveKey = key;
              renderState(dom, state, handlers);
            },
          });
```

(match the exact `client`/`getWorkspaceRoot` argument expressions used by the existing mount at line 1630 — reuse the same variables in scope there).

g. Panel send: where composer listeners are wired (near `app-shell.ts:1776`), add:

```ts
  dom.onCodePanelSend = (text: string): void => {
    setComposerText(dom.composerInput, text);
    void sendPrompt(state, dom, readiness, handlers);
  };
```

(match the exact `readiness`/`handlers` variable names in that scope).

h. Streaming hook: find every assignment `state.assistantText = ...` inside the stream-view/streaming handlers and, immediately after the DOM update of the active assistant element, add:

```ts
  setClaudePanelStreaming(dom.codeView.panel, state.assistantText, true);
```

At turn finalization (where `state.finalizingTurn` completes / phase becomes terminal), add:

```ts
  setClaudePanelStreaming(dom.codeView.panel, "", false);
```

i. Add `<link rel="stylesheet" href="./src/ui-shell/code/code.css" />` to `app/ui/index.html`.

- [ ] **Step 7: Full verification**

```bash
npm run typecheck        # PASS
npm run test --workspace @cowork-ghc/ui   # all UI tests PASS
npm run build:renderer   # PASS
```

- [ ] **Step 8: Commit**

```bash
git add app/ui/src/ui-shell/code app/ui/src/ui-shell/create-app-frame.ts app/ui/src/app-shell.ts app/ui/index.html app/ui/tests/code-view.test.ts
git commit -m "feat(ui): assemble Claude Code surface and route both new surfaces in shell"
```

---

### Task 8: Packaged verification + docs

**Files:**
- Modify: `tools/verify/ui-shell-v3-production-screenshots.mjs` (add captures for the two surfaces)
- Modify: `docs/product/current-status.md` (new slice section)

**Interfaces:**
- Consumes: existing screenshot verifier structure (it already navigates surfaces by clicking rail buttons and saving PNG + structural JSON to `reports/`).
- Produces: `reports/ui-shell-v3-production-r3/` (or a new `reports/ms365-claudecode-surfaces/` directory if the verifier writes per-run dirs) containing screenshots `microsoft-assistant.png`, `microsoft-connect.png`, `code-session.png`, `code-onboarding.png`.

- [ ] **Step 1: Extend the verifier.** Open `tools/verify/ui-shell-v3-production-screenshots.mjs`, follow its existing per-surface capture pattern (rail button click → wait → screenshot + structural assertions) and add four captures: rail `microsoft` (default assistant tab, then click "Kết nối"), rail `code` (session layout: assert `.code-explorer`, `.code-editor`, `.cc-panel` all present; then click "Cách hoạt động"). Assert honesty: on microsoft-connect, `.ms-connect__signin` is `disabled` and page text contains "Backend D2".

- [ ] **Step 2: Run packaged verification**

```bash
scripts\build.bat
node tools/verify/ui-shell-v3-production-screenshots.mjs
scripts\stop.bat
```

Expected: verifier exits 0; screenshots exist in reports dir. If the packaged run fails, fix product code (never fake the verifier) and re-run.

- [ ] **Step 3: Update `docs/product/current-status.md`** — add a new top section (Vietnamese) titled `## Microsoft 365 & Claude Code surfaces (2026-07-13)` recording: spec path, plan path, what shipped (honest MS365 disconnected shell; Claude Code 3-column surface with real tree/preview/review-diff/shared-session), what is NOT included (no D2 backend, no editor writes, no accept/reject), evidence path, and verification commands used.

- [ ] **Step 4: Final commit**

```bash
git add tools/verify/ui-shell-v3-production-screenshots.mjs docs/product/current-status.md reports/
git commit -m "docs(product): record Microsoft 365 & Claude Code surfaces slice with packaged evidence"
```

Note: only commit `reports/` files if that matches the repo's existing practice for evidence (check `git log --stat` for prior `reports/` commits; if evidence is not committed, leave it untracked and reference the path in docs).

---

## Self-Review Notes

- Spec coverage: registry (T1), tokens/icons (T1/T3/T7 CSS), MS365 both tabs disconnected (T3), diff parser (T2), editor read-only + diff + redaction (T4), source control (T5), shared-session panel + Enter/Shift+Enter + streaming (T6/T7h), onboarding (T6), 3-column assembly + explorer collapse + routing (T7), packaged evidence + docs (T8). Accept/reject buttons intentionally absent (spec).
- Contract note: `microsoft` stays `awaiting_integration`; `renderIntegrationSurface` placeholder no longer renders for `microsoft`/`code` — covered by renderState changes in T7 step 6d.
- Type consistency: `OpenCodeFile.key` = `fileTabKey(kind, relativePath)` everywhere; `FileReviewArtifact` imported from `@cowork-ghc/service/file-review` in all code modules; panel messages use `ConversationMessage.text` (not `.content`).
