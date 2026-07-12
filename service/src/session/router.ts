/**
 * Session boundary router (CGHC-028 live-run wiring) — the WIRE seam the UI talks to to
 * create/list sessions, send a prompt, and cancel a run. Mounts on the CGHC-002 loopback
 * boundary (ADR 0003) via the standard {@link BoundaryRouter} seam.
 *
 * ARCHITECTURE / SECURITY invariants held here:
 *  - Every route is TOKEN-GUARDED (no `publicUnauthenticated`) — fail-closed like every
 *    sensitive route.
 *  - The router owns NO business logic: it validates the request at the boundary and delegates
 *    to the ONE {@link SessionService} (the session mechanism) + the injected {@link SendPrompt}
 *    seam. It returns only light, secret-free {@link SessionMeta} — never a transcript/content.
 *  - Sending a prompt is FIRE-AND-FORGET at the request/response level: the run's EV response
 *    streams back over the separate SSE route (`/v1/session/stream`), so this returns 202
 *    Accepted, never a fabricated result.
 *  - `SendPrompt` is a seam: Tier 1 (no child) injects the not-attached double so this route
 *    HONESTLY reports `runtime_not_attached` (503) instead of pretending a prompt was sent; the
 *    live composition injects the real OpenCode POST.
 *
 * KNOWN LIMITATION (CGHC-028 POC — one assistant turn per session):
 *  - The session task-registry FREEZES on the first terminal EV (S6 finality: a `completed` /
 *    `errored` / `cancelled` run is OVER and later events are dropped — correct, do not change).
 *  - Consequently, re-prompting the SAME session after it has gone terminal cannot re-stream: the
 *    frozen registry drops the new run's frames and the SSE route refuses to subscribe to a
 *    terminal session. Rather than accept such a prompt with a misleading 202 that then streams
 *    nothing, {@link SESSION_MESSAGE_PATH} returns an HONEST 409 `session_completed` for a
 *    terminal session (FIX-1). Multi-turn re-streaming on one session is a documented follow-up.
 */

import type { ModelRef, SessionId, WorkspaceId } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { CreateSessionInput } from "./seams.js";
import type { SessionService } from "./session-service.js";
import { OpencodeHttpError } from "../runtime/opencode-http-error.js";

export const SESSION_PATH = "/v1/session";
export const SESSION_ITEM_PATH = "/v1/session/{id}";
export const SESSION_CONTINUE_PATH = "/v1/session/{id}/continue";
export const SESSION_MESSAGE_PATH = "/v1/session/{id}/message";
export const SESSION_CANCEL_PATH = "/v1/session/{id}/cancel";

/**
 * The prompt-dispatch seam. In live mode this POSTs the prompt to the supervised OpenCode child
 * (`/session/{id}/message`); the not-attached default REJECTS with a typed error carrying
 * `code === "runtime_not_attached"` so the router can surface an honest 503 without importing
 * the composition layer (no dependency cycle).
 */
export interface SendPrompt {
  send(sessionId: SessionId, text: string): Promise<void>;
}

/** Malformed session request (bad client input). Maps to HTTP 400 `bad_request`. */
export class SessionRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "SessionRequestError";
  }
}

