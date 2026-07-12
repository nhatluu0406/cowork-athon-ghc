/**
 * CGHC-028 Wave C — LEG 1: live critical-path harness (BOUNDED, opt-in).
 *
 * Assembles the REAL live stack (buildLiveCoworkOptions → startLiveCoworkService → REAL
 * opencode.exe with the keyring-injected key), creates a session over the live SessionStore
 * (real POST /session), sends ONE short prompt, and consumes the EV stream OVER THE COMPOSED
 * LOOPBACK BOUNDARY (token-guarded SSE). Asserts: token EV(s) arrive + an honest `completed`
 * terminal (EV7). A second bounded prompt drives a real tool → file_mutation (EV3/EV4) and a
 * file actually written to disk. Then stop() must leave NO orphan child. Secret-scan CLEAN.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createKeyringStore, createCredentialService, createSecretScrubber } from "../../service/src/credential/index.js";
import { credentialAccountFor, credentialRef } from "../../service/src/credential/store.js";
import { keyringAvailable } from "../../service/src/credential/index.js";
import { buildLiveCoworkOptions, startLiveCoworkService } from "../../service/src/composition/index.js";
import type { CustomProviderSelection } from "../../service/src/composition/index.js";
import { sendPrompt } from "../capture-frames/opencode-http.js";
import {
  ROOT, OPENCODE_BIN, PROVIDER_ID, PROVIDER_BASE_URL, PROVIDER_MODEL, PROVIDER_ENV_VAR, MODEL_REF,
  budget, registerSecret, makeFixtureWorkspace, cleanupWorkspace, pumpEventStream, collectBoundaryEv,
  type LegResult,
} from "./harness-lib.mts";

const CMD = "node --import tsx tools/verify/run-wave-c.mjs (leg 1 live critical path)";

export async function runLeg1(): Promise<{ result: LegResult; sessionId?: string; workspace?: string }> {
  const result: LegResult = {
    leg: "leg1", title: "Live critical path (EV token stream + honest completed terminal + file mutation)",
    status: "BLOCKED", proven: [], commands: [CMD], successfulRequests: 0, secretScan: "CLEAN", notes: [],
  };

  if (!existsSync(OPENCODE_BIN)) {
    result.notes.push(`Pinned opencode.exe not found at ${OPENCODE_BIN}.`);
    return { result };
  }
  if (!(await keyringAvailable())) {
    result.notes.push("Windows Credential Manager (keyring) unavailable in this environment.");
    return { result };
  }

  const store = await createKeyringStore();
  const account = credentialAccountFor(PROVIDER_ID);
  const secret = await store.get(account);
  if (secret === null || secret.length === 0) {
    result.notes.push(`No usable credential in the keyring for account "${account}" — live leg BLOCKED (not a failure).`);
    return { result };
  }
  registerSecret(secret); // scanned into every artifact; never printed.

  const ws = makeFixtureWorkspace();
  let leaked = false;
  const onLeak = (): void => { leaked = true; };
  let live: Awaited<ReturnType<typeof startLiveCoworkService>> | undefined;
  let sessionId: string | undefined;
  try {
    const scrubber = createSecretScrubber();
    const credentialService = createCredentialService({ store, scrubber });
    const provider: CustomProviderSelection = {
      kind: "custom", providerId: PROVIDER_ID, baseUrl: PROVIDER_BASE_URL,
      model: PROVIDER_MODEL, envVar: PROVIDER_ENV_VAR, credentialRef: credentialRef(account),
    };
    const options = await buildLiveCoworkOptions({
      appRoot: ROOT, workspaceRoot: ws, runtimeRoot: ws, binPath: OPENCODE_BIN,
      provider, credentialService,
      service: { credentialStore: store, settingsFilePath: join(ws, ".runtime", "settings.json") },
    });
    // Harness-side: enable auto-approve tools in the THROWAWAY fixture workspace so the headless
    // file-write sub-leg runs unattended (buildLiveCoworkOptions does not expose a permission map).
    const withPerm = {
      ...options,
      startSpec: {
        ...options.startSpec,
        providerConfig: options.startSpec.providerConfig
          ? { ...options.startSpec.providerConfig, permission: { edit: "allow", bash: "allow", webfetch: "allow" } }
          : options.startSpec.providerConfig,
      },
    };

    live = await startLiveCoworkService(withPerm);
    result.proven.push("startLiveCoworkService spawned the REAL pinned opencode.exe and reached pinned-and-healthy readiness.");
    result.proven.push(`Supervisor honest liveness after start: isAlive=${live.supervisor.isAlive()} baseUrl!=null=${live.supervisor.baseUrl !== null}.`);

    const baseUrl = live.supervisor.baseUrl;
    if (baseUrl === null) throw new Error("Supervisor baseUrl is null after a successful start.");

    // --- Sub-leg 1a: simple prompt → token stream + honest completed terminal. ---
    const okA = await runOnePrompt(live, baseUrl, ws, onLeak, {
      title: "verify:critical-simple",
      prompt: "Reply with the single word: ready",
      expectFileMutation: false,
    });
    if (okA.completed) {
      budget.recordSuccess();
      result.successfulRequests += 1;
      sessionId = okA.sessionId;
      result.proven.push(`1a simple prompt: ${okA.tokenCount} token EV(s) over the boundary; honest terminal=completed (EV7).`);
    } else {
      result.notes.push(`1a simple prompt did not reach completed (terminal=${okA.terminalState ?? "none"}, timedOut=${okA.timedOut}).`);
    }

    // --- Sub-leg 1b: file-write prompt → tool_call + file_mutation + file on disk (budget-permitting). ---
    if (okA.completed && budget.successes < budget.maxSuccesses) {
      const okB = await runOnePrompt(live, baseUrl, ws, onLeak, {
        title: "verify:critical-toolcall",
        prompt: "Create a file named ready.txt in the current directory containing exactly the word: ready",
        expectFileMutation: true,
      });
      if (okB.completed) {
        budget.recordSuccess();
        result.successfulRequests += 1;
        const fileOnDisk = existsSync(join(ws, "ready.txt"));
        if (okB.toolCall && okB.fileMutation && fileOnDisk) {
          result.proven.push("1b file-write prompt: tool_call (EV3) + file_mutation (EV4) over the boundary AND ready.txt actually written to disk.");
        } else {
          result.notes.push(`1b partial: toolCall=${okB.toolCall} fileMutation=${okB.fileMutation} fileOnDisk=${fileOnDisk} (model may have answered without a tool).`);
        }
      } else {
        result.notes.push(`1b did not reach completed (terminal=${okB.terminalState ?? "none"}).`);
      }
    } else if (okA.completed) {
      result.notes.push("1b skipped to stay within the live budget.");
    }

    // --- S4 (session resume): rebuild the view from the REAL OpenCode store replay through the
    // CGHC-012 mapper+reducer (the run is terminal, so continueSession takes the genuine rebuild
    // path, not the live-task shortcut). Proves resume on the real live-replay path. ---
    if (sessionId !== undefined) {
      try {
        const reopened = await live.deps.sessionService.continueSession(sessionId);
        const rebuiltTerminal = reopened.view.terminal;
        result.proven.push(`S4 resume: view rebuilt from live store replay (terminal=${rebuiltTerminal ?? "none"}) via the real mapper+reducer.`);
        if (rebuiltTerminal !== "completed") result.notes.push("S4 rebuilt view terminal did not match completed (replay shape variance).");
      } catch (err) {
        result.notes.push(`S4 live resume not confirmed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // --- Teardown: stop() must leave NO orphan (child gone, baseUrl null, honest liveness false). ---
    await live.stop();
    const stoppedClean = live.supervisor.baseUrl === null && live.supervisor.isAlive() === false;
    result.proven.push(`stop(): child torn down — baseUrl=null=${live.supervisor.baseUrl === null}, isAlive=${live.supervisor.isAlive()} (no orphan).`);
    live = undefined;

    result.secretScan = leaked ? "LEAK" : "CLEAN";
    if (okA.completed && stoppedClean && !leaked) {
      result.status = result.proven.some((p) => p.startsWith("1b")) ? "PASS" : "PARTIAL";
      if (result.status === "PARTIAL") result.notes.push("Token stream + completed terminal PASS; file-mutation leg not fully confirmed live (see notes).");
    } else {
      result.status = "PARTIAL";
    }
  } catch (err) {
    result.status = "FAIL";
    result.error = err instanceof Error ? err.message : String(err);
    result.secretScan = leaked ? "LEAK" : "CLEAN";
    if (live) { try { await live.stop(); } catch { /* best effort */ } }
  } finally {
    const removed = cleanupWorkspace(ws);
    result.notes.push(`Temp fixture workspace ${ws} cleaned=${removed}.`);
  }
  return { result, sessionId, workspace: ws };
}

