/**
 * ADR 0010 — provisioning safety tests: checksum verification and post-extraction path
 * confinement (zip-slip defense). No real network call, no real `Expand-Archive` — these are the
 * two places a bug would be a real security issue (a corrupted/tampered download accepted, or a
 * malicious zip entry escaping the destination dir), so they get direct, non-mocked-away coverage.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  sha256File,
  downloadAndVerify,
  assertExtractionConfined,
  isAlreadyProvisioned,
  ChecksumMismatchError,
  DownloadFailedError,
  ExtractionEscapeError,
  type FetchLike,
} from "../../src/knowledge/stack/provisioning.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-provision-"));
}

function fakeFetchOk(content: string): FetchLike {
  return async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
    return { ok: true, status: 200, body, text: async () => content };
  };
}

function fakeFetchFail(status: number): FetchLike {
  return async () => ({ ok: false, status, body: null, text: async () => "" });
}

test("sha256File computes the correct digest", async () => {
  const root = tempRoot();
  const file = join(root, "x.txt");
  writeFileSync(file, "hello world");
  const expected = createHash("sha256").update("hello world").digest("hex");
  assert.equal(await sha256File(file), expected);
  rmSync(root, { recursive: true, force: true });
});

test("downloadAndVerify: matching checksum writes the file", async () => {
  const root = tempRoot();
  const dest = join(root, "artifact.zip");
  const content = "zip-bytes";
  const expectedSha256 = createHash("sha256").update(content).digest("hex");

  await downloadAndVerify(
    { name: "test-artifact", url: "https://example.invalid/x.zip", expectedSha256 },
    dest,
    { fetchImpl: fakeFetchOk(content) },
  );

  assert.equal((await readFile(dest, "utf-8")), content);
  rmSync(root, { recursive: true, force: true });
});

test("downloadAndVerify: mismatched checksum throws and leaves no file at destPath", async () => {
  const root = tempRoot();
  const dest = join(root, "artifact.zip");

  await assert.rejects(
    () =>
      downloadAndVerify(
        { name: "test-artifact", url: "https://example.invalid/x.zip", expectedSha256: "0".repeat(64) },
        dest,
        { fetchImpl: fakeFetchOk("actual-content") },
      ),
    ChecksumMismatchError,
  );
  await assert.rejects(() => readFile(dest, "utf-8"));
  await assert.rejects(() => readFile(`${dest}.part`, "utf-8")); // temp file cleaned up too
  rmSync(root, { recursive: true, force: true });
});

test("downloadAndVerify: null expectedSha256 (PostgreSQL case) succeeds without verification", async () => {
  const root = tempRoot();
  const dest = join(root, "postgres.zip");
  await downloadAndVerify(
    { name: "postgres", url: "https://example.invalid/pg.zip", expectedSha256: null },
    dest,
    { fetchImpl: fakeFetchOk("pg-bytes") },
  );
  assert.equal((await readFile(dest, "utf-8")), "pg-bytes");
  rmSync(root, { recursive: true, force: true });
});

test("downloadAndVerify: non-2xx response throws DownloadFailedError", async () => {
  const root = tempRoot();
  const dest = join(root, "artifact.zip");
  await assert.rejects(
    () =>
      downloadAndVerify(
        { name: "test-artifact", url: "https://example.invalid/missing.zip", expectedSha256: null },
        dest,
        { fetchImpl: fakeFetchFail(404) },
      ),
    DownloadFailedError,
  );
  rmSync(root, { recursive: true, force: true });
});

test("assertExtractionConfined: passes for files legitimately inside destDir", async () => {
  const root = tempRoot();
  const destDir = join(root, "extracted");
  mkdirSync(join(destDir, "bin"), { recursive: true });
  writeFileSync(join(destDir, "bin", "postgres.exe"), "binary");
  await assertExtractionConfined(destDir); // must not throw
  rmSync(root, { recursive: true, force: true });
});

test("assertExtractionConfined: throws when a symlink escapes destDir (zip-slip defense)", async () => {
  const root = tempRoot();
  const destDir = join(root, "extracted");
  const outsideDir = join(root, "outside");
  mkdirSync(destDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, "secret.txt"), "should not be reachable from destDir");
  // Simulate a malicious zip entry that is a symlink pointing outside the extraction target.
  symlinkSync(join(outsideDir, "secret.txt"), join(destDir, "escape-link.txt"));

  await assert.rejects(() => assertExtractionConfined(destDir), ExtractionEscapeError);
  rmSync(root, { recursive: true, force: true });
});

test("isAlreadyProvisioned: false for missing/empty dir, true once populated", async () => {
  const root = tempRoot();
  const dir = join(root, "postgres");
  assert.equal(await isAlreadyProvisioned(dir), false);
  mkdirSync(dir, { recursive: true });
  assert.equal(await isAlreadyProvisioned(dir), false); // exists but empty
  writeFileSync(join(dir, "postgres.exe"), "x");
  assert.equal(await isAlreadyProvisioned(dir), true);
  rmSync(root, { recursive: true, force: true });
});
