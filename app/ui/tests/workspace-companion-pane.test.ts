/**
 * Workspace Companion pane — Wave 4 dirty-edit conflict protection + safe auto-open.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mountWorkspaceCompanionPane,
  type PptxViewerLike,
  type PptxViewerModuleLike,
  type WorkspaceFileContentView,
} from "../src/workspace-companion-pane.js";
import type { ServiceClient } from "../src/service-client.js";

function textFile(relativePath: string, content: string): WorkspaceFileContentView {
  return {
    relativePath,
    kind: "text",
    editable: true,
    content,
    truncated: false,
    sizeBytes: content.length,
  } as WorkspaceFileContentView;
}

function makeClient(files: Record<string, WorkspaceFileContentView>): {
  client: ServiceClient;
  reads: string[];
} {
  const reads: string[] = [];
  const client = {
    readWorkspaceFileContent: async (relativePath: string) => {
      reads.push(relativePath);
      const file = files[relativePath];
      if (file === undefined) {
        return {
          relativePath,
          kind: "missing",
          editable: false,
          truncated: false,
          sizeBytes: 0,
        } as WorkspaceFileContentView;
      }
      return file;
    },
    writeWorkspaceFileContent: async () => ({ relativePath: "", sizeBytes: 0 }),
  } as unknown as ServiceClient;
  return { client, reads };
}

/** Click the "Sửa" (edit) button so the read-only text view swaps to the editable textarea. */
function enterEditMode(container: HTMLElement): HTMLTextAreaElement {
  const editBtn = container.querySelector<HTMLButtonElement>(".workspace-companion-pane__edit");
  assert.ok(editBtn, "editable text shows an Edit button");
  assert.equal(editBtn.hidden, false, "Edit button is visible for editable text");
  editBtn.click();
  const editor = container.querySelector<HTMLTextAreaElement>(".workspace-companion-pane__editor");
  assert.ok(editor, "clicking Edit reveals a textarea");
  return editor;
}

/** Mount the pane, open a file, enter edit mode, and make its buffer dirty by typing. */
async function mountWithDirtyOpenFile(
  files: Record<string, WorkspaceFileContentView>,
  openPath: string,
): Promise<{ container: HTMLElement; handle: ReturnType<typeof mountWorkspaceCompanionPane> }> {
  const { client } = makeClient(files);
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open(openPath);
  const editor = enterEditMode(container);
  editor.value = "user local edit";
  editor.dispatchEvent(new Event("input"));
  return { container, handle };
}

test("showAgentUpdated on a DIRTY open file raises a conflict banner, does not overwrite", async () => {
  const { container, handle } = await mountWithDirtyOpenFile(
    { "a.txt": textFile("a.txt", "disk v1") },
    "a.txt",
  );
  handle.showAgentUpdated();
  const banner = container.querySelector<HTMLElement>(".workspace-companion-pane__conflict");
  assert.ok(banner, "banner element exists");
  assert.equal(banner.hidden, false, "conflict banner is shown on a dirty open file");
  // The user's unsaved edit is still in the editor (not overwritten by the agent version).
  const editor = container.querySelector<HTMLTextAreaElement>(".workspace-companion-pane__editor");
  assert.equal(editor?.value, "user local edit");
});

test("conflict banner 'keep mine' preserves the buffer AND keeps a persistent conflict indicator", async () => {
  const { container, handle } = await mountWithDirtyOpenFile(
    { "a.txt": textFile("a.txt", "disk v1") },
    "a.txt",
  );
  handle.showAgentUpdated();
  const keep = container.querySelector<HTMLButtonElement>(
    ".workspace-companion-pane__conflict-btn",
  );
  keep?.click();
  const banner = container.querySelector<HTMLElement>(".workspace-companion-pane__conflict");
  assert.equal(banner?.hidden, true, "banner hidden after keep-mine");
  const editor = container.querySelector<HTMLTextAreaElement>(".workspace-companion-pane__editor");
  assert.equal(editor?.value, "user local edit", "local edit preserved");
  // A persistent Save-overwrite warning survives so the user cannot forget the disk changed.
  const save = container.querySelector<HTMLButtonElement>(".workspace-companion-pane__save");
  assert.ok(
    save?.classList.contains("workspace-companion-pane__save--warn"),
    "Save keeps a persistent overwrite warning after keep-mine",
  );
});

