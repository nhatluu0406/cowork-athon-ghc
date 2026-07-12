/**
 * CGHC-018 — guarded, permission-gated file mutation with ON-DISK assertions (F1/F2/F3/F6).
 *
 * Every case uses a REAL temp workspace and asserts the ACTUAL bytes/state on disk after the
 * operation, proving the mutation ran (or did NOT run) at the execution boundary — never a
 * fabricated result. The UI is modeled as a caller of {@link FileService}; it never writes disk.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { FileOperationError } from "../src/files/index.js";
import { makeFilesHarness } from "./files-fakes.js";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("F6: an APPROVED create writes the file — assert actual on-disk bytes", async () => {
  const h = await makeFilesHarness();
  const target = path.join(h.root, "note.txt");
  await h.approve("c1", "file_create", target);

  const result = await h.service.create("c1", "note.txt", "hello-on-disk");

  assert.equal(result.performed, true);
  assert.equal(await readFile(target, "utf8"), "hello-on-disk", "the bytes are actually on disk");
});

test("F6: an APPROVED edit overwrites existing on-disk bytes", async () => {
  const h = await makeFilesHarness();
  const target = path.join(h.root, "doc.md");
  await writeFile(target, "original", "utf8");
  await h.approve("e1", "file_edit", target);

  await h.service.edit("e1", "doc.md", "rewritten");

  assert.equal(await readFile(target, "utf8"), "rewritten");
});

test("F6: a DENIED delete removes NOTHING — file still on disk with original bytes", async () => {
  const h = await makeFilesHarness();
  const target = path.join(h.root, "keep.txt");
  await writeFile(target, "DO-NOT-DELETE", "utf8");
  await h.deny("d1", "file_delete", target);

  const result = await h.service.delete("d1", "keep.txt");

  assert.deepEqual(result, { performed: false, reason: "not_allowed" });
  assert.equal(await exists(target), true, "denied delete left the file in place");
  assert.equal(await readFile(target, "utf8"), "DO-NOT-DELETE", "original bytes are intact");
});

test("F3: an UNAPPROVED (pending) delete removes nothing on disk", async () => {
  const h = await makeFilesHarness();
  const target = path.join(h.root, "pending.txt");
  await writeFile(target, "STILL-HERE", "utf8");
  h.submitPending("d2", "file_delete", target); // submitted but never resolved

  const result = await h.service.delete("d2", "pending.txt");

  assert.deepEqual(result, { performed: false, reason: "not_allowed" });
  assert.equal(await readFile(target, "utf8"), "STILL-HERE");
});

test("F3: an APPROVED delete removes the file and records an audit event (no secret)", async () => {
  const h = await makeFilesHarness();
  const target = path.join(h.root, "gone.txt");
  await writeFile(target, "bye", "utf8");
  await h.approve("d3", "file_delete", target);

  const result = await h.service.delete("d3", "gone.txt");

  assert.equal(result.performed, true);
  assert.equal(await exists(target), false, "approved delete removed the file");
  const events = h.permissionAudit.events();
  assert.ok(
    events.some((ev) => ev.requestId === "d3" && ev.decision === "allow" && ev.approvalLevel === "elevated"),
    "an elevated allow was audited for the delete",
  );
});

test("F2: an APPROVED move relocates the bytes on disk", async () => {
  const h = await makeFilesHarness();
  const src = path.join(h.root, "src.txt");
  const dest = path.join(h.root, "sub", "dest.txt");
  await writeFile(src, "moved-bytes", "utf8");
  await h.approve("m1", "file_move", dest);

  const result = await h.service.move("m1", "src.txt", "sub/dest.txt");

  assert.equal(result.performed, true);
  assert.equal(await exists(src), false, "source no longer exists");
  assert.equal(await readFile(dest, "utf8"), "moved-bytes", "bytes relocated to destination");
});

test("F2: a DENIED move leaves both source and destination as before", async () => {
  const h = await makeFilesHarness();
  const src = path.join(h.root, "stay.txt");
  const dest = path.join(h.root, "elsewhere.txt");
  await writeFile(src, "unmoved", "utf8");
  await h.deny("m2", "file_move", dest);

  const result = await h.service.move("m2", "stay.txt", "elsewhere.txt");

  assert.deepEqual(result, { performed: false, reason: "not_allowed" });
  assert.equal(await readFile(src, "utf8"), "unmoved", "source untouched");
  assert.equal(await exists(dest), false, "destination was never created");
});

test("edit of a missing file maps to an explicit not_found error (no raw stack)", async () => {
  const h = await makeFilesHarness();
  await h.approve("e2", "file_edit", path.join(h.root, "ghost.txt"));
  await assert.rejects(
    h.service.edit("e2", "ghost.txt", "x"),
    (err: unknown) => err instanceof FileOperationError && err.reason === "not_found",
  );
});

test("read is confined and returns on-disk bytes for a file inside the workspace", async () => {
  const h = await makeFilesHarness();
  await writeFile(path.join(h.root, "r.txt"), "readable", "utf8");
  assert.equal(await h.service.read("r.txt"), "readable");
});
