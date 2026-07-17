/**
 * Boundary token non-persistence + guard tests (ADR 0003, MED-1): a fresh launch
 * produces a new token; the token is never written to disk; a request with a wrong or
 * absent token is rejected (401/403) and a request with the correct token is accepted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkClientToken,
  createService,
  generateClientToken,
  startService,
  verifyClientToken,
  WeakClientTokenError,
} from "../src/index.js";

const SERVICE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

test("generateClientToken yields unique 256-bit hex tokens", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const token = generateClientToken();
    assert.match(token, /^[0-9a-f]{64}$/, "token must be 64 hex chars (256 bits)");
    assert.equal(seen.has(token), false, "tokens must be unique per launch");
    seen.add(token);
  }
});

test("checkClientToken classifies missing / invalid / ok", () => {
  const token = generateClientToken();
  assert.equal(checkClientToken(token, undefined), "missing");
  assert.equal(checkClientToken(token, ""), "invalid");
  assert.equal(checkClientToken(token, "deadbeef"), "invalid");
  assert.equal(checkClientToken(token, token), "ok");
  assert.equal(verifyClientToken(token, token), true);
  assert.equal(verifyClientToken(token, token + "x"), false);
});

test("an empty/too-short configured token is rejected (fail-closed footgun guard)", () => {
  assert.throws(() => createService({ clientToken: "" }), WeakClientTokenError);
  assert.throws(() => createService({ clientToken: "short" }), WeakClientTokenError);
  // A sufficiently long explicit token is accepted.
  const svc = createService({ clientToken: "a".repeat(32) });
  assert.equal(svc.clientToken, "a".repeat(32));
});

test("each fresh launch produces a new, distinct token", async () => {
  const a = await startService();
  const b = await startService();
  try {
    assert.notEqual(a.clientToken, b.clientToken, "two launches must differ");
    assert.match(a.clientToken, /^[0-9a-f]{64}$/);
    assert.match(b.clientToken, /^[0-9a-f]{64}$/);
  } finally {
    await a.service.stop();
    await b.service.stop();
  }
});

test("wrong/absent token is rejected; correct token is accepted", async () => {
  const running = await startService();
  const url = `${running.baseUrl}/v1/health`;
  try {
    // Absent token -> 401 unauthorized.
    const noAuth = await fetch(url);
    assert.equal(noAuth.status, 401);
    const noAuthBody = (await noAuth.json()) as { ok: boolean; error: { code: string } };
    assert.equal(noAuthBody.ok, false);
    assert.equal(noAuthBody.error.code, "unauthorized");

    // Wrong token -> 403 forbidden.
    const wrong = await fetch(url, { headers: { authorization: "Bearer not-the-token" } });
    assert.equal(wrong.status, 403);
    const wrongBody = (await wrong.json()) as { ok: boolean; error: { code: string } };
    assert.equal(wrongBody.ok, false);
    assert.equal(wrongBody.error.code, "forbidden");

    // Correct token -> 200 ok.
    const good = await fetch(url, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(good.status, 200);
    const goodBody = (await good.json()) as { ok: boolean; data: { status: string } };
    assert.equal(goodBody.ok, true);
    assert.equal(goodBody.data.status, "ok");

    // Typed client path also succeeds.
    const health = await running.client.health();
    assert.equal(health.status, "ok");
    assert.equal(health.service, "cowork-ghc-local-service");
  } finally {
    await running.service.stop();
  }
});

test("the live token is never written to disk by the service", async () => {
  const running = await startService();
  try {
    const token = running.clientToken;
    // Exercise a full request cycle, then assert the token appears in NO file the
    // service package controls (source tree + any dist output).
    await running.client.health();
    const hit = await findStringInTree(SERVICE_DIR, token, [
      "node_modules",
      ".git",
    ]);
    assert.equal(hit, undefined, `token must not be persisted; found in ${hit}`);
  } finally {
    await running.service.stop();
  }
});

/** Recursively search a directory tree for `needle`; return the first file path or undefined. */
async function findStringInTree(
  root: string,
  needle: string,
  skipDirs: readonly string[],
): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      const found = await findStringInTree(full, needle, skipDirs);
      if (found) return found;
    } else if (entry.isFile()) {
      const info = await stat(full);
      if (info.size > 2 * 1024 * 1024) continue; // skip large/binary files
      const content = await readFile(full, "utf8").catch(() => "");
      if (content.includes(needle)) return full;
    }
  }
  return undefined;
}
