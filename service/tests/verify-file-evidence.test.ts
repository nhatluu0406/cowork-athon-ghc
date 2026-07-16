/**
 * File-evidence verification hook (dispatch-verify-hook-retry-until-verified).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createFileEvidenceVerificationHook,
  type EvidenceCapture,
} from "../src/tasks/verify-file-evidence.js";
import type { AttemptResult } from "../src/tasks/loop-runner.js";

async function tempWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), "cghc-verify-evidence-"));
  const root = resolve(join(base, "workspace"));
  await mkdir(root, { recursive: true });
  return { root, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const completed = (evidencePaths?: readonly string[]): AttemptResult => ({
  status: "completed",
  ...(evidencePaths !== undefined ? { evidencePaths } : {}),
});
const errored = (): AttemptResult => ({ status: "errored" });

test("a non-completed attempt is never verified, regardless of evidencePaths", async () => {
  const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => "/does-not-matter" });
  const result = await hook(1, { ...errored(), evidencePaths: ["a.txt"] });
  assert.equal(result.verified, false);
});

test("a completed attempt with no declared evidencePaths is never verified (no inference)", async () => {
  const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => "/some/root" });
  const result = await hook(1, completed());
  assert.equal(result.verified, false);
});

test("no active workspace: cannot check disk, so never verified", async () => {
  const capture: EvidenceCapture = async () => ({ exists: true });
  const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => undefined, capture });
  const result = await hook(1, completed(["out.txt"]));
  assert.equal(result.verified, false);
});

test("every declared path exists on disk (fake capture) => verified with evidence text", async () => {
  const seen: string[] = [];
  const capture: EvidenceCapture = async (root, relativePath) => {
    seen.push(`${root}:${relativePath}`);
    return { exists: true };
  };
  const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => "/ws", capture });
  const result = await hook(1, completed(["a.txt", "b.txt"]));
  assert.equal(result.verified, true);
  assert.match(result.evidence ?? "", /a\.txt/);
  assert.match(result.evidence ?? "", /b\.txt/);
  assert.deepEqual(seen, ["/ws:a.txt", "/ws:b.txt"]);
});

test("one declared path missing on disk => never verified (partial evidence is not evidence)", async () => {
  const capture: EvidenceCapture = async (_root, relativePath) => ({ exists: relativePath !== "missing.txt" });
  const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => "/ws", capture });
  const result = await hook(1, completed(["a.txt", "missing.txt"]));
  assert.equal(result.verified, false);
});

test("a throwing disk check is honest false, never a fabricated pass", async () => {
  const capture: EvidenceCapture = async () => {
    throw new Error("disk unavailable");
  };
  const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => "/ws", capture });
  const result = await hook(1, completed(["a.txt"]));
  assert.equal(result.verified, false);
});

test("real disk check (no fake capture): a file that genuinely exists is verified", async () => {
  const { root, cleanup } = await tempWorkspace();
  try {
    await writeFile(join(root, "report.md"), "# done", "utf8");
    const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => root });
    const result = await hook(1, completed(["report.md"]));
    assert.equal(result.verified, true);
  } finally {
    await cleanup();
  }
});

test("real disk check: a claimed path that was never written is honestly not verified", async () => {
  const { root, cleanup } = await tempWorkspace();
  try {
    const hook = createFileEvidenceVerificationHook({ workspaceRoot: () => root });
    const result = await hook(1, completed(["never-written.md"]));
    assert.equal(result.verified, false);
  } finally {
    await cleanup();
  }
});
