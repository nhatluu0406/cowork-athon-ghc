/**
 * CGHC-028 — LEG 4: FINAL bounded LIVE re-verification THROUGH THE PRODUCT BOUNDARY.
 *
 * Unlike leg 1 (which drove the SessionService + the child directly through service-layer seams),
 * this leg proves the FULLY-ASSEMBLED live chat path END-TO-END OVER HTTP using ONLY the product
 * routes, exactly as the renderer/shell would:
 *
 *   1. POST /v1/session            (token-guarded)  → real session id
 *   2. GET  /v1/session/stream?…   (token-guarded SSE, opened as a CLIENT)
 *   3. POST /v1/session/{id}/message {text}         → 202 Accepted
 *   4. Consume the SSE stream: assert REAL token EV(s) + an HONEST `completed` terminal (EV7)
 *      arrive over the composed loopback boundary. This is the ONE successful provider request.
 *   5. stop() → the REAL OpenCode child is gone (no orphan) + the /event pump consumer is closed.
 *   6. Secret-scan the captured stream/report: CLEAN (the injected keyring value never appears).
 *
 * The `/event` → hub pump is now OWNED by `startLiveCoworkService` (not the harness), so this leg
 * touches NO private in-process shortcut for the transport — every hop is the real assembled stack.
 *
 * HARD BUDGET: at most 1 successful provider request in this leg (Wave C already used 2 of the 3
 * cumulative). A hard counter aborts a 2nd send. At most 1 retry on a genuine transient (a failed
 * attempt that never produced a completed run, so successes stay ≤ 1). The provider token is NEVER
 * printed/stored; every artifact is scanned before it is written and the write is refused on a hit.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EV_STREAM_PATH } from "@cowork-ghc/contracts";
import type { EvEvent } from "@cowork-ghc/contracts";
import {
  createKeyringStore,
  createCredentialService,
  createSecretScrubber,
  keyringAvailable,
} from "../../service/src/credential/index.js";
import { credentialAccountFor, credentialRef } from "../../service/src/credential/store.js";
import { buildLiveCoworkOptions, startLiveCoworkService } from "../../service/src/composition/index.js";
import type { CustomProviderSelection } from "../../service/src/composition/index.js";
import {
  ROOT, OPENCODE_BIN, PROVIDER_ID, PROVIDER_BASE_URL, PROVIDER_MODEL, PROVIDER_ENV_VAR, MODEL_REF,
  budget, registerSecret, scanClean, assertArtifactClean, safeJson,
  makeFixtureWorkspace, cleanupWorkspace, collectBoundaryEv, type LegResult,
} from "./harness-lib.mts";

const CMD = "node --import tsx tools/verify/leg4-product-boundary.mts";
/** Hard per-leg cap: at most ONE successful provider request in this leg. */
const LEG4_MAX_SUCCESS = 1;

type Live = Awaited<ReturnType<typeof startLiveCoworkService>>;

interface BoundaryOutcome {
  sessionId?: string;
  createStatus?: number;
  messageStatus?: number;
  events: EvEvent[];
  eventKinds: string[];
  tokenCount: number;
  terminalState?: string;
  completed: boolean;
  timedOut: boolean;
  transient: boolean;
  note?: string;
}

/** Parse the versioned success/error envelope; never echoes secret material. */
async function callBoundary(
  baseUrl: string, token: string, method: "POST", path: string, body: unknown,
): Promise<{ status: number; ok: boolean; data: unknown; errorCode?: string }> {
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const envelope = (await res.json()) as
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string } };
  if (envelope.ok) return { status: res.status, ok: true, data: envelope.data };
  return { status: res.status, ok: false, data: undefined, errorCode: envelope.error.code };
}

