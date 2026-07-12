/**
 * CGHC-013 — cancel-stops-mutation test (S3, load-bearing).
 *
 * Proves that after cancel: (1) output is stopped at the source via the provider cancel
 * seam, (2) the session reaches a terminal `cancelled` state, and (3) a further tool /
 * file-mutation frame for that task is NOT applied to the view. Point (3) is the honest
 * guarantee — the bare reducer would still append a post-terminal `file_mutation`, so the
 * registry's freeze gate is what makes S3 true.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { createSessionService } from "../src/session/index.js";
import { fakeStore, aliveHealth, recordingCanceller, FIXED_NOW } from "./session-fakes.js";

const AT = FIXED_NOW();

function ev(sessionId: string, seq: number, extra: Omit<EvEvent, "sessionId" | "seq" | "at">): EvEvent {
  return { sessionId, seq, at: AT, ...extra } as EvEvent;
}

test("cancel routes through the provider seam, goes terminal cancelled, and blocks mutation (S3)", async () => {
  const canceller = recordingCanceller();
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller,
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Cancel" });

  // A run is under way: bind its stream handle and apply some live frames.
  service.bindStream(meta.id, { id: "stream-1" });
  service.apply(meta.id, ev(meta.id, 1, { kind: "plan", todos: [{ id: "t1", title: "Do", status: "running" }] }));
  service.apply(meta.id, ev(meta.id, 2, { kind: "tool_call", callId: "c1", toolName: "write", status: "running" }));
  const beforeCancel = service.view(meta.id);
  assert.equal(beforeCancel?.status, "running");
  assert.equal(beforeCancel?.fileMutations.length, 0);

  // Cancel.
  await service.cancel(meta.id);

  // 1. Output stopped at the source — the exact in-flight handle was aborted via the seam.
  assert.deepEqual(canceller.cancelled, [{ id: "stream-1" }]);
  // 2. The session is terminal `cancelled`.
  assert.equal(service.status(meta.id), "cancelled");
  assert.equal(service.view(meta.id)?.terminal, "cancelled");

  // 3. A post-cancel tool result + file mutation for this task is NOT applied.
  service.apply(meta.id, ev(meta.id, 3, { kind: "tool_call", callId: "c1", toolName: "write", status: "completed" }));
  service.apply(meta.id, ev(meta.id, 4, { kind: "file_mutation", operation: "create", path: "should-not-exist.ts" }));
  const after = service.view(meta.id);
  assert.equal(after?.fileMutations.length, 0, "no post-cancel file mutation applied");
  assert.equal(after?.toolCalls.find((c) => c.callId === "c1")?.status, "running",
    "tool call frozen at its pre-cancel status");
  assert.equal(after?.status, "cancelled", "status stays cancelled");
});

test("a normal completed terminal ALSO freezes the task — no post-completion mutation (MEDIUM-1)", async () => {
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller: recordingCanceller(),
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "Complete" });
  service.apply(meta.id, ev(meta.id, 1, { kind: "tool_call", callId: "c1", toolName: "write", status: "running" }));
  service.apply(meta.id, ev(meta.id, 2, { kind: "terminal", state: "completed" }));
  assert.equal(service.status(meta.id), "completed");

  // A late file mutation after a NORMAL completion (not just cancel) must not be applied —
  // the registry now freezes on any terminal, not only on user cancel.
  service.apply(meta.id, ev(meta.id, 3, { kind: "file_mutation", operation: "create", path: "late.ts" }));
  assert.equal(service.view(meta.id)?.fileMutations.length, 0, "frozen on the completed terminal");
  assert.equal(service.view(meta.id)?.status, "completed");
});

test("cancel with no bound stream still reaches terminal cancelled and freezes (S3)", async () => {
  const canceller = recordingCanceller();
  const service = createSessionService({
    store: fakeStore(),
    health: aliveHealth(),
    canceller,
    now: FIXED_NOW,
  });
  const meta = await service.create({ workspaceId: "ws-1", title: "NoStream" });

  await service.cancel(meta.id);
  // No handle was bound, so nothing to abort at the source; state is still honest.
  assert.equal(canceller.cancelled.length, 0);
  assert.equal(service.status(meta.id), "cancelled");

  service.apply(meta.id, ev(meta.id, 1, { kind: "file_mutation", operation: "edit", path: "x.ts" }));
  assert.equal(service.view(meta.id)?.fileMutations.length, 0, "frozen after cancel");
});
