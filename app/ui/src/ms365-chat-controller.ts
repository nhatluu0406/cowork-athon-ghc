/**
 * Thin MS365 chat controller. Reuses the Cowork transport (createSession / stream /
 * sendSessionMessage) and adds only the MS365-specific steps: a connected-gate, a
 * surface:"ms365" conversation, and a one-time Ms365SessionScope allow per session.
 * The router's Ms365SessionScope remains the real execution guard.
 */

import type { ServiceClient } from "./service-client.js";

export interface Ms365StreamHandle {
  stop(): void;
  readonly done: Promise<unknown>;
}

export interface Ms365ChatControllerDeps {
  readonly getClient: () => ServiceClient | null;
  readonly isConnected: () => boolean;
  readonly workspacePath: () => string | null;
  /** Open the live EV stream for a session (inject the real startEvStream at wiring time). */
  readonly startStream: (sessionId: string) => Ms365StreamHandle;
}

export interface Ms365ChatController {
  readonly runtimeSessionId: string | null;
  readonly conversationId: string | null;
  send(text: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Start a fresh MS365 conversation: clears conversationId + tears down the current session/stream. */
  resetConversation(): void;
  /** Open an existing MS365 conversation by id: sets conversationId + tears down the current session/stream. */
  adoptConversation(id: string): void;
}

export function createMs365ChatController(deps: Ms365ChatControllerDeps): Ms365ChatController {
  let conversationId: string | null = null;
  let sessionId: string | null = null;
  let stream: Ms365StreamHandle | null = null;

  async function ensureSession(client: ServiceClient): Promise<string> {
    if (sessionId !== null) return sessionId;
    const workspace = deps.workspacePath();
    if (workspace === null) throw new Error("Chưa chọn workspace.");
    if (conversationId === null) {
      const conv = await client.createConversation({ workspacePath: workspace, surface: "ms365" });
      conversationId = conv.id;
    }
    const session = await client.createSession({ workspaceId: workspace });
    const sid = session.id;
    // Grant tool scope + open the stream BEFORE committing sid to controller state. If either
    // throws, sessionId stays null and the next send() re-runs ensureSession from scratch —
    // never leaving a half-initialized session that send() would skip past.
    await client.setMs365SessionScope(sid, true); // one-time allow
    const openedStream = deps.startStream(sid);
    sessionId = sid;
    stream = openedStream;
    return sessionId;
  }

  function teardownSession(): void {
    stream?.stop();
    stream = null;
    sessionId = null;
  }

  return {
    get runtimeSessionId() {
      return sessionId;
    },
    get conversationId() {
      return conversationId;
    },

    async send(text) {
      if (!deps.isConnected()) return; // connected-gate
      const client = deps.getClient();
      if (client === null) return;
      const sid = await ensureSession(client);
      await client.sendSessionMessage(sid, text);
    },

    async disconnect() {
      try {
        const client = deps.getClient();
        if (client !== null && sessionId !== null) {
          await client.setMs365SessionScope(sessionId, false); // revoke
        }
      } finally {
        stream?.stop();
        stream = null;
        sessionId = null;
        conversationId = null;
      }
    },

    resetConversation() {
      teardownSession();
      conversationId = null;
    },

    adoptConversation(id) {
      teardownSession();
      conversationId = id;
    },
  };
}
