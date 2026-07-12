/**
 * CGHC-028 Wave C — LEG 3: template re-run (RE4) + session resume (S4). NO live provider needed.
 *
 * RE4: exercise the extensions template registry save→re-run AT THE SERVICE LAYER (through the
 * composed `createCoworkService` deps.extensions, proving it is wired into the composition root).
 * S4: prove session resume by creating a session in a fake store, "restarting", and reopening so
 * the authoritative view is rebuilt purely from the store's replayed frames through the real
 * CGHC-012 mapper+reducer (the same code the live path used in leg 1). This is the deterministic
 * belt-and-suspenders for the live S4 proof leg 1 also exercised.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryStore } from "../../service/src/credential/index.js";
import { createCoworkService } from "../../service/src/composition/index.js";
import { createSessionService } from "../../service/src/session/index.js";
import type { LegResult } from "./harness-lib.mts";

export async function runLeg3(): Promise<LegResult> {
  const result: LegResult = {
    leg: "leg3", title: "Template re-run (RE4) + session resume (S4) — service layer, no live provider",
    status: "FAIL", proven: [], commands: ["node --import tsx tools/verify/run-wave-c.mjs (leg 3)"],
    successfulRequests: 0, secretScan: "CLEAN", notes: [],
  };

  try {
    // --- RE4: save→re-run a template through the COMPOSED service deps.extensions. ---
    const composed = await createCoworkService({
      credentialStore: createMemoryStore(),
      settingsFilePath: join(tmpdir(), `cghc-wavec-settings-${Date.now()}.json`),
    });
    const templates = composed.deps.extensions.templates;
    const saved = templates.save({
      id: "greet-file",
      name: "Greet + write file",
      inputs: [{ name: "who", required: true }, { name: "fname", required: false }],
      // Param values that are a WHOLE `${input.NAME}` reference are resolved from inputs; a literal
      // value passes through unchanged (the registry resolves whole-value references, per RE4).
      steps: [
        { id: "s1", action: "prompt", params: { target: "${input.who}", tone: "friendly" } },
        { id: "s2", action: "write", params: { path: "${input.fname}", content: "${input.who}" } },
      ],
    });
    if (!saved.ok) throw new Error(`template save failed: ${saved.error.code}`);

    const run1 = await templates.run("greet-file", { who: "Nhat", fname: "out.txt" });
    const run2 = await templates.run("greet-file", { who: "Nhat", fname: "out.txt" });
    const missing = await templates.run("greet-file", {}); // missing required input → clean typed error

    const run1Ok = run1.ok && run1.value[0]?.params.target === "Nhat" && run1.value[0]?.params.tone === "friendly" &&
      run1.value[1]?.params.path === "out.txt" && run1.value[1]?.params.content === "Nhat";
    const repeatable = run1.ok && run2.ok && JSON.stringify(run1.value) === JSON.stringify(run2.value);
    const missingClean = !missing.ok && missing.error.code === "invalid_input";

    if (run1Ok && repeatable && missingClean) {
      result.proven.push("RE4: template save→re-run through composed deps.extensions resolves ${input.*} deterministically (repeatable), and a missing required input is a CLEAN invalid_input error (not a throw/quarantine).");
    } else {
      throw new Error(`RE4 assertions failed: run1Ok=${run1Ok} repeatable=${repeatable} missingClean=${missingClean}`);
    }

    // --- S4: rebuild a session view from a fake store's replay through the real mapper+reducer. ---
    // A minimal fake OpenCode store: create() records id/title; replay() returns raw
    // `message.part.updated` frames (the exact shape the live session-store-adapter synthesizes),
    // so continueSession rebuilds the view via the real CGHC-012 mapper — no fabricated logic.
    // A COMPLETED file-write tool part — the mapper folds this into tool_call (EV3) + file_mutation
    // (EV4) on replay (a `text` part is intentionally not tokenized on replay — S2 tokens flow from
    // `message.part.delta`), so it is the reliable content to prove the rebuild.
    const partFrames: unknown[] = [
      { type: "message.part.updated", properties: { sessionID: "s-1", part: {
        type: "tool", tool: "write", callID: "c1",
        state: { status: "completed", input: { filePath: "notes.txt" } },
      } } },
    ];
    const fakeStore = {
      create: async (input: { title?: string; workspaceId: string }) => ({
        id: "s-1", title: input.title ?? "Untitled", workspaceId: input.workspaceId,
        createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z",
      }),
      list: async () => [{ id: "s-1", title: "resume-me", workspaceId: "ws", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" }],
      get: async (id: string) => (id === "s-1"
        ? { id: "s-1", title: "resume-me", workspaceId: "ws", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" }
        : undefined),
      rename: async (id: string, title: string) => ({ id, title, workspaceId: "ws", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" }),
      replay: async () => partFrames,
    };
    const health = { isAlive: () => true };
    const canceller = { cancel: async () => undefined };

    // "First run": create + register the live view.
    const svc1 = createSessionService({ store: fakeStore as never, health, canceller });
    const created = await svc1.create({ workspaceId: "ws", title: "resume-me" });

    // "After restart": a FRESH service instance holds no in-memory view — continueSession MUST
    // rebuild it from the store's replayed frames (the genuine S4 resume path).
    const svc2 = createSessionService({ store: fakeStore as never, health, canceller });
    const beforeReopen = svc2.view(created.id); // undefined: nothing in memory yet
    const reopened = await svc2.continueSession(created.id);
    const rebuiltHasContent = reopened.view.fileMutations.length > 0 && reopened.view.toolCalls.length > 0;

    if (beforeReopen === undefined && reopened.view !== undefined && rebuiltHasContent) {
      result.proven.push(`S4: after a simulated restart the view was rebuilt from store replay through the real mapper+reducer (had-in-memory-before=${beforeReopen !== undefined}, rebuilt toolCalls=${reopened.view.toolCalls.length} fileMutations=${reopened.view.fileMutations.length}).`);
      result.status = "PASS";
    } else {
      result.status = "PARTIAL";
      result.notes.push(`S4 rebuild unexpected: beforeReopen=${beforeReopen !== undefined}, reopened=${reopened.view !== undefined}.`);
    }
  } catch (err) {
    result.status = "FAIL";
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
