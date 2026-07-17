/**
 * ms-chat-adapters — pure/stateless mapping helpers between the app-shell surface and the
 * MS365 tab chat controller's deps seams (P5.6 Task 3).
 *
 * These helpers hold no shell state themselves; app-shell.ts still owns `state`/`dom`/
 * `readiness` and passes them in per call so the controller's deps stay wired to the live
 * shell without this module reaching back into app-shell internals.
 */

import type { TurnMetrics } from "@cowork-ghc/contracts";
import { sanitizeAssistantForDisplay } from "../../assistant-output.js";
import { planDispatchPrompt } from "../../dispatch-plan.js";
import type { ConversationMessage } from "../../service-client.js";
import type { MsChatMessage } from "./ms-chat-controller.js";

/**
 * Maps the tab chat's own in-memory transcript into the `ConversationMessage` shape
 * `planDispatchPrompt` expects for prior-turn context. The tab transcript is ephemeral
 * (P5.6 scope) so only `role`/`text` are meaningful here — `id`/`at` are filled with inert
 * placeholders since nothing downstream reads them for this call site.
 */
export function msChatMessagesToConversationMessages(
  messages: readonly MsChatMessage[],
): ConversationMessage[] {
  return messages
    .filter((message) => !message.pending && message.error === undefined)
    .map((message, index) => ({
      id: `ms-tab-${index}`,
      role: message.role,
      text: message.content,
      at: new Date(0).toISOString(),
    }));
}

/**
 * Wraps `planDispatchPrompt` for the MS365 tab composer: no attachments/skills in this
 * surface (P5.6 scope — chips/text only), `ms365Connected = true` so the orchestration
 * policy block is always included (this tab IS the MS365 surface).
 */
export function buildMsChatDispatch(
  prior: readonly MsChatMessage[],
  prompt: string,
): { ok: true; text: string } | { ok: false; message: string } {
  const plan = planDispatchPrompt(
    msChatMessagesToConversationMessages(prior),
    [],
    prompt,
    undefined,
    [],
    undefined,
    true,
  );
  if (!plan.ok) return { ok: false, message: plan.message };
  return { ok: true, text: plan.text };
}

/**
 * Maps a raw EV `SessionView` into the controller's `{text, terminal, metrics?}` seam shape.
 * `metrics` (token counts + cost) is carried through so the MS365 bubble can render the same
 * per-turn footer as Cowork; it survives on the terminal view (see `SessionView.metrics`).
 */
export function toMsChatStreamView(view: {
  readonly text: string;
  readonly terminal: string | null;
  readonly metrics?: TurnMetrics;
}): { text: string; terminal: string | null; metrics?: TurnMetrics } {
  return {
    text: sanitizeAssistantForDisplay(view.text),
    terminal: view.terminal,
    ...(view.metrics !== undefined ? { metrics: view.metrics } : {}),
  };
}