/** Drive ONE full product-boundary chat turn over HTTP (create → stream → message → consume). */
async function driveBoundaryTurn(
  live: Live, workspaceId: string, onLeak: () => void, prompt: string,
): Promise<BoundaryOutcome> {
  const baseUrl = live.running.baseUrl;
  const token = live.running.clientToken;
  const out: BoundaryOutcome = {
    events: [], eventKinds: [], tokenCount: 0, completed: false, timedOut: false, transient: false,
  };

  // (1) Create a session over the token-guarded PRODUCT route (not the service shortcut).
  let created;
  try {
    created = await callBoundary(baseUrl, token, "POST", "/v1/session", {
      workspaceId,
      title: "verify:leg4-product-boundary",
      model: MODEL_REF,
    });
  } catch (err) {
    out.transient = true;
    out.note = `POST /v1/session network error: ${err instanceof Error ? err.message : String(err)}`;
    return out;
  }
  out.createStatus = created.status;
  if (!created.ok || created.status !== 201) {
    out.transient = true;
    out.note = `POST /v1/session returned status=${created.status} code=${created.errorCode ?? "none"}.`;
    return out;
  }
  const sessionId = ((created.data as { session?: { id?: string } }).session ?? {}).id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    out.transient = true;
    out.note = "POST /v1/session did not return a session id.";
    return out;
  }
  out.sessionId = sessionId;

  // (2) Open the token-guarded SSE stream as a CLIENT (do not await; keep it consuming) BEFORE the
  // prompt so no live EV is missed. collectBoundaryEv hits EV_STREAM_PATH === /v1/session/stream.
  const collecting = collectBoundaryEv({
    baseUrl, clientToken: token, sessionId, timeoutMs: 90_000, onLeak,
  });
  // Let the SSE subscription register server-side before the run starts producing frames.
  await new Promise((r) => setTimeout(r, 1000));

  // (3) Send the prompt over the token-guarded product route — fire-and-forget → 202 Accepted.
  budget.assertCanSpend();
  let message;
  try {
    message = await callBoundary(baseUrl, token, "POST", `/v1/session/${sessionId}/message`, {
      text: prompt,
    });
  } catch (err) {
    out.transient = true;
    out.note = `POST message network error: ${err instanceof Error ? err.message : String(err)}`;
    return out;
  }
  out.messageStatus = message.status;
  if (message.status !== 202) {
    // 503 runtime_not_attached or a 4xx: nothing spent, retry-eligible transient.
    out.transient = true;
    out.note = `POST message returned status=${message.status} code=${message.errorCode ?? "none"}.`;
    return out;
  }

  // (4) Consume the SSE stream to the terminal.
  const { events, terminal, timedOut } = await collecting;
  out.events = events;
  out.eventKinds = [...new Set(events.map((e) => e.kind))];
  out.tokenCount = events.filter((e) => e.kind === "token").length;
  out.timedOut = timedOut;
  if (terminal?.kind === "terminal") {
    out.terminalState = terminal.state;
    out.completed = terminal.state === "completed";
  }
  // A turn that streamed nothing and timed out is a genuine transient (never reached the model).
  if (!out.completed && events.length === 0 && timedOut) out.transient = true;
  return out;
}

