/**
 * CGHC-028 Wave C — shared verification harness library (service-layer + BOUNDED live legs).
 *
 * This is a VERIFICATION harness, not product source. It assembles the real live stack via the
 * exported composition seams (`buildLiveCoworkOptions` + `startLiveCoworkService`), spawns the
 * REAL pinned `opencode.exe`, and exercises the end-to-end EV path over the composed loopback
 * boundary. The ONLY piece wired here that the shipped composition does not yet own is the
 * `/event`→run-controller PUMP (a future UI/run-controller owns it); every other hop is the real
 * assembled stack — this is labelled honestly in the report.
 *
 * HARD SECRET + BUDGET RULES (enforced programmatically):
 *  - At most 3 SUCCESSFUL provider requests total across all legs (a hard counter aborts further
 *    live calls once 3 successes are reached).
 *  - The provider token is NEVER printed/stored/logged. Every artifact we write is scanned for any
 *    registered secret and the write is refused on a hit.
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EV_STREAM_PATH } from "@cowork-ghc/contracts";
import type { EvEvent } from "@cowork-ghc/contracts";
import { decodeEvSseChunk, decodeSseChunk, frameSessionId } from "../../service/src/execution/index.js";

// --- Proven CGHC-024 config (provider-neutral custom OpenAI-compatible; NOT in product source). ---
export const ROOT = "c:/Users/NhatLD2/Documents/Projects/cowork-athon-ghc";
export const OPENCODE_BIN = join(ROOT, "node_modules", "opencode-ai", "bin", "opencode.exe");
export const PROVIDER_ID = "custom-openai-compat";
export const PROVIDER_BASE_URL = "https://api.deepseek.com/v1";
export const PROVIDER_MODEL = "deepseek-chat";
export const PROVIDER_ENV_VAR = "DEEPSEEK_API_KEY";
export const MODEL_REF = { providerID: PROVIDER_ID, modelID: PROVIDER_MODEL } as const;

export type LegStatus = "PASS" | "PARTIAL" | "BLOCKED" | "FAIL";
export interface LegResult {
  readonly leg: string;
  readonly title: string;
  status: LegStatus;
  proven: string[];
  commands: string[];
  successfulRequests: number;
  secretScan: "CLEAN" | "LEAK";
  notes: string[];
  error?: string;
}

// --- Global BUDGET guard: at most 3 successful provider requests across ALL legs. ---
export const budget = {
  maxSuccesses: 3,
  successes: 0,
  retries: 0,
  /** Call BEFORE dispatching a live provider request; throws if the budget is exhausted. */
  assertCanSpend(): void {
    if (this.successes >= this.maxSuccesses) {
      throw new Error(`Live budget exhausted: ${this.successes}/${this.maxSuccesses} successes used.`);
    }
  },
  /** Record ONE successful provider request (a real completed run). */
  recordSuccess(): void {
    this.successes += 1;
    if (this.successes > this.maxSuccesses) {
      throw new Error(`BUDGET OVERRUN: ${this.successes}/${this.maxSuccesses} — aborting.`);
    }
  },
};

// --- Secret registry + artifact scanner (defense in depth over the scrubber). ---
const secrets = new Set<string>();
/** Register a secret VALUE so every artifact is scanned for it. The value is never logged. */
export function registerSecret(value: string | null | undefined): void {
  if (typeof value === "string" && value.length >= 8) secrets.add(value);
}
/** Scan text; returns true when CLEAN (no registered secret present). Never prints the secret. */
export function scanClean(text: string): boolean {
  for (const s of secrets) if (text.includes(s)) return false;
  return true;
}
/** Assert a to-be-written artifact is clean; throws (without echoing the secret) if not. */
export function assertArtifactClean(name: string, text: string): void {
  if (!scanClean(text)) {
    throw new Error(`SECRET LEAK: refusing to write ${name} — it contains a registered secret value.`);
  }
}

// --- Temp fixture workspace helpers. ---
export function makeFixtureWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "cghc-wavec-"));
}
export function cleanupWorkspace(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true });
    return !existsSync(dir);
  } catch {
    return false;
  }
}

/**
 * PUMP the child's `/event` SSE into a hub run controller (the one hop the shipped composition
 * does not yet own). Filters to the target session exactly like the CGHC-024 recorder. Returns an
 * abort handle. Captured raw frame text is scanned for secret leakage.
 */
export function pumpEventStream(
  baseUrl: string,
  sessionId: string,
  ingest: (frame: unknown) => void,
  onLeak: () => void,
): { stop: () => void; done: Promise<void> } {
  const controller = new AbortController();
  const done = (async () => {
    try {
      const res = await fetch(new URL("/event", baseUrl), {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || res.body === null) throw new Error(`/event HTTP ${res.status}`);
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        const text = decoder.decode(chunk, { stream: true });
        if (!scanClean(text)) onLeak();
        for (const raw of decodeSseChunk(text)) {
          const owner = frameSessionId(raw);
          if (owner === undefined || owner === sessionId) ingest(raw);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) throw err;
    }
  })();
  return { stop: () => controller.abort(), done };
}

/**
 * Consume EV events over the COMPOSED LOOPBACK BOUNDARY (the token-guarded SSE route) and collect
 * them until the terminal or timeout. This is the real renderer transport — proving the boundary
 * relays EV, not a private in-process shortcut. Every EV frame is scanned for secret leakage.
 */
export async function collectBoundaryEv(opts: {
  baseUrl: string;
  clientToken: string;
  sessionId: string;
  timeoutMs: number;
  onLeak: () => void;
}): Promise<{ events: EvEvent[]; terminal: EvEvent | undefined; timedOut: boolean }> {
  const events: EvEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  timer.unref?.();
  let terminal: EvEvent | undefined;
  let timedOut = false;
  const url = new URL(EV_STREAM_PATH, opts.baseUrl);
  url.searchParams.set("sessionId", opts.sessionId);
  try {
    const res = await fetch(url, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${opts.clientToken}` },
      signal: controller.signal,
    });
    if (!res.ok || res.body === null) throw new Error(`boundary EV stream HTTP ${res.status}`);
    const decoder = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const text = decoder.decode(chunk, { stream: true });
      if (!scanClean(text)) opts.onLeak();
      for (const ev of decodeEvSseChunk(text)) {
        events.push(ev);
        if (ev.kind === "terminal") {
          terminal = ev;
        }
      }
      if (terminal !== undefined) break;
    }
  } catch (err) {
    if (controller.signal.aborted) timedOut = true;
    else throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { events, terminal, timedOut };
}

/** Serialize any captured value for scanning/reporting; secret-scanned by the caller. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