/** True when a rejection is the honest "runtime not attached" signal (duck-typed, no import). */
function isRuntimeNotAttached(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "runtime_not_attached"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new SessionRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function readModel(value: unknown): ModelRef | undefined {
  if (value === undefined) return undefined;
  const rec = asRecord(value);
  const providerID = rec["providerID"];
  const modelID = rec["modelID"];
  if (typeof providerID !== "string" || typeof modelID !== "string") {
    throw new SessionRequestError("model, when present, must be { providerID, modelID }.");
  }
  return { providerID, modelID };
}

function parseCreateBody(body: unknown): CreateSessionInput {
  const rec = asRecord(body);
  const workspaceId = rec["workspaceId"];
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new SessionRequestError("workspaceId is required.");
  }
  const title = rec["title"];
  if (title !== undefined && typeof title !== "string") {
    throw new SessionRequestError("title, when present, must be a string.");
  }
  const model = readModel(rec["model"]);
  return {
    workspaceId: workspaceId as WorkspaceId,
    ...(title !== undefined ? { title } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}

function parseMessageBody(body: unknown): string {
  const rec = asRecord(body);
  const text = rec["text"];
  if (typeof text !== "string" || text.length === 0) {
    throw new SessionRequestError("text is required.");
  }
  return text;
}

function requireSessionId(params: Readonly<Record<string, string>>): SessionId {
  const id = params["id"];
  if (id === undefined || id.length === 0) {
    throw new SessionRequestError("A session id path segment is required.");
  }
  return id;
}

/** Build the token-guarded session router bound to the ONE service + a {@link SendPrompt} seam. */
export function createSessionRouter(
  sessionService: SessionService,
  sendPrompt: SendPrompt,
): BoundaryRouter {
  const notFound = (sessionId: SessionId): RouteResult => ({
    status: 404,
    data: { error: "unknown_session", sessionId },
  });

  return {
    name: "session",
    routes: [
      {
        method: "POST",
        path: SESSION_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const meta = await sessionService.create(parseCreateBody(ctx.body));
          return { status: 201, data: { session: meta } };
        },
      },
      {
        method: "GET",
        path: SESSION_PATH,
        handler: async (): Promise<RouteResult> => ({
          status: 200,
          data: { sessions: await sessionService.list() },
        }),
      },
      {
        method: "GET",
        path: SESSION_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const sessionId = requireSessionId(ctx.params);
          const view = sessionService.view(sessionId);
          if (view === undefined) {
            try {
              const reopened = await sessionService.continueSession(sessionId);
              return {
                status: 200,
                data: {
                  session: reopened.meta,
                  view: reopened.view,
                  resumed: true,
                },
              };
            } catch {
              return notFound(sessionId);
            }
          }
          const list = await sessionService.list();
          const meta = list.find((s) => s.id === sessionId);
          if (meta === undefined) return notFound(sessionId);
          return { status: 200, data: { session: meta, view, resumed: false } };
        },
      },
      {
        method: "POST",
        path: SESSION_CONTINUE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const sessionId = requireSessionId(ctx.params);
          try {
            const reopened = await sessionService.continueSession(sessionId);
            return {
              status: 200,
              data: {
                session: reopened.meta,
                view: reopened.view,
                canPrompt: reopened.view.terminal === null,
              },
            };
          } catch {
            return notFound(sessionId);
          }
        },
      },
      {
        method: "POST",
        path: SESSION_MESSAGE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const sessionId = requireSessionId(ctx.params);
          const text = parseMessageBody(ctx.body);
          const view = sessionService.view(sessionId);
          if (view === undefined) return notFound(sessionId);
          // HONEST single-turn boundary (FIX-1): a session that has already gone terminal is
          // frozen (S6 finality) — re-prompting it would drop the run's frames and the SSE route
          // would refuse to subscribe, so an "accepted" 202 would stream NOTHING. Reject with a
          // typed 409 BEFORE binding the stream / dispatching, so no prompt is sent and no stream
          // is fabricated. Only a live, non-terminal session accepts a prompt (202 below).
          if (view.terminal !== null) {
            return {
              status: 409,
              data: {
                accepted: false,
                code: "session_completed",
                message: "This session has already completed; start a new session.",
                sessionId,
              },
            };
          }
          // Bind a stream handle keyed by the session so a later cancel aborts the run at the
          // runtime source (S3). Then dispatch the prompt — the EV response streams over the SSE
          // route, so this returns 202 (accepted), never a fabricated completion.
          sessionService.bindStream(sessionId, { id: sessionId });
          try {
            await sendPrompt.send(sessionId, text);
          } catch (err) {
            if (isRuntimeNotAttached(err)) {
              return {
                status: 503,
                data: { accepted: false, reason: "runtime_not_attached", sessionId },
              };
            }
            if (err instanceof OpencodeHttpError) {
              return {
                status: 503,
                data: { accepted: false, reason: "runtime_unavailable", sessionId },
              };
            }
            throw err;
          }
          return { status: 202, data: { accepted: true, sessionId } };
        },
      },
      {
        method: "POST",
        path: SESSION_CANCEL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const sessionId = requireSessionId(ctx.params);
          if (sessionService.view(sessionId) === undefined) return notFound(sessionId);
          await sessionService.cancel(sessionId);
          return { status: 200, data: { cancelled: true, sessionId } };
        },
      },
    ],
  };
}
