/**
 * CGHC-028 Slice 5A — permission.asked → ToolPermissionProxy bridge tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionReply } from "@cowork-ghc/contracts";
import { createPermissionBridge } from "../src/runtime/permission-bridge.js";
import { createPermissionGate } from "../src/permission/index.js";
import { createInMemoryAuditSink, createNodeScheduler } from "../src/permission/index.js";
import { ToolPermissionProxy } from "../src/files/index.js";
import { createWorkspaceGuard, grantWorkspace } from "../src/workspace/index.js";

function bridgeFixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cghc-perm-bridge-")));
  const captured: PermissionReply[] = [];
  const gate = createPermissionGate({
    reply: { reply: async (r) => { captured.push(r); } },
    audit: createInMemoryAuditSink(),
    session: { denySession: () => {} },
    scheduler: createNodeScheduler(),
    timeoutMs: 60_000,
    now: () => "2026-07-12T00:00:00.000Z",
  });
  const proxy = new ToolPermissionProxy({
    guard: createWorkspaceGuard(grantWorkspace({ rootPath: dir })),
    gate,
    reply: { reply: async (r) => { captured.push(r); } },
    now: () => "2026-07-12T00:00:00.000Z",
  });
  const bridge = createPermissionBridge({ proxy, workspaceRoot: dir });
  return { dir, gate, bridge, captured };
}

test("permission.asked submits a pending request with confined target path", async () => {
  const fx = bridgeFixture();
  try {
    await fx.bridge.handleFrame({
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "sess-1",
        permission: "edit",
        tool: "write",
        patterns: [join(fx.dir, "note.txt")],
        metadata: { filepath: join(fx.dir, "note.txt") },
      },
    });
    const pending = fx.gate.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.requestId, "perm-1");
    assert.equal(pending[0]?.action.kind, "file_create");
    assert.ok(pending[0]?.action.targetPath?.includes("note.txt"));
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("permission group is used only as a fallback when runtime tool is absent", async () => {
  const fx = bridgeFixture();
  try {
    await fx.bridge.handleFrame({
      type: "permission.asked",
      properties: {
        id: "perm-fallback",
        sessionID: "sess-fallback",
        permission: "edit",
        metadata: { filepath: join(fx.dir, "fallback.txt") },
      },
    });
    assert.equal(fx.gate.pending()[0]?.action.kind, "file_edit");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("duplicate permission.asked for the same id is ignored", async () => {
  const fx = bridgeFixture();
  try {
    const frame = {
      type: "permission.asked",
      properties: {
        id: "perm-dup",
        sessionID: "sess-dup",
        permission: "edit",
        metadata: { filepath: join(fx.dir, "dup.txt") },
      },
    };
    await fx.bridge.handleFrame(frame);
    await fx.bridge.handleFrame(frame);
    assert.equal(fx.gate.pending().length, 1);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("non-permission frames are ignored", async () => {
  const fx = bridgeFixture();
  try {
    await fx.bridge.handleFrame({ type: "session.idle", properties: { sessionID: "x" } });
    assert.equal(fx.gate.pending().length, 0);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
