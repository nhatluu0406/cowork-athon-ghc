import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import {
  badgeForReview,
  fileTabKey,
  mountCodeEditor,
  type CloseDirtyChoice,
} from "../src/ui-shell/code/code-editor.js";
import type { ServiceClient, WorkspaceFileContentView } from "../src/service-client.js";

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

function textFile(relativePath: string, content: string, editable = true): WorkspaceFileContentView {
  return {
    relativePath,
    kind: "text",
    editable,
    content,
    truncated: false,
    sizeBytes: content.length,
  } as WorkspaceFileContentView;
}

function makeClient(files: Record<string, WorkspaceFileContentView>): {
  client: ServiceClient;
  reads: string[];
  writes: { path: string; content: string }[];
  failWrite: { on: boolean };
} {
  const reads: string[] = [];
  const writes: { path: string; content: string }[] = [];
  const failWrite = { on: false };
  const client = {
    readWorkspaceFileContent: async (relativePath: string) => {
      reads.push(relativePath);
      return (
        files[relativePath] ??
        ({ relativePath, kind: "missing", editable: false, truncated: false, sizeBytes: 0 } as WorkspaceFileContentView)
      );
    },
    writeWorkspaceFileContent: async (relativePath: string, input: { kind: string; content?: string }) => {
      if (failWrite.on) throw new Error("disk full");
      const content = input.content ?? "";
      writes.push({ path: relativePath, content });
      files[relativePath] = textFile(relativePath, content);
      return { relativePath, sizeBytes: content.length };
    },
  } as unknown as ServiceClient;
  return { client, reads, writes, failWrite };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function button(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => (b.textContent ?? "").trim() === text,
    ) ?? null
  );
}

async function edit(container: HTMLElement, value: string): Promise<HTMLTextAreaElement> {
  button(container, "Sửa")?.click();
  const editor = container.querySelector<HTMLTextAreaElement>(".code-editor__textarea");
  assert.ok(editor, "edit mode reveals a textarea");
  editor.value = value;
  editor.dispatchEvent(new Event("input"));
  return editor;
}

test("badge mapping", () => {
  assert.equal(badgeForReview({ eventKind: "file_created" }), "A");
  assert.equal(badgeForReview({ eventKind: "file_deleted" }), "D");
  assert.equal(badgeForReview({ eventKind: "file_modified" }), "M");
});

test("welcome screen when nothing is open", () => {
  const { client } = makeClient({});
  const container = document.createElement("div");
  mountCodeEditor(container, client);
  assert.match(container.textContent ?? "", /Chưa mở tệp nào/);
});