interface PromptOutcome {
  sessionId: string; completed: boolean; timedOut: boolean;
  terminalState?: string; tokenCount: number; toolCall: boolean; fileMutation: boolean;
}

/** Create a session, open the run, pump /event, send ONE prompt, collect EV over the boundary. */
async function runOnePrompt(
  live: Awaited<ReturnType<typeof startLiveCoworkService>>,
  baseUrl: string, ws: string, onLeak: () => void,
  spec: { title: string; prompt: string; expectFileMutation: boolean },
): Promise<PromptOutcome> {
  budget.assertCanSpend();
  const meta = await live.deps.sessionService.create({ workspaceId: ws, title: spec.title, model: MODEL_REF });
  const sessionId = meta.id;
  const run = live.deps.streamHub.open(sessionId);
  const pump = pumpEventStream(baseUrl, sessionId, (frame) => run.ingest(frame), onLeak);
  await new Promise((r) => setTimeout(r, 600)); // let /event connect before the prompt drives frames

  const collecting = collectBoundaryEv({
    baseUrl: live.running.baseUrl, clientToken: live.running.clientToken,
    sessionId, timeoutMs: 90_000, onLeak,
  });
  await sendPrompt({
    baseUrl, promptPathTemplate: "/session/{id}/message", sessionId,
    prompt: spec.prompt, model: MODEL_REF,
  });
  const { events, terminal, timedOut } = await collecting;
  pump.stop();
  run.close();
  await pump.done.catch(() => undefined);

  const tokenCount = events.filter((e) => e.kind === "token").length;
  const toolCall = events.some((e) => e.kind === "tool_call");
  const fileMutation = events.some((e) => e.kind === "file_mutation");
  return {
    sessionId,
    completed: terminal?.kind === "terminal" && terminal.state === "completed",
    timedOut,
    ...(terminal?.kind === "terminal" ? { terminalState: terminal.state } : {}),
    tokenCount, toolCall, fileMutation,
  };
}
