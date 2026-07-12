/**
 * File review router — snapshot + build endpoints.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileReviewRouter } from "../src/file-review/router.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-freview-router-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return root;
}

test("POST snapshot returns bounded capture for workspace file", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, "note.txt"), "hello", "utf8");
  const router = createFileReviewRouter({ activeWorkspaceRoot: () => root });
  const route = router.routes.find((r) => r.path === "/v1/file-review/snapshot");
  assert.ok(route);
  const result = await route!.handler({
    method: "POST",
    path: route!.path,
    url: new URL("http://127.0.0.1/v1/file-review/snapshot"),
    body: { relativePath: "note.txt" },
    headers: {},
  });
  assert.equal(result.status, 200);
  const data = result.data as { snapshot: { content?: string; exists: boolean } };
  assert.equal(data.snapshot.exists, true);
  assert.equal(data.snapshot.content, "hello");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("POST build returns review artifact with diff", async () => {
  const root = await tempWorkspace();
  const router = createFileReviewRouter({ activeWorkspaceRoot: () => root });
  const route = router.routes.find((r) => r.path === "/v1/file-review/build");
  assert.ok(route);
  const result = await route!.handler({
    method: "POST",
    path: route!.path,
    url: new URL("http://127.0.0.1/v1/file-review/build"),
    body: {
      id: "r1",
      relativePath: "note.txt",
      at: "2026-07-12T08:00:00.000Z",
      seq: 1,
      source: "runtime_tool",
      operation: "edit",
      before: {
        relativePath: "note.txt",
        exists: true,
        kind: "text",
        content: "A",
        sizeBytes: 1,
        truncated: false,
        contentRedacted: false,
      },
      after: {
        relativePath: "note.txt",
        exists: true,
        kind: "text",
        content: "B",
        sizeBytes: 1,
        truncated: false,
        contentRedacted: false,
      },
    },
    headers: {},
  });
  assert.equal(result.status, 200);
  const data = result.data as { review: { unifiedDiff?: string } };
  assert.match(data.review.unifiedDiff ?? "", /-A/);
  assert.match(data.review.unifiedDiff ?? "", /\+B/);
  await rm(join(root, ".."), { recursive: true, force: true });
});