test("opening a file loads its content into a read-only, editable-capable tab", async () => {
  const { client } = makeClient({ "a.ts": textFile("a.ts", "const x = 1;") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  assert.match(container.textContent ?? "", /const x = 1;/);
  assert.ok(button(container, "Sửa"), "editable text shows an edit button");
  assert.equal(ctrl.getActivePath(), "a.ts");
});

test("syntax highlighting applies for a known language", async () => {
  const { client } = makeClient({ "a.ts": textFile("a.ts", "const x = 1;") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  assert.ok(container.querySelector(".code-editor__code-content.hljs"), "hljs markup present");
});

test("opening the same file twice re-activates a single tab", async () => {
  const { client, reads } = makeClient({ "a.ts": textFile("a.ts", "a") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  ctrl.openFile("a.ts");
  await flush();
  assert.equal(container.querySelectorAll(".code-tab").length, 1);
  assert.equal(reads.filter((r) => r === "a.ts").length, 1);
});

test("multiple tabs: switching preserves the dirty buffer of the other tab", async () => {
  const { client } = makeClient({ "a.ts": textFile("a.ts", "AA"), "b.ts": textFile("b.ts", "BB") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  await edit(container, "AA edited");
  ctrl.openFile("b.ts");
  await flush();
  assert.match(container.textContent ?? "", /BB/);
  // Back to A: the dirty buffer is preserved (still dirty, still editing).
  ctrl.openFile("a.ts");
  await flush();
  const editor = container.querySelector<HTMLTextAreaElement>(".code-editor__textarea");
  assert.equal(editor?.value, "AA edited");
  assert.equal(ctrl.hasDirty(), true);
});

test("Ctrl+S saves the active editable tab and clears dirty", async () => {
  const { client, writes } = makeClient({ "a.ts": textFile("a.ts", "old") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  await edit(container, "new content");
  ctrl.root.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await flush();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { path: "a.ts", content: "new content" });
  assert.equal(ctrl.hasDirty(), false);
});

test("Save button writes via the guarded route; unchanged content never writes", async () => {
  const { client, writes } = makeClient({ "a.ts": textFile("a.ts", "same") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  // Type the identical content: not dirty, save disabled, Ctrl+S is a no-op.
  await edit(container, "same");
  assert.equal(ctrl.hasDirty(), false);
  ctrl.root.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  await flush();
  assert.equal(writes.length, 0);
});

test("a failed save keeps the buffer dirty", async () => {
  const { client, failWrite } = makeClient({ "a.ts": textFile("a.ts", "old") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  await edit(container, "new");
  failWrite.on = true;
  button(container, "Lưu")?.click();
  await flush();
  assert.equal(ctrl.hasDirty(), true);
});

test("closing a clean tab removes it immediately", async () => {
  const { client } = makeClient({ "a.ts": textFile("a.ts", "a") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  container.querySelector<HTMLButtonElement>(".code-tab__close")?.click();
  await flush();
  assert.equal(container.querySelectorAll(".code-tab").length, 0);
  assert.equal(ctrl.getActivePath(), null);
});

test("closing a dirty tab offers Save/Discard/Cancel and honours the choice", async () => {
  let choice: CloseDirtyChoice = "cancel";
  const { client, writes } = makeClient({ "a.ts": textFile("a.ts", "old") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client, { confirmDirtyClose: async () => choice });

  const closeActive = async (): Promise<void> => {
    container.querySelector<HTMLButtonElement>(".code-tab__close")?.click();
    await flush();
  };

  ctrl.openFile("a.ts");
  await flush();
  await edit(container, "dirty");

  // Cancel keeps the tab.
  choice = "cancel";
  await closeActive();
  assert.equal(container.querySelectorAll(".code-tab").length, 1);

  // Save writes then closes.
  choice = "save";
  await closeActive();
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(container.querySelectorAll(".code-tab").length, 0);
});

test("closing a dirty tab with Discard drops it without writing", async () => {
  const { client, writes } = makeClient({ "a.ts": textFile("a.ts", "old") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client, { confirmDirtyClose: async () => "discard" });
  ctrl.openFile("a.ts");
  await flush();
  await edit(container, "dirty");
  container.querySelector<HTMLButtonElement>(".code-tab__close")?.click();
  await flush();
  assert.equal(writes.length, 0);
  assert.equal(container.querySelectorAll(".code-tab").length, 0);
});

test("verified modify reloads a clean open tab from disk", async () => {
  const files = { "a.ts": textFile("a.ts", "v1") };
  const { client } = makeClient(files);
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  files["a.ts"] = textFile("a.ts", "v2 from agent");
  ctrl.applyVerifiedMutation("a.ts", "modify");
  await flush();
  assert.match(container.textContent ?? "", /v2 from agent/);
});

test("verified modify on a DIRTY tab raises a conflict and keeps the buffer", async () => {
  const files = { "a.ts": textFile("a.ts", "v1") };
  const { client } = makeClient(files);
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  await edit(container, "my local edit");
  files["a.ts"] = textFile("a.ts", "agent v2");
  ctrl.applyVerifiedMutation("a.ts", "modify");
  await flush();
  assert.ok(container.querySelector(".code-editor__conflict"), "conflict banner shown");
  const editor = container.querySelector<HTMLTextAreaElement>(".code-editor__textarea");
  assert.equal(editor?.value, "my local edit");
  assert.equal(ctrl.hasDirty(), true);
});

test("verified delete puts the open tab into a deleted state and blocks save", async () => {
  const { client } = makeClient({ "a.ts": textFile("a.ts", "x") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  await flush();
  ctrl.applyVerifiedMutation("a.ts", "delete");
  await flush();
  assert.match(container.textContent ?? "", /đã bị xóa/);
  assert.equal(ctrl.getActivePath(), null);
  assert.equal(button(container, "Lưu"), null);
});

test("non-text file hands off to Workspace instead of duplicating a viewer", async () => {
  const { client } = makeClient({
    "a.pdf": { relativePath: "a.pdf", kind: "pdf", editable: false, truncated: false, sizeBytes: 10 } as WorkspaceFileContentView,
  });
  let handedOff: string | null = null;
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client, { onOpenInWorkspace: (p) => (handedOff = p) });
  ctrl.openFile("a.pdf");
  await flush();
  assert.match(container.textContent ?? "", /xem trong Workspace/i);
  button(container, "Xem trong Workspace")?.click();
  assert.equal(handedOff, "a.pdf");
});

test("openReview shows a diff tab; getActivePath is null for a review", () => {
  const container = document.createElement("div");
  const { client } = makeClient({});
  const ctrl = mountCodeEditor(container, client);
  ctrl.setReviews([REVIEW]);
  ctrl.openReview(REVIEW);
  assert.equal(container.querySelectorAll(".code-diff__row--add").length, 1);
  assert.equal(container.querySelectorAll(".code-diff__row--del").length, 1);
  assert.equal(ctrl.getActivePath(), null);
  assert.equal(fileTabKey("review", "src/app.ts"), "review:src/app.ts");
});

test("reset clears every tab (workspace change)", async () => {
  const { client } = makeClient({ "a.ts": textFile("a.ts", "a"), "b.ts": textFile("b.ts", "b") });
  const container = document.createElement("div");
  const ctrl = mountCodeEditor(container, client);
  ctrl.openFile("a.ts");
  ctrl.openFile("b.ts");
  await flush();
  ctrl.reset();
  assert.equal(container.querySelectorAll(".code-tab").length, 0);
  assert.match(container.textContent ?? "", /Chưa mở tệp nào/);
  assert.equal(ctrl.getActivePath(), null);
});
