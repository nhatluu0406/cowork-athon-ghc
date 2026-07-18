/**
 * CGHC-018 — OpenCode tool-permission proxy: no-escape + submit-to-gate (F1 boundary, P4/P5).
 *
 * Proves a tool-permission event whose target resolves outside the workspace (via `..` or a
 * symlink) is REFUSED before any disk change and recorded via the workspace audit sink, and that
 * a legitimate event is submitted to the gate with a boundary-recomputed approval level. A REAL
 * temp workspace with a REAL sibling "outside" dir is used; the outside secret is never touched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceGuard, grantWorkspace, type WorkspaceAuditEvent } from "../src/workspace/index.js";
import {
  createPermissionGate,
  createInMemoryAuditSink,
} from "../src/permission/index.js";
import { ToolPermissionProxy } from "../src/files/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

interface Fixture {
  readonly root: string;
  readonly outsideDir: string;
  readonly secretFile: string;
  readonly secretText: string;
  readonly proxy: ToolPermissionProxy;
  readonly gate: ReturnType<typeof createPermissionGate>;
  readonly reply: ReturnType<typeof recordingReplyPort>;
  readonly workspaceAudit: readonly WorkspaceAuditEvent[];
}

async function makeFixture(): Promise<Fixture> {
  const base = await mkdtemp(path.join(os.tmpdir(), "cghc-proxy-"));
  const root = path.join(base, "workspace");
  const outsideDir = path.join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  const secretFile = path.join(outsideDir, "secret.txt");
  const secretText = "OUT-OF-WORKSPACE-DO-NOT-TOUCH";
  await writeFile(secretFile, secretText, "utf8");

  const workspaceAudit: WorkspaceAuditEvent[] = [];
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }), {
    audit: (e) => workspaceAudit.push(e),
  });
  const reply = recordingReplyPort();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit: createInMemoryAuditSink(),
    session: recordingDenialSink(),
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
  });
  const proxy = new ToolPermissionProxy({ guard, gate, reply, now: () => "2026-07-11T00:00:00.000Z" });
  return { root, outsideDir, secretFile, secretText, proxy, gate, reply, workspaceAudit };
}

test("no-escape: a `..` tool target is refused pre-gate, audited, and denied to the runtime", async () => {
  const fx = await makeFixture();

  const outcome = await fx.proxy.handle({
    requestId: "esc-1",
    sessionId: "s",
    tool: "edit",
    path: "../outside/secret.txt",
  });

  assert.deepEqual(outcome, { outcome: "refused", requestId: "esc-1", reason: "path_escape" });
  // No request ever reached the gate (nothing to approve → nothing can proceed).
  assert.equal(fx.gate.pending().length, 0);
  assert.equal(fx.gate.isAllowed("esc-1"), false);
  // The runtime received an explicit deny (not stranded).
  assert.deepEqual(fx.reply.replies, [{ requestId: "esc-1", decision: "deny" }]);
  // The escape was recorded via the workspace audit sink (P5).
  assert.ok(fx.workspaceAudit.some((e) => e.type === "workspace_path_rejected"));
  // The outside secret was never touched.
  assert.equal(await readFile(fx.secretFile, "utf8"), fx.secretText);
});

test("no-escape: a SYMLINK target leaving the workspace is refused by the realpath re-check", async (t) => {
  const fx = await makeFixture();
  const linkDir = path.join(fx.root, "link-out");
  try {
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(fx.outsideDir, linkDir, type);
  } catch {
    // Do NOT green-wash the load-bearing symlink-escape property (review LOW-3): if this
    // platform cannot create the link, report the test as SKIPPED (honest, visible in the
    // runner) — never fall through to an always-true assertion that reads as a pass.
    t.skip("symlink/junction creation unavailable on this platform");
    return;
  }

  // Lexically clean ("link-out/secret.txt"): only the realpath layer can catch it.
  const outcome = await fx.proxy.handle({
    requestId: "esc-2",
    sessionId: "s",
    tool: "delete",
    path: "link-out/secret.txt",
  });
  assert.equal(outcome.outcome, "refused");
  assert.equal(fx.gate.isAllowed("esc-2"), false);
  assert.ok(fx.workspaceAudit.some((e) => e.reason === "symlink_escape"));
  assert.deepEqual(fx.reply.replies, [{ requestId: "esc-2", decision: "deny" }]);
  assert.equal(await readFile(fx.secretFile, "utf8"), fx.secretText);
});

test("a legitimate write tool is submitted to the gate with a STANDARD level", async () => {
  const fx = await makeFixture();
  const outcome = await fx.proxy.handle({ requestId: "ok-1", sessionId: "s", tool: "write", path: "new.ts" });
  assert.deepEqual(outcome, { outcome: "submitted", requestId: "ok-1", actionKind: "file_create" });
  const pending = fx.gate.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.approvalLevel, "standard");
});

test("a delete tool is submitted with a boundary-recomputed ELEVATED level (P4)", async () => {
  const fx = await makeFixture();
  await fx.proxy.handle({ requestId: "ok-2", sessionId: "s", tool: "delete", path: "old.ts" });
  assert.equal(fx.gate.pending()[0]?.approvalLevel, "elevated");
});

test("an unmappable tool fails CLOSED: refused + denied, never submitted", async () => {
  const fx = await makeFixture();
  const outcome = await fx.proxy.handle({ requestId: "u-1", sessionId: "s", tool: "sudo-rm-rf", path: "x" });
  assert.deepEqual(outcome, { outcome: "refused", requestId: "u-1", reason: "unmappable_tool" });
  assert.equal(fx.gate.pending().length, 0);
  assert.deepEqual(fx.reply.replies, [{ requestId: "u-1", decision: "deny" }]);
});

test("a move tool confines BOTH ends: an escaping destination is refused", async () => {
  const fx = await makeFixture();
  const outcome = await fx.proxy.handle({
    requestId: "mv-esc",
    sessionId: "s",
    tool: "move",
    path: "inside.txt",
    destinationPath: "../outside/stolen.txt",
  });
  assert.equal(outcome.outcome, "refused");
  assert.equal(fx.gate.pending().length, 0);
});

test("webfetch to a public URL is submitted as an ELEVATED web_access with the URL in the card (#29)", async () => {
  const fx = await makeFixture();
  const outcome = await fx.proxy.handle({
    requestId: "web-1",
    sessionId: "s",
    tool: "webfetch",
    url: "https://example.com/article",
  });
  assert.deepEqual(outcome, { outcome: "submitted", requestId: "web-1", actionKind: "web_access" });
  const pending = fx.gate.pending();
  assert.equal(pending.length, 1);
  // Always elevated → always shows a card even in workspace-auto mode.
  assert.equal(pending[0]?.approvalLevel, "elevated");
  assert.match(pending[0]?.action.description ?? "", /example\.com\/article/);
  // No filesystem targetPath for a web fetch.
  assert.equal(pending[0]?.action.targetPath, undefined);
});

test("webfetch to a loopback URL is refused pre-gate (SSRF), never shown, runtime denied (#29)", async () => {
  const fx = await makeFixture();
  const outcome = await fx.proxy.handle({
    requestId: "web-ssrf",
    sessionId: "s",
    tool: "webfetch",
    url: "https://127.0.0.1/admin",
  });
  assert.deepEqual(outcome, { outcome: "refused", requestId: "web-ssrf", reason: "web_target_blocked" });
  assert.equal(fx.gate.pending().length, 0);
  assert.deepEqual(fx.reply.replies, [{ requestId: "web-ssrf", decision: "deny" }]);
});

test("webfetch with a missing/schemeless URL is refused (fail-closed, review #29)", async () => {
  const fx = await makeFixture();
  const empty = await fx.proxy.handle({ requestId: "web-empty", sessionId: "s", tool: "webfetch" });
  assert.deepEqual(empty, { outcome: "refused", requestId: "web-empty", reason: "web_target_blocked" });
  const schemeless = await fx.proxy.handle({
    requestId: "web-schemeless",
    sessionId: "s",
    tool: "webfetch",
    url: "169.254.169.254/latest/meta-data",
  });
  assert.equal(schemeless.outcome, "refused");
  assert.equal(fx.gate.pending().length, 0);
});

test("websearch surfaces the raw query on an elevated card (no SSRF host to probe, #29)", async () => {
  const fx = await makeFixture();
  const outcome = await fx.proxy.handle({
    requestId: "search-1",
    sessionId: "s",
    tool: "websearch",
    url: "latest typescript release notes",
  });
  assert.deepEqual(outcome, { outcome: "submitted", requestId: "search-1", actionKind: "web_access" });
  const pending = fx.gate.pending();
  assert.equal(pending[0]?.approvalLevel, "elevated");
  assert.match(pending[0]?.action.description ?? "", /latest typescript release notes/);
});
