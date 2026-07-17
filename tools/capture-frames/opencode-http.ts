/**
 * Thin HTTP transport for the CGHC-024 capture tool (opt-in, post-token). Talks to a live
 * pinned `opencode serve` bound to loopback: opens the `/event` SSE stream and (optionally)
 * creates a session + sends a prompt to drive a run.
 *
 * PROVIDER-NEUTRAL: no vendor is encoded here. The provider key is injected into the
 * `opencode serve` CHILD ENVIRONMENT by the launcher (runtime `buildLaunchSpec`), never sent
 * from this client — so a custom OpenAI-compatible endpoint (e.g. DeepSeek) works the same as
 * a built-in. This module posts only a prompt + a secret-free model ref.
 *
 * ENDPOINT NOTE: the concrete route strings are overridable (`--session-path`, `--prompt-path`)
 * and MUST be confirmed against the pinned server's OpenAPI at capture time. The `/event`
 * stream shape is the one pinned in `service/src/execution/opencode-events.ts`.
 */

/** Open the `/event` SSE stream and yield decoded text chunks until the signal aborts. */
export async function* openEventStream(
  baseUrl: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  const res = await fetch(new URL("/event", baseUrl), {
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || res.body === null) {
    throw new Error(`Failed to open /event stream: HTTP ${res.status}`);
  }
  const decoder = new TextDecoder();
  // Node 22 ReadableStream is async-iterable; each Uint8Array chunk may hold 0..N frames.
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    yield decoder.decode(chunk, { stream: true });
  }
  const tail = decoder.decode();
  if (tail.length > 0) yield tail;
}

export interface CreateSessionOptions {
  readonly baseUrl: string;
  readonly sessionPath: string;
  readonly title: string;
}

/** Create a session and return its id. Route is operator-confirmable (`--session-path`). */
export async function createSession(options: CreateSessionOptions): Promise<string> {
  const res = await fetch(new URL(options.sessionPath, options.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: options.title }),
  });
  if (!res.ok) throw new Error(`Failed to create session: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const id = readId(body);
  if (id === undefined) throw new Error("Create-session response had no session id.");
  return id;
}

export interface SendPromptOptions {
  readonly baseUrl: string;
  /** `--prompt-path`; `{id}` is substituted with the session id. */
  readonly promptPathTemplate: string;
  readonly sessionId: string;
  readonly prompt: string;
  /** Secret-free model ref `{ providerID, modelID }` (never a key). */
  readonly model?: { providerID: string; modelID: string };
}

/** Send a prompt that drives the run whose frames we record. Route is operator-confirmable. */
export async function sendPrompt(options: SendPromptOptions): Promise<void> {
  const path = options.promptPathTemplate.replace("{id}", encodeURIComponent(options.sessionId));
  const res = await fetch(new URL(path, options.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text: options.prompt }],
      ...(options.model ? { model: options.model } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Failed to send prompt: HTTP ${res.status}`);
}

export interface AbortSessionOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  /** `POST /session/{id}/abort` on the pinned server (confirmed in the route table). */
  readonly abortPathTemplate?: string;
}

/**
 * Abort a running session mid-flight so the run terminates as a REAL cancelled/aborted
 * outcome (the `cancel` capture scenario), not a fabricated one. Best-effort: a non-2xx is
 * swallowed because the session may already have finished by the time we abort.
 */
export async function abortSession(options: AbortSessionOptions): Promise<void> {
  const template = options.abortPathTemplate ?? "/session/{id}/abort";
  const path = template.replace("{id}", encodeURIComponent(options.sessionId));
  try {
    await fetch(new URL(path, options.baseUrl), { method: "POST" });
  } catch {
    /* the run may already be terminal; the stream frame is the source of truth */
  }
}

function readId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const rec = body as Record<string, unknown>;
  for (const key of ["id", "sessionID", "sessionId"] as const) {
    const value = rec[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const info = rec["info"];
  return typeof info === "object" && info !== null ? readId(info) : undefined;
}
