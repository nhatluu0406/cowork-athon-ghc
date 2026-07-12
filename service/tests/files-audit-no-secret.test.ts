/**
 * CGHC-018 — the local audit trail carries NO secret (P5).
 *
 * Every Allow, Deny, and path-rejection is recorded, but a secret-shaped value placed in the
 * free-form action description (the realistic leak vector) must NEVER reach either the permission
 * audit sink or the workspace audit sink. The structured audit records only stable, non-secret
 * fields (ids, action kind, path, decision) — proven by serializing BOTH stores and asserting the
 * secret is absent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createPermissionRequest } from "../src/permission/index.js";
import { makeFilesHarness } from "./files-fakes.js";

const SECRET = "sk-live-DEADBEEF0123456789supersecretkey";

test("P5: allow + deny + rejection are all audited, and no store contains the secret", async () => {
  const h = await makeFilesHarness();

  // 1) An Allow whose free-form description carries a secret-shaped string.
  h.gate.submit(
    createPermissionRequest({
      requestId: "a-allow",
      sessionId: "sess-files",
      action: { kind: "file_create", targetPath: path.join(h.root, "x.txt"), description: `token ${SECRET}` },
      requestedAt: "2026-07-11T00:00:00.000Z",
    }),
  );
  await h.gate.resolve({ requestId: "a-allow", decision: "allow" });

  // 2) A Deny whose description also carries the secret.
  h.gate.submit(
    createPermissionRequest({
      requestId: "a-deny",
      sessionId: "sess-files",
      action: { kind: "command_exec", description: `run ${SECRET}` },
      requestedAt: "2026-07-11T00:00:00.000Z",
    }),
  );
  await h.gate.resolve({ requestId: "a-deny", decision: "deny" });

  // 3) A path rejection through the proxy (recorded on the workspace audit sink).
  await h.proxy.handle({ requestId: "a-esc", sessionId: "sess-files", tool: "edit", path: "../outside/plain.txt" });

  // Both stores recorded events...
  assert.equal(h.permissionAudit.size(), 2, "one audit per Allow AND per Deny");
  assert.ok(h.workspaceAudit.length >= 1, "the path rejection was recorded");

  // ...and NEITHER store leaked the secret.
  const serialized = JSON.stringify(h.permissionAudit.events()) + JSON.stringify(h.workspaceAudit);
  assert.equal(serialized.includes(SECRET), false, "no secret-shaped value in any audit record");
});