test("conflict banner warns that reload discards unsaved local edits", async () => {
  const { container, handle } = await mountWithDirtyOpenFile(
    { "a.txt": textFile("a.txt", "disk v1") },
    "a.txt",
  );
  handle.showAgentUpdated();
  const text = container.querySelector<HTMLElement>(
    ".workspace-companion-pane__conflict-text",
  )?.textContent;
  assert.match(text ?? "", /bỏ .*thay đổi chưa lưu/iu, "reload consequence is spelled out");
});

test("conflict banner 'reload from disk' discards edits and re-reads the file", async () => {
  const { client, reads } = makeClient({ "a.txt": textFile("a.txt", "disk v1") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("a.txt");
  const editor = enterEditMode(container);
  editor.value = "user local edit";
  editor.dispatchEvent(new Event("input"));
  handle.showAgentUpdated();
  const reloadBtn = container.querySelector<HTMLButtonElement>(
    ".workspace-companion-pane__conflict-btn--danger",
  );
  reloadBtn?.click();
  await new Promise((r) => setTimeout(r, 0));
  const banner = container.querySelector<HTMLElement>(".workspace-companion-pane__conflict");
  assert.equal(banner?.hidden, true, "banner hidden after reload");
  assert.deepEqual(reads, ["a.txt", "a.txt"], "the file was re-read from disk on reload");
  // After reload the view returns to read-only, showing the disk version.
  const reloaded = container.querySelector<HTMLElement>(
    ".workspace-companion-pane__code-content",
  );
  assert.equal(reloaded?.textContent, "disk v1", "read-only view shows the disk version after reload");
});

test("openIfSafe refuses to auto-open over a dirty buffer", async () => {
  const { container, handle } = await mountWithDirtyOpenFile(
    { "a.txt": textFile("a.txt", "disk v1"), "b.md": textFile("b.md", "new file") },
    "a.txt",
  );
  const opened = await handle.openIfSafe("b.md");
  assert.equal(opened, false, "does not yank the user off unsaved work");
  assert.equal(handle.getOpenPath(), "a.txt", "still on the original file");
});

test("openIfSafe refuses secret-like and unsupported paths without reading them", async () => {
  const { client, reads } = makeClient({});
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  assert.equal(await handle.openIfSafe(".env"), false, "secret path blocked");
  assert.equal(await handle.openIfSafe("build/app.exe"), false, "unsupported type blocked");
  assert.deepEqual(reads, [], "no disk read attempted for unsafe paths");
});

test("openIfSafe opens a supported, non-secret file when the buffer is clean", async () => {
  const { client } = makeClient({ "docs/new.md": textFile("docs/new.md", "created by agent") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  const opened = await handle.openIfSafe("docs/new.md");
  assert.equal(opened, true);
  assert.equal(handle.getOpenPath(), "docs/new.md");
});

test("openIfSafe skips a file the service reports as unsupported (e.g. oversize)", async () => {
  const { client } = makeClient({
    "big.pdf": {
      relativePath: "big.pdf",
      kind: "unsupported",
      editable: false,
      truncated: true,
      sizeBytes: 20 * 1024 * 1024,
    } as WorkspaceFileContentView,
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  const opened = await handle.openIfSafe("big.pdf");
  assert.equal(opened, false, "oversize/unsupported content is not presented");
  assert.equal(handle.getOpenPath(), null, "open path unchanged when auto-open bails");
});

test("openIfSafe normalizes Windows path separators to POSIX", async () => {
  const { client, reads } = makeClient({ "docs/new.md": textFile("docs/new.md", "hi") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  const opened = await handle.openIfSafe("docs\\new.md");
  assert.equal(opened, true, "backslash path resolves");
  assert.deepEqual(reads, ["docs/new.md"], "read uses the normalized POSIX path");
  assert.equal(handle.getOpenPath(), "docs/new.md", "open path stored as POSIX");
});

test("a code file opens as a read-only highlighted view with a line-number gutter", async () => {
  const src = "def add(a, b):\n    return a + b\n";
  const { client } = makeClient({ "main.py": textFile("main.py", src) });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("main.py");

  // Read-only view, not a textarea, on open.
  assert.ok(container.querySelector(".workspace-companion-pane__code"), "shows the code view");
  assert.equal(
    container.querySelector(".workspace-companion-pane__editor"),
    null,
    "no editable textarea until Edit is clicked",
  );
  // Line-number gutter has one number per line.
  const gutter = container.querySelector<HTMLElement>(".workspace-companion-pane__code-gutter");
  assert.equal(gutter?.textContent, "1\n2\n3\n", "gutter numbers every line");
  // Python highlighting produced hljs markup.
  const code = container.querySelector<HTMLElement>(".workspace-companion-pane__code-content");
  assert.ok(code?.classList.contains("hljs"), "highlighted with highlight.js");
  assert.match(code?.innerHTML ?? "", /hljs-/u, "contains highlight token spans");
});

test("Edit button swaps to an editable textarea, dirty enables Save", async () => {
  const { client } = makeClient({ "main.py": textFile("main.py", "x = 1\n") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("main.py");
  const editor = enterEditMode(container);
  assert.equal(
    container.querySelector(".workspace-companion-pane__code"),
    null,
    "read-only view is replaced while editing",
  );
  editor.value = "x = 2\n";
  editor.dispatchEvent(new Event("input"));
  const save = container.querySelector<HTMLButtonElement>(".workspace-companion-pane__save");
  assert.equal(save?.hidden, false, "Save is visible in edit mode");
  assert.equal(save?.disabled, false, "Save enabled once the buffer is dirty");
});

test("very large text renders plain (no highlight) but still shows a gutter", async () => {
  const big = "a\n".repeat(200_000); // ~400 KB, over the highlight cap
  const { client } = makeClient({ "big.js": textFile("big.js", big) });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("big.js");
  const code = container.querySelector<HTMLElement>(".workspace-companion-pane__code-content");
  assert.ok(code, "still shows a code view");
  assert.equal(code?.classList.contains("hljs"), false, "skips highlighting for oversize content");
  assert.ok(
    container.querySelector(".workspace-companion-pane__code-gutter"),
    "line-number gutter still present",
  );
});

function presentationFile(
  relativePath: string,
  slides: { title: string; text: string }[],
): WorkspaceFileContentView {
  return {
    relativePath,
    kind: "presentation",
    editable: false,
    slides: slides.map((s, i) => ({ index: i + 1, title: s.title, text: s.text })),
    truncated: false,
    sizeBytes: 0,
  } as WorkspaceFileContentView;
}

function spreadsheetFile(
  relativePath: string,
  sheets: { name: string; rows: string[][] }[],
): WorkspaceFileContentView {
  return {
    relativePath,
    kind: "spreadsheet",
    editable: false,
    sheets,
    truncated: false,
    sizeBytes: 0,
  } as WorkspaceFileContentView;
}

/**
 * A deck the service could structurally parse: carries both the raw bytes (`dataBase64`, drives the
 * high-fidelity engine) and the text `slides` (fallback + slide count). Bytes are a placeholder —
 * the engine is faked in these tests since happy-dom has no real layout engine.
 */
function presentationHiFiFile(
  relativePath: string,
  slides: { title: string; text: string }[] = [{ title: "Intro", text: "Intro slide" }],
): WorkspaceFileContentView {
  return {
    relativePath,
    kind: "presentation",
    editable: false,
    slides: slides.map((s, i) => ({ index: i + 1, title: s.title, text: s.text })),
    dataBase64: "AAAA",
    truncated: false,
    sizeBytes: 4,
  } as WorkspaceFileContentView;
}

interface FakeViewerRec {
  readonly instances: number;
  readonly opened: (ArrayBuffer | Uint8Array | Blob)[];
  readonly gotos: number[];
  readonly destroyed: number;
  readonly lastOptions: Record<string, unknown> | undefined;
}

/** A fake PptxViewer + module loader recording how the pane drives the engine. */
function makeFakeViewer(opts: { slideCount?: number; failOpen?: boolean } = {}): {
  load: () => Promise<PptxViewerModuleLike>;
  rec: FakeViewerRec;
} {
  const rec = {
    instances: 0,
    opened: [] as (ArrayBuffer | Uint8Array | Blob)[],
    gotos: [] as number[],
    destroyed: 0,
    lastOptions: undefined as Record<string, unknown> | undefined,
  };
  class FakePptxViewer implements PptxViewerLike {
    slideCount = opts.slideCount ?? 1;
    currentSlideIndex = 0;
    private listeners: ((event: { detail: { index: number } }) => void)[] = [];
    constructor(
      private readonly mount: HTMLElement,
      options?: Record<string, unknown>,
    ) {
      rec.instances += 1;
      rec.lastOptions = options;
    }
    async open(input: ArrayBuffer | Uint8Array | Blob): Promise<void> {
      rec.opened.push(input);
      if (opts.failOpen) throw new Error("engine failure");
      // Simulate the engine mounting a real rendered slide node.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.mount.appendChild(svg);
    }
    async goToSlide(index: number): Promise<void> {
      this.currentSlideIndex = index;
      rec.gotos.push(index);
      this.listeners.forEach((l) => l({ detail: { index } }));
    }
    on(_type: "slidechange", listener: (event: { detail: { index: number } }) => void): unknown {
      this.listeners.push(listener);
      return this;
    }
    destroy(): void {
      rec.destroyed += 1;
      this.listeners = [];
    }
  }
  const load = async (): Promise<PptxViewerModuleLike> => ({
    PptxViewer: FakePptxViewer,
    RECOMMENDED_ZIP_LIMITS: { maxEntries: 4000 },
  });
  return { load, rec };
}

/** Flush the fire-and-forget viewer-load promise chain (dynamic import + open). */
async function flushViewer(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}

test("pptx high-fidelity: renders via the local engine and wires nav to goToSlide", async () => {
  const { load, rec } = makeFakeViewer({ slideCount: 3 });
  const { client } = makeClient({ "d.pptx": presentationHiFiFile("d.pptx") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client, { loadPptxViewer: load });
  await handle.open("d.pptx");
  await flushViewer();

  assert.equal(rec.instances, 1, "one engine instance for the deck");
  assert.equal(rec.opened.length, 1, "engine was handed the deck bytes to render");
  assert.equal(rec.lastOptions?.["pdfjs"], false, "pdf.js/EMF worker fallback disabled (CSP)");
  assert.ok(rec.lastOptions?.["zipLimits"], "bounded ZIP limits passed for DoS safety");
  // A real rendered node is mounted — not just an empty container / a text list.
  assert.ok(
    container.querySelector(".workspace-companion-pane__slide-mount svg"),
    "the engine's rendered slide node is mounted",
  );
  assert.equal(
    container.querySelector(".workspace-companion-pane__slide-text"),
    null,
    "high-fidelity path does not fall back to the text <pre>",
  );

  const counter = () =>
    container.querySelector<HTMLElement>(".workspace-companion-pane__deck-counter")?.textContent;
  const prev = () =>
    container.querySelectorAll<HTMLButtonElement>(".workspace-companion-pane__deck-btn")[0]!;
  const next = () =>
    container.querySelectorAll<HTMLButtonElement>(".workspace-companion-pane__deck-btn")[1]!;
  assert.equal(counter(), "Slide 1 / 3", "counter uses the engine's slide count");
  assert.equal(prev().disabled, true, "prev disabled on the first slide");

  next().click();
  assert.deepEqual(rec.gotos, [1], "next drives the engine's goToSlide, not a Workspace reload");
  assert.equal(counter(), "Slide 2 / 3", "counter advances");
  assert.equal(next().disabled, false, "next still enabled mid-deck");
});

test("pptx high-fidelity failure degrades to the text-first fallback", async () => {
  const { load } = makeFakeViewer({ failOpen: true });
  const { client } = makeClient({
    "d.pptx": presentationHiFiFile("d.pptx", [
      { title: "Intro", text: "Intro slide" },
      { title: "Body", text: "Body slide" },
    ]),
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client, { loadPptxViewer: load });
  await handle.open("d.pptx");
  await flushViewer();

  const slideText = container.querySelector<HTMLElement>(
    ".workspace-companion-pane__slide-text",
  )?.textContent;
  assert.equal(slideText, "Intro slide", "falls back to the text-first slide view on engine failure");
});

test("switching files destroys the active pptx viewer (no leak)", async () => {
  const { load, rec } = makeFakeViewer({ slideCount: 2 });
  const { client } = makeClient({
    "d.pptx": presentationHiFiFile("d.pptx"),
    "a.txt": textFile("a.txt", "hi"),
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client, { loadPptxViewer: load });
  await handle.open("d.pptx");
  await flushViewer();
  assert.equal(rec.destroyed, 0, "viewer alive while the deck is open");
  await handle.open("a.txt");
  assert.ok(rec.destroyed >= 1, "opening another file tears the viewer down");
});

test("pptx preview shows slide 1 of N and navigates with previous/next", async () => {
  const { client } = makeClient({
    "deck.pptx": presentationFile("deck.pptx", [
      { title: "Intro", text: "Intro slide" },
      { title: "Body", text: "Body slide" },
    ]),
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("deck.pptx");

  const counter = () =>
    container.querySelector<HTMLElement>(".workspace-companion-pane__deck-counter")?.textContent;
  const slideText = () =>
    container.querySelector<HTMLElement>(".workspace-companion-pane__slide-text")?.textContent;
  const prev = () =>
    container.querySelectorAll<HTMLButtonElement>(".workspace-companion-pane__deck-btn")[0]!;
  const next = () =>
    container.querySelectorAll<HTMLButtonElement>(".workspace-companion-pane__deck-btn")[1]!;

  assert.equal(counter(), "Slide 1 / 2");
  assert.equal(slideText(), "Intro slide");
  assert.equal(prev().disabled, true, "prev disabled on the first slide");

  next().click();
  assert.equal(counter(), "Slide 2 / 2");
  assert.equal(slideText(), "Body slide");
  assert.equal(next().disabled, true, "next disabled on the last slide");

  prev().click();
  assert.equal(counter(), "Slide 1 / 2", "prev returns to the first slide");
});

test("pptx with no slides shows a clear empty state", async () => {
  const { client } = makeClient({ "empty.pptx": presentationFile("empty.pptx", []) });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("empty.pptx");
  const msg = container.querySelector<HTMLElement>(".workspace-companion-pane__message");
  assert.match(msg?.textContent ?? "", /không có slide/iu);
});

test("xlsx multi-sheet renders a selector and switching changes the grid without a reload", async () => {
  const { client, reads } = makeClient({
    "book.xlsx": spreadsheetFile("book.xlsx", [
      { name: "Alpha", rows: [["a1"]] },
      { name: "Beta", rows: [["b1"]] },
    ]),
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("book.xlsx");

  const tabs = container.querySelectorAll<HTMLButtonElement>(
    ".workspace-companion-pane__sheet-tab",
  );
  assert.equal(tabs.length, 2, "one tab per visible sheet");
  const firstCell = () =>
    container.querySelector<HTMLInputElement>(".workspace-companion-pane__grid-input")?.value;
  assert.equal(firstCell(), "a1", "opens the first sheet by default");

  tabs[1]!.click();
  assert.equal(firstCell(), "b1", "switching tab renders the second sheet");
  assert.deepEqual(reads, ["book.xlsx"], "switching sheets does not re-read/reload the file");
});

test("single-sheet xlsx does not render a redundant sheet selector", async () => {
  const { client } = makeClient({
    "one.xlsx": spreadsheetFile("one.xlsx", [{ name: "Only", rows: [["x"]] }]),
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("one.xlsx");
  assert.equal(
    container.querySelector(".workspace-companion-pane__sheet-tab"),
    null,
    "no tab row for a single sheet",
  );
  assert.ok(container.querySelector(".workspace-companion-pane__grid"), "grid still renders");
});

test("opening a new workbook resets the active sheet to the first", async () => {
  const { client } = makeClient({
    "a.xlsx": spreadsheetFile("a.xlsx", [
      { name: "A1", rows: [["a1"]] },
      { name: "A2", rows: [["a2"]] },
    ]),
    "b.xlsx": spreadsheetFile("b.xlsx", [
      { name: "B1", rows: [["b1"]] },
      { name: "B2", rows: [["b2"]] },
    ]),
  });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("a.xlsx");
  container.querySelectorAll<HTMLButtonElement>(".workspace-companion-pane__sheet-tab")[1]!.click();
  assert.equal(
    container.querySelector<HTMLInputElement>(".workspace-companion-pane__grid-input")?.value,
    "a2",
    "switched to the second sheet of workbook A",
  );
  await handle.open("b.xlsx");
  assert.equal(
    container.querySelector<HTMLInputElement>(".workspace-companion-pane__grid-input")?.value,
    "b1",
    "workbook B opens back on its first sheet",
  );
});

test("showDeleted clears the open file, shows a deleted state, and blocks Save recreate", async () => {
  const { client } = makeClient({ "a.txt": textFile("a.txt", "disk v1") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("a.txt");
  // The read-only preview is present before the delete.
  assert.ok(container.querySelector(".workspace-companion-pane__code"), "preview before delete");

  handle.showDeleted();

  // No stale preview/editor, a clear deleted message, and no open target.
  assert.equal(
    container.querySelector(".workspace-companion-pane__code"),
    null,
    "preview cleared after delete",
  );
  assert.equal(
    container.querySelector(".workspace-companion-pane__editor"),
    null,
    "editor cleared after delete",
  );
  const msg = container.querySelector<HTMLElement>(".workspace-companion-pane__message");
  assert.match(msg?.textContent ?? "", /đã bị xóa/iu, "shows a deleted empty state");
  assert.equal(handle.getOpenPath(), null, "no open path → a stray Save cannot recreate it");
  const save = container.querySelector<HTMLButtonElement>(".workspace-companion-pane__save");
  assert.equal(save?.hidden, true, "Save is hidden in the deleted state");
});
