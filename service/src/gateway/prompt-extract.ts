/**
 * Mirrors `app/ui/src/transcript-context.ts`'s `USER_REQUEST_START`/`END` — the renderer wraps
 * the user's own typed message in these markers before appending system framing, prior-turn
 * context, attachments, and skills onto the same string it ultimately sends as chat content.
 * The Gateway log should show what the person actually typed, not the whole assembled payload.
 */
const USER_REQUEST_START = "<<<CGHC_CURRENT_USER_REQUEST>>>";
const USER_REQUEST_END = "<<<END_CGHC_CURRENT_USER_REQUEST>>>";

/** Best-effort: pull just the user's own message out of the fully-assembled dispatch text. */
export function extractUserRequestPreview(rawText: string): string {
  const start = rawText.indexOf(USER_REQUEST_START);
  const end = rawText.indexOf(USER_REQUEST_END);
  if (start === -1 || end === -1 || end <= start) return rawText;
  return rawText.slice(start + USER_REQUEST_START.length, end).trim();
}

interface ChatCompletionBody {
  readonly model?: unknown;
  readonly messages?: readonly { readonly role?: unknown; readonly content?: unknown }[];
}

/** Parse an OpenAI-compat chat-completions request body; never throws. */
export function parseChatCompletionRequest(
  raw: string,
): { readonly modelId?: string; readonly promptPreview?: string } {
  try {
    const body = JSON.parse(raw) as ChatCompletionBody;
    const modelId = typeof body.model === "string" ? body.model : undefined;
    const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
    const content = typeof lastUser?.content === "string" ? lastUser.content : undefined;
    const promptPreview = content !== undefined ? extractUserRequestPreview(content) : undefined;
    return {
      ...(modelId !== undefined ? { modelId } : {}),
      ...(promptPreview !== undefined ? { promptPreview } : {}),
    };
  } catch {
    return {};
  }
}
