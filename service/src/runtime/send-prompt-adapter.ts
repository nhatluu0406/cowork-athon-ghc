/**
 * LIVE {@link SendPrompt} over the supervised OpenCode child (CGHC-028 live-run wiring).
 *
 * Fills the session router's prompt-dispatch seam (`compose-service.ts` default: reject with
 * RuntimeNotAttachedError). It POSTs the user's prompt to the child so a run STARTS; the run's
 * EV frames come back out-of-band on the child `/event` stream (consumed by the event pump),
 * NOT in this POST's response — so this returns as soon as the child accepts the message.
 *
 * PROVIDER-NEUTRAL + secret-free: the body carries only the prompt text (and, when the caller
 * supplies one, a non-secret model ref). The provider key is injected into the child ENV at
 * launch by the supervisor, never sent from here.
 *
 * ROUTE (flag for Wave C live confirmation against the pinned OpenAPI): `POST /session/{id}/message`
 * with body `{ parts: [{ type: "text", text }], model? }` — matches the CGHC-024 capture tool.
 */

import type { ModelRef, SessionId } from "@cowork-ghc/contracts";
import type { SendPrompt } from "../session/index.js";
import type { OpencodeHttp } from "./opencode-client.js";

export interface OpencodeSendPromptOptions {
  readonly http: OpencodeHttp;
  /** Optional non-secret model ref stamped on every prompt (never a key). */
  readonly model?: ModelRef;
}

export function createOpencodeSendPrompt(options: OpencodeSendPromptOptions): SendPrompt {
  return {
    send(sessionId: SessionId, text: string): Promise<void> {
      return options.http.send({
        operation: "session.sendPrompt",
        method: "POST",
        path: `/session/${encodeURIComponent(sessionId)}/message`,
        body: {
          parts: [{ type: "text", text }],
          ...(options.model !== undefined ? { model: options.model } : {}),
        },
      });
    },
  };
}