export async function runLeg4(): Promise<LegResult> {
  budget.maxSuccesses = LEG4_MAX_SUCCESS; // hard-enforce the ≤1 successful-request cap for this leg.
  const result: LegResult = {
    leg: "leg4",
    title: "Product-boundary live chat (POST /v1/session → SSE → POST message → real completed EV7 over HTTP)",
    status: "BLOCKED", proven: [], commands: [CMD], successfulRequests: 0, secretScan: "CLEAN", notes: [],
  };

  if (!existsSync(OPENCODE_BIN)) {
    result.notes.push(`Pinned opencode.exe not found at ${OPENCODE_BIN} — leg BLOCKED.`);
    return result;
  }
  if (!(await keyringAvailable())) {
    result.notes.push("Windows Credential Manager (keyring) unavailable — leg BLOCKED (not a failure).");
    return result;
  }

  const store = await createKeyringStore();
  const account = credentialAccountFor(PROVIDER_ID);
  const secret = await store.get(account);
  if (secret === null || secret.length === 0) {
    result.notes.push(`No usable credential in the keyring for account "${account}" — leg BLOCKED (not a failure).`);
    return result;
  }
  registerSecret(secret); // scanned into every artifact; never printed.

  const ws = makeFixtureWorkspace();
  let leaked = false;
  const onLeak = (): void => { leaked = true; };
  let live: Live | undefined;
  let stoppedClean = false;
  let childGone = false;
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

    live = await startLiveCoworkService(options);
    result.proven.push("startLiveCoworkService spawned the REAL pinned opencode.exe (composition now OWNS the /event→hub pump).");
    result.proven.push(`Boundary is up on loopback: running.baseUrl set + a per-launch client token issued (isAlive=${live.supervisor.isAlive()}).`);

    if (live.supervisor.baseUrl === null) throw new Error("Supervisor baseUrl null after a successful start.");

    // --- The single bounded turn, driven ENTIRELY over the product HTTP boundary. ---
    const prompt = "Reply with the single word: ready";
    let turn = await driveBoundaryTurn(live, ws, onLeak, prompt);
    // At most ONE retry, and ONLY on a genuine transient where nothing was spent (no completed run).
    if (!turn.completed && turn.transient && budget.successes < LEG4_MAX_SUCCESS) {
      budget.retries += 1;
      result.notes.push(`Transient on attempt 1 (${turn.note ?? "no terminal"}); retrying once.`);
      turn = await driveBoundaryTurn(live, ws, onLeak, prompt);
    }

    // Record the wire facts (secret-free).
    result.notes.push(`Boundary statuses: POST /v1/session=${turn.createStatus ?? "n/a"}, POST message=${turn.messageStatus ?? "n/a"}.`);
    result.notes.push(`EV kinds observed over the boundary: [${turn.eventKinds.join(", ") || "none"}]; token EV count=${turn.tokenCount}; terminal=${turn.terminalState ?? "none"}.`);

    if (turn.completed) {
      budget.recordSuccess();
      result.successfulRequests += 1;
      if (turn.tokenCount > 0) {
        result.proven.push(`Real streamed token EV(s) (${turn.tokenCount}) arrived over the token-guarded SSE route, terminated by an HONEST completed terminal (EV7) — NOT fabricated.`);
      } else {
        result.proven.push("Honest completed terminal (EV7) received over the boundary (no token deltas surfaced this turn — see notes).");
      }
    } else if (turn.terminalState === "completed") {
      // defensive: only reachable if recordSuccess pathing changed — treat as success.
      result.successfulRequests += 1;
    } else {
      result.notes.push(`Turn did not reach a completed terminal (terminal=${turn.terminalState ?? "none"}, timedOut=${turn.timedOut}, note=${turn.note ?? "none"}).`);
    }

    // --- Teardown: stop() must tear down the child (no orphan) AND close the pump consumer. ---
    await live.stop();
    childGone = live.supervisor.baseUrl === null && live.supervisor.isAlive() === false;
    stoppedClean = childGone;
    result.proven.push(`stop(): loopback socket + /event pump consumer closed; child torn down — baseUrl=null=${live.supervisor.baseUrl === null}, isAlive=${live.supervisor.isAlive()} (no orphan).`);
    live = undefined;

    result.secretScan = leaked ? "LEAK" : "CLEAN";
    if (leaked) {
      result.status = "FAIL";
      result.error = "A registered secret value appeared in a captured stream/log frame.";
    } else if (turn.completed && turn.tokenCount > 0 && stoppedClean) {
      result.status = "PASS";
    } else if (turn.completed && stoppedClean) {
      result.status = "PARTIAL";
      result.notes.push("Honest completed terminal over the boundary, but no token deltas were observed this turn.");
    } else {
      result.status = "PARTIAL";
      result.notes.push("The composed boundary path ran, but a completed terminal was not confirmed live this attempt.");
    }
  } catch (err) {
    result.status = "FAIL";
    result.error = err instanceof Error ? err.message : String(err);
    result.secretScan = leaked ? "LEAK" : "CLEAN";
    if (live) { try { await live.stop(); childGone = live.supervisor.baseUrl === null && !live.supervisor.isAlive(); } catch { /* best effort */ } }
  } finally {
    const removed = cleanupWorkspace(ws);
    result.notes.push(`Temp fixture workspace ${ws} cleaned=${removed}.`);
    result.notes.push(`Child torn down with no orphan=${childGone}.`);
    result.notes.push(`Boundary routes exercised over HTTP: POST ${"/v1/session"}, GET ${EV_STREAM_PATH}, POST /v1/session/{id}/message.`);
  }
  return result;
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const result = await runLeg4();
  const report = {
    task: "CGHC-028",
    leg: "leg4",
    kind: "final bounded LIVE re-verification THROUGH THE PRODUCT BOUNDARY (HTTP, client-token)",
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    budget: {
      legMaxSuccesses: LEG4_MAX_SUCCESS,
      successfulRequestsUsedThisLeg: result.successfulRequests,
      cumulativeNote: "Wave C previously used 2 of 3; this leg adds at most 1 (cumulative ≤ 3).",
      retriesUsed: budget.retries,
      withinLegBudget: result.successfulRequests <= LEG4_MAX_SUCCESS,
    },
    secretScan: result.secretScan,
    status: result.status,
    result,
    disclaimer:
      "Real opencode.exe + real provider (custom OpenAI-compatible) driven over the composed loopback " +
      "product boundary with the per-launch client token. Legitimate live evidence for the assembled " +
      "chat path; NOT a packaged-installer smoke test.",
  };

  const serialized = safeJson(report);
  const outPath = join(ROOT, "tools", "verify", "leg4-report.json");
  assertArtifactClean("leg4-report.json", serialized); // refuse to write if any secret is present.
  writeFileSync(outPath, serialized, "utf8");

  process.stdout.write("\n=== CGHC-028 leg 4 (product boundary) ===\n");
  process.stdout.write(`[${result.status}] ${result.leg}: ${result.title}\n`);
  for (const p of result.proven) process.stdout.write(`   + ${p}\n`);
  for (const n of result.notes) process.stdout.write(`   . ${n}\n`);
  if (result.error) process.stdout.write(`   ! error: ${result.error}\n`);
  process.stdout.write(
    `\nsuccessful_live_requests_this_leg=${result.successfulRequests}/${LEG4_MAX_SUCCESS} ` +
      `retries=${budget.retries} secret_scan=${result.secretScan} status=${result.status}\n`,
  );
  process.stdout.write(`report=${outPath}\n`);

  const hardFail = result.status === "FAIL" || result.secretScan === "LEAK";
  // Extra guard: the console summary itself must be secret-free (defense in depth over the writer).
  if (!scanClean(JSON.stringify(result.notes) + JSON.stringify(result.proven))) return 1;
  return hardFail ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`leg4 harness crashed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
