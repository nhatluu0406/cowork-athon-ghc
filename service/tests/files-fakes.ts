/**
 * Shared fakes/harness for the CGHC-018 file-mutation tests. Uses a REAL temp workspace for
 * on-disk assertions and the in-memory permission fakes (recording reply port, virtual time)
 * so nothing here touches a live runtime/LLM. Not a `*.test.ts` file — the runner ignores it.
 */

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PermissionActionKind, PermissionScope } from "@cowork-ghc/contracts";
import {
  createInMemoryAuditSink,
  createPermissionGate,
  createPermissionRequest,
  type InMemoryAuditSink,
  type PermissionGate,
} from "../src/permission/index.js";
import type { WorkspaceAuditEvent } from "../src/workspace/index.js";
import { createWorkspaceGuard, grantWorkspace, type WorkspaceGuard } from "../src/workspace/index.js";
import { FileService, ToolPermissionProxy } from "../src/files/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

export const FILES_NOW = "2026-07-11T00:00:00.000Z";

export interface FilesHarness {
  readonly root: string;
  readonly guard: WorkspaceGuard;
  readonly gate: PermissionGate;
  readonly service: FileService;
  readonly proxy: ToolPermissionProxy;
  readonly permissionAudit: InMemoryAuditSink;
  readonly workspaceAudit: readonly WorkspaceAuditEvent[];
  readonly reply: ReturnType<typeof recordingReplyPort>;
  /** Submit a request to the gate and resolve it Allow (records an Allow the service can consume). */
  approve(requestId: string, kind: PermissionActionKind, targetPath: string, scope?: PermissionScope): Promise<void>;
  /** Submit a request and resolve it Deny. */
  deny(requestId: string, kind: PermissionActionKind, targetPath: string): Promise<void>;
  /** Submit a request but leave it PENDING (unapproved). */
  submitPending(requestId: string, kind: PermissionActionKind, targetPath: string): void;
}

export async function makeFilesHarness(): Promise<FilesHarness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cghc-files-"));
  const grant = grantWorkspace({ rootPath: root });
  const workspaceAudit: WorkspaceAuditEvent[] = [];
  const guard = createWorkspaceGuard(grant, { audit: (e) => workspaceAudit.push(e) });

  const reply = recordingReplyPort();
  const permissionAudit = createInMemoryAuditSink();
  const time = createFakeTime();
  const gate = createPermissionGate({
    reply,
    audit: permissionAudit,
    session: recordingDenialSink(),
    scheduler: time.scheduler,
    timeoutMs: 30_000,
    now: time.now,
  });

  const service = new FileService({ guard, gate });
  const proxy = new ToolPermissionProxy({ guard, gate, reply, now: () => FILES_NOW });

  function submit(requestId: string, kind: PermissionActionKind, targetPath: string): void {
    gate.submit(
      createPermissionRequest({
        requestId,
        sessionId: "sess-files",
        action: { kind, targetPath, description: `${kind} ${path.basename(targetPath)}` },
        requestedAt: FILES_NOW,
      }),
    );
  }

  return {
    root,
    guard,
    gate,
    service,
    proxy,
    permissionAudit,
    workspaceAudit,
    reply,
    async approve(requestId, kind, targetPath, scope) {
      submit(requestId, kind, targetPath);
      await gate.resolve({ requestId, decision: "allow", ...(scope !== undefined ? { scope } : {}) });
    },
    async deny(requestId, kind, targetPath) {
      submit(requestId, kind, targetPath);
      await gate.resolve({ requestId, decision: "deny" });
    },
    submitPending: submit,
  };
}
