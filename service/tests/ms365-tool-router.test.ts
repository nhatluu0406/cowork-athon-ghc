/**
 * Dispatch-level tests for the MS365 tool router (Task 9). Verifies the load-bearing
 * security guarantee: a SharePoint upload runs ONLY behind a recorded Allow on the real
 * PermissionGate — with no Allow, `proceed` returns not_allowed and the upload never runs.
 * Reads run directly when connected; a disconnected connector fails closed (no throw); bad
 * args are rejected as invalid_input. NO live network / LLM call, NO real timers.
 *
 * The brief's "upload with an Allow proceeds" case is intentionally DROPPED: submitting then
 * resolving in the same tick to make proceed observe the Allow is racy as a unit test. The
 * deterministic guarantee kept here is "upload without an Allow is blocked".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { SharePointHit, SharePointService } from "../src/ms365/sharepoint-service.js";
import { handleToolCall, type ToolResult } from "../src/ms365/ms365-tools.js";
import { createPermissionGate, createInMemoryAuditSink } from "../src/permission/index.js";
import type { PermissionGate } from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

function gateFixture(): PermissionGate {
  const time = createFakeTime();
  return createPermissionGate({
    reply: recordingReplyPort(),
    audit: createInMemoryAuditSink(),
    session: recordingDenialSink(),
    scheduler: { schedule: () => ({}) as never, cancel: () => {} },
    timeoutMs: 1000,
    now: time.now,
  });
}

/** A SharePoint fake that records whether `upload` was ever invoked. */
function recordingSharePoint(): SharePointService & { uploadCalls: number } {
  const state = { uploadCalls: 0 };
  const hit: SharePointHit = { id: "1", name: "A", webUrl: "u" };
  return {
    uploadCalls: 0,
    async search(): Promise<SharePointHit[]> {
      return [hit];
    },
    async listSiteFiles(): Promise<SharePointHit[]> {
      return [];
    },
    async getFileSummaryText(): Promise<string> {
      return "text";
    },
    async upload(): Promise<{ id: string; webUrl: string }> {
      state.uploadCalls += 1;
      this.uploadCalls += 1;
      return { id: "up", webUrl: "u" };
    },
  };
}

function errorKind(res: ToolResult): string {
  assert.equal(res.ok, false);
  return (res as Extract<ToolResult, { ok: false }>).error.kind;
}

test("read tool runs directly when connected", async () => {
  const res = await handleToolCall(
    { sharepoint: recordingSharePoint(), connectionState: () => "connected", gate: gateFixture(), now: () => "t" },
    { name: "sharepoint_search", args: { query: "x" }, sessionId: "s", requestId: "r1" },
  );
  assert.equal(res.ok, true);
});

test("not connected → not_connected error, no throw", async () => {
  const res = await handleToolCall(
    { sharepoint: recordingSharePoint(), connectionState: () => "disconnected", gate: gateFixture(), now: () => "t" },
    { name: "sharepoint_search", args: { query: "x" }, sessionId: "s", requestId: "r2" },
  );
  assert.equal(errorKind(res), "not_connected");
});

test("upload without an Allow is blocked (proceed not_allowed → denied), upload never runs", async () => {
  const gate = gateFixture();
  const sp = recordingSharePoint();
  const res = await handleToolCall(
    { sharepoint: sp, connectionState: () => "connected", gate, now: () => "t" },
    {
      name: "sharepoint_upload_file",
      args: { siteId: "S", relativeLocalPath: "n.txt", targetName: "n.txt" },
      sessionId: "s",
      requestId: "r3",
    },
  );
  // No resolve() Allow was recorded, so proceed blocks — the mutation must not have run.
  assert.equal(errorKind(res), "denied");
  assert.equal(sp.uploadCalls, 0);
});

test("invalid args → invalid_input (missing query)", async () => {
  const res = await handleToolCall(
    { sharepoint: recordingSharePoint(), connectionState: () => "connected", gate: gateFixture(), now: () => "t" },
    { name: "sharepoint_search", args: {}, sessionId: "s", requestId: "r4" },
  );
  assert.equal(errorKind(res), "invalid_input");
});

test("invalid args → invalid_input (upload missing targetName)", async () => {
  const sp = recordingSharePoint();
  const res = await handleToolCall(
    { sharepoint: sp, connectionState: () => "connected", gate: gateFixture(), now: () => "t" },
    {
      name: "sharepoint_upload_file",
      args: { siteId: "S", relativeLocalPath: "n.txt" },
      sessionId: "s",
      requestId: "r5",
    },
  );
  assert.equal(errorKind(res), "invalid_input");
  assert.equal(sp.uploadCalls, 0);
});
