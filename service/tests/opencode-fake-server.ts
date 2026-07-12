/**
 * A local FAKE OpenCode HTTP server for the CGHC-028 Wave A2 adapter tests. It implements the
 * ASSUMED OpenCode routes over a real `http.Server` on loopback so the default suite exercises the
 * LIVE adapters WITHOUT a real OpenCode binary, socket auth, network, or LLM. Not a `*.test.ts`
 * file, so the runner never executes it directly.
 *
 * Records every request (method, path, parsed JSON body) for assertions, and lets a test force a
 * status override per route to drive the non-2xx / typed-error paths.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface FakeMessage {
  readonly info: Record<string, unknown>;
  readonly parts: readonly unknown[];
}

export interface FakeServerState {
  /** Sessions keyed by id (seeded or created). */
  readonly sessions: Map<string, Record<string, unknown>>;
  /** Per-session replay messages returned by `GET /session/{id}/message`. */
  readonly messages: Map<string, readonly FakeMessage[]>;
  /** Force a status for a route key like `POST /session` (overrides the default 200/201). */
  readonly forceStatus: Map<string, number>;
  /** The pinned health version reported by `/global/health`. */
  version: string;
  /** When set, `/global/health` returns this status (drives the unreachable/500 probe path). */
  healthStatus: number;
}

/** Called when a prompt is POSTed; use `emit` to push scripted `/event` frames back. */
export type OnPromptHook = (
  sessionId: string,
  body: unknown,
  emit: (frame: unknown) => void,
) => void | Promise<void>;

export interface FakeOpencodeServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  readonly state: FakeServerState;
  /** Push one raw OpenCode `/event` frame to every connected SSE consumer. */
  emitEvent(frame: unknown): void;
  /** Register the prompt hook that scripts the `/event` reply for `POST /session/{id}/message`. */
  setOnPrompt(hook: OnPromptHook | undefined): void;
  /** Number of currently-connected `GET /event` consumers (readiness gate for tests). */
  eventClientCount(): number;
  close(): Promise<void>;
}

const PIN = "v1.17.11";

export async function startFakeOpencodeServer(): Promise<FakeOpencodeServer> {
  const requests: RecordedRequest[] = [];
  const state: FakeServerState = {
    sessions: new Map(),
    messages: new Map(),
    forceStatus: new Map(),
    version: PIN,
    healthStatus: 200,
  };
  let counter = 0;
  const eventClients = new Set<ServerResponse>();
  let onPrompt: OnPromptHook | undefined;

  function emitEvent(frame: unknown): void {
    const data = `data: ${JSON.stringify(frame)}\n\n`;
    for (const client of eventClients) client.write(data);
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => sendJson(res, 500, { error: "fake_internal" }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const body = await readBody(req);
    requests.push({ method, path, body });

    const forced = state.forceStatus.get(`${method} ${path}`);
    if (forced !== undefined && forced >= 400) {
      sendJson(res, forced, { error: "forced" });
      return;
    }

    // GET /event  (the long-lived SSE stream the event pump consumes)
    if (method === "GET" && path === "/event") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      eventClients.add(res);
      // `res` (the long-lived streaming response) emits `close` when the consumer disconnects
      // (e.g. the pump aborts its fetch) — the correct teardown signal for an SSE response.
      res.on("close", () => eventClients.delete(res));
      return; // keep the socket open — never end it here.
    }

    // GET /global/health
    if (method === "GET" && path === "/global/health") {
      if (state.healthStatus >= 400) {
        sendJson(res, state.healthStatus, { error: "unhealthy" });
        return;
      }
      sendJson(res, 200, { healthy: true, version: state.version });
      return;
    }

    // POST /session  (create)
    if (method === "POST" && path === "/session") {
      const id = `ses_fake_${++counter}`;
      const title = readTitle(body) ?? "Untitled";
      const info = { id, title, time: { created: 1_783_757_969_956, updated: 1_783_757_969_956 } };
      state.sessions.set(id, info);
      sendJson(res, 200, info);
      return;
    }

    // GET /session  (list)
    if (method === "GET" && path === "/session") {
      sendJson(res, 200, [...state.sessions.values()]);
      return;
    }

    const sessionMatch = /^\/session\/([^/]+)$/.exec(path);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1] as string);
      // GET /session/{id}
      if (method === "GET") {
        const info = state.sessions.get(id);
        if (info === undefined) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, info);
        return;
      }
      // PATCH /session/{id}  (rename)
      if (method === "PATCH") {
        const existing = state.sessions.get(id) ?? { id };
        const info = { ...existing, id, title: readTitle(body) ?? existing["title"] ?? "Untitled" };
        state.sessions.set(id, info);
        sendJson(res, 200, info);
        return;
      }
    }

    // GET /session/{id}/message  (replay source)  |  POST /session/{id}/message  (send prompt)
    const messageMatch = /^\/session\/([^/]+)\/message$/.exec(path);
    if (messageMatch && method === "GET") {
      const id = decodeURIComponent(messageMatch[1] as string);
      sendJson(res, 200, state.messages.get(id) ?? []);
      return;
    }
    if (messageMatch && method === "POST") {
      const id = decodeURIComponent(messageMatch[1] as string);
      // Accept the prompt (202-style), then let the test script the `/event` reply out-of-band.
      sendJson(res, 200, { ok: true });
      await onPrompt?.(id, body, emitEvent);
      return;
    }

    // POST /session/{id}/abort  (cancel)
    if (method === "POST" && /^\/session\/[^/]+\/abort$/.test(path)) {
      sendJson(res, 200, { ok: true });
      return;
    }

    // POST /permission/{requestId}/reply
    if (method === "POST" && /^\/permission\/[^/]+\/reply$/.test(path)) {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "no_route" });
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    state,
    emitEvent,
    setOnPrompt: (hook) => void (onPrompt = hook),
    eventClientCount: () => eventClients.size,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // End every long-lived SSE consumer first so `server.close` can drain and resolve.
        for (const client of eventClients) client.end();
        eventClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}

function readTitle(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>)["title"];
    if (typeof value === "string") return value;
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}
