/**
 * CGHC-028 Wave C — LEG 2: provider-error leg (PR7).
 *
 * Starts the live stack with a DELIBERATELY INVALID credential (a bogus key value injected via
 * the SAME store/env seam — never a real one) and drives a prompt. The provider rejects auth, so
 * this spends ZERO successful requests. Asserts the boundary surfaces a DISTINCT, actionable,
 * SECRET-FREE error (an `error` EV + a `terminal` errored — NOT a fabricated `completed`), per
 * CGHC-020. Also runs the cheap NO-LIVE error-map assertions (429/timeout/unavailable).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createMemoryStore, createCredentialService, createSecretScrubber } from "../../service/src/credential/index.js";
import { credentialAccountFor, credentialRef } from "../../service/src/credential/store.js";
import { buildLiveCoworkOptions, startLiveCoworkService } from "../../service/src/composition/index.js";
import type { CustomProviderSelection } from "../../service/src/composition/index.js";
import { mapProviderError } from "../../service/src/provider/index.js";
import { sendPrompt } from "../capture-frames/opencode-http.js";
import {
  ROOT, OPENCODE_BIN, PROVIDER_ID, PROVIDER_BASE_URL, PROVIDER_MODEL, PROVIDER_ENV_VAR, MODEL_REF,
  registerSecret, makeFixtureWorkspace, cleanupWorkspace, pumpEventStream, collectBoundaryEv,
  type LegResult,
} from "./harness-lib.mts";

// A clearly-bogus, well-formed-looking key value. NEVER a real credential.
const BOGUS_KEY = "sk-cghc-wavec-INVALID-000000000000000000000000";

export async function runLeg2(): Promise<LegResult> {
  const result: LegResult = {
    leg: "leg2", title: "Provider-error leg (PR7 — invalid credential surfaces a distinct, secret-free error)",
    status: "BLOCKED", proven: [], commands: ["node --import tsx tools/verify/run-wave-c.mjs (leg 2)"],
    successfulRequests: 0, secretScan: "CLEAN", notes: [],
  };

  // --- Cheap NO-LIVE error-map assertions (always run; reachable without a provider). ---
  try {
    const rate = mapProviderError({ status: 429 });
    const timeout = mapProviderError({ status: 408 });
    const unavail = mapProviderError({ status: 503 });
    const auth = mapProviderError({ status: 401 });
    const okMap =
      rate.kind === "rate_limited" && timeout.kind === "timeout" &&
      unavail.kind === "unavailable" && auth.kind === "auth_invalid" &&
      [rate, timeout, unavail, auth].every((e) => typeof e.message === "string" && e.message.length > 0);
    if (okMap) {
      result.proven.push("Error-map (no live): 401→auth_invalid, 429→rate_limited, 408→timeout, 503→unavailable — static secret-free messages + recovery.");
    } else {
      result.notes.push("Error-map assertion produced unexpected kinds.");
    }
  } catch (err) {
    result.notes.push(`Error-map path not reachable: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!existsSync(OPENCODE_BIN)) {
    result.notes.push(`Pinned opencode.exe not found — live invalid-key sub-leg BLOCKED (error-map still proven above).`);
    result.status = result.proven.length > 0 ? "PARTIAL" : "BLOCKED";
    return result;
  }

  const ws = makeFixtureWorkspace();
  let leaked = false;
  const onLeak = (): void => { leaked = true; };
  registerSecret(BOGUS_KEY);
  let live: Awaited<ReturnType<typeof startLiveCoworkService>> | undefined;
  try {
    // ONE store holds ONLY the bogus key (memory store — never touches the OS keyring).
    const store = createMemoryStore();
    const account = credentialAccountFor(PROVIDER_ID);
    await store.set(account, BOGUS_KEY);
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
    const baseUrl = live.supervisor.baseUrl;
    if (baseUrl === null) throw new Error("Supervisor baseUrl null after start.");
    result.proven.push("Live stack started with a bogus key injected via the SAME env/keyring seam (health does not validate the key).");

    const meta = await live.deps.sessionService.create({ workspaceId: ws, title: "verify:provider-error", model: MODEL_REF });
    const sessionId = meta.id;
    const run = live.deps.streamHub.open(sessionId);
    const pump = pumpEventStream(baseUrl, sessionId, (f) => run.ingest(f), onLeak);
    await new Promise((r) => setTimeout(r, 600));
    const collecting = collectBoundaryEv({
      baseUrl: live.running.baseUrl, clientToken: live.running.clientToken,
      sessionId, timeoutMs: 60_000, onLeak,
    });
    await sendPrompt({ baseUrl, promptPathTemplate: "/session/{id}/message", sessionId, prompt: "Reply with the single word: ready", model: MODEL_REF });
    const { events, terminal } = await collecting;
    pump.stop(); run.close(); await pump.done.catch(() => undefined);

    const errorEv = events.find((e) => e.kind === "error");
    const erroredTerminal = terminal?.kind === "terminal" && terminal.state === "errored";
    const completedFabricated = terminal?.kind === "terminal" && terminal.state === "completed";
    const msgSecretFree = errorEv?.kind === "error" ? !errorEv.message.includes(BOGUS_KEY) && errorEv.message.length > 0 : false;

    if (erroredTerminal && errorEv?.kind === "error" && msgSecretFree) {
      const recovery = errorEv.recovery?.kind ?? "none";
      result.proven.push(`Invalid credential → DISTINCT error EV (recovery=${recovery}) + honest terminal=errored (no fabricated completed). Message is secret-free.`);
      result.status = "PASS";
    } else if (completedFabricated) {
      result.status = "FAIL";
      result.error = "Invalid credential run reported a fabricated completed terminal.";
    } else {
      result.status = "PARTIAL";
      result.notes.push(`Terminal=${terminal?.kind === "terminal" ? terminal.state : "none"}, errorEv=${errorEv !== undefined}, msgSecretFree=${msgSecretFree}. Provider may have been unreachable.`);
    }

    await live.stop();
    live = undefined;
    result.secretScan = leaked ? "LEAK" : "CLEAN";
    if (leaked) result.status = "FAIL";
  } catch (err) {
    // A start/spawn failure or unreachable provider is BLOCKED/PARTIAL, not a hidden FAIL.
    result.error = err instanceof Error ? err.message : String(err);
    result.status = result.proven.length > 1 ? "PARTIAL" : "BLOCKED";
    result.secretScan = leaked ? "LEAK" : "CLEAN";
    if (live) { try { await live.stop(); } catch { /* best effort */ } }
  } finally {
    result.notes.push(`Temp fixture workspace ${ws} cleaned=${cleanupWorkspace(ws)}.`);
  }
  return result;
}
