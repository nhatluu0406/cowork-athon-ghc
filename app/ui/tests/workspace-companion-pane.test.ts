/**
 * Workspace Companion pane — Wave 4 dirty-edit conflict protection + safe auto-open.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mountWorkspaceCompanionPane,
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

/** Mount the pane, open a file, and make its buffer dirty by typing into the editor. */
async function mountWithDirtyOpenFile(
  files: Record<string, WorkspaceFileContentView>,
  openPath: string,
): Promise<{ container: HTMLElement; handle: ReturnType<typeof mountWorkspaceCompanionPane> }> {
  const { client } = makeClient(files);
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open(openPath);
  const editor = container.querySelector<HTMLTextAreaElement>(".workspace-companion-pane__editor");
  assert.ok(editor, "text file renders an editor");
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

test("conflict banner 'keep mine' dismisses the banner and preserves the buffer", async () => {
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
});

test("conflict banner 'reload from disk' discards edits and re-reads the file", async () => {
  const { client, reads } = makeClient({ "a.txt": textFile("a.txt", "disk v1") });
  const container = document.createElement("div");
  const handle = mountWorkspaceCompanionPane(container, client);
  await handle.open("a.txt");
  const editor = container.querySelector<HTMLTextAreaElement>(".workspace-companion-pane__editor");
  editor!.value = "user local edit";
  editor!.dispatchEvent(new Event("input"));
  handle.showAgentUpdated();
  const reloadBtn = container.querySelector<HTMLButtonElement>(
    ".workspace-companion-pane__conflict-btn--danger",
  );
  reloadBtn?.click();
  await new Promise((r) => setTimeout(r, 0));
  const banner = container.querySelector<HTMLElement>(".workspace-companion-pane__conflict");
  assert.equal(banner?.hidden, true, "banner hidden after reload");
  assert.deepEqual(reads, ["a.txt", "a.txt"], "the file was re-read from disk on reload");
  const reloaded = container.querySelector<HTMLTextAreaElement>(
    ".workspace-companion-pane__editor",
  );
  assert.equal(reloaded?.value, "disk v1", "editor shows the disk version after reload");
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
