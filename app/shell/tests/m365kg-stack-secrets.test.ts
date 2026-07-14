/**
 * ADR 0010 remaining work — M365KG stack secret generation/persistence. Covers the property that
 * matters most for `M365KGStackInitializer`'s idempotency guard: the SAME secrets must come back
 * on every call for a given `runtimeRoot`, never a fresh (and therefore mismatched-with-the-
 * already-initialized-cluster) password on a later relaunch.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadOrCreateM365KGStackSecrets } from "../src/service/m365kg-stack-secrets.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-m365kg-secrets-"));
}

test("first call generates + persists secrets; a second call on the same root returns the SAME secrets", async () => {
  const root = tempRoot();
  const first = await loadOrCreateM365KGStackSecrets({ runtimeRoot: root });
  assert.ok(first.pgPassword.length >= 32);
  assert.ok(first.jwtSecret.length >= 32);

  const second = await loadOrCreateM365KGStackSecrets({ runtimeRoot: root });
  assert.deepEqual(second, first, "relaunching must reuse the exact same secrets, not regenerate them");

  rmSync(root, { recursive: true, force: true });
});

test("persists to .runtime/m365kg-secrets.json with restrictive (owner-only) file mode", async () => {
  const root = tempRoot();
  await loadOrCreateM365KGStackSecrets({ runtimeRoot: root });
  const path = join(root, ".runtime", "m365kg-secrets.json");
  const stat = statSync(path);
  // Only meaningful on POSIX; still asserted since the test suite runs on Linux/macOS.
  assert.equal(stat.mode & 0o777, 0o600);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(typeof parsed.pgPassword, "string");
  assert.equal(typeof parsed.jwtSecret, "string");

  rmSync(root, { recursive: true, force: true });
});

test("a malformed existing secrets file is replaced with a freshly generated, well-formed one", async () => {
  const root = tempRoot();
  mkdirSync(join(root, ".runtime"), { recursive: true });
  writeFileSync(join(root, ".runtime", "m365kg-secrets.json"), '{"pgPassword": ""}', "utf8");

  const secrets = await loadOrCreateM365KGStackSecrets({ runtimeRoot: root });
  assert.ok(secrets.pgPassword.length > 0);
  assert.ok(secrets.jwtSecret.length > 0);

  rmSync(root, { recursive: true, force: true });
});

test("uses the injected randomBytes seam when provided (deterministic in tests)", async () => {
  const root = tempRoot();
  const fixed = Buffer.from("ab".repeat(32), "hex");
  const secrets = await loadOrCreateM365KGStackSecrets({ runtimeRoot: root, randomBytes: (size) => fixed.subarray(0, size) });
  assert.equal(secrets.pgPassword, fixed.subarray(0, 24).toString("hex"));
  assert.equal(secrets.jwtSecret, fixed.subarray(0, 32).toString("hex"));

  rmSync(root, { recursive: true, force: true });
});
