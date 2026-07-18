/**
 * Gateway request-body parsing — the model id ONLY.
 *
 * Privacy (#38): the Gateway is an API-key routing proxy, not a prompt logger. It deliberately
 * does NOT extract, mask, store, or display the user's prompt text — persisting chat content to
 * the gateway log (a separate file from the conversation store) surprised users and duplicated
 * their messages outside the one place they live. Only the non-sensitive model id is read, so the
 * request log can still show which model each routed request used.
 */

interface ChatCompletionBody {
  readonly model?: unknown;
}

/** Parse an OpenAI-compat chat-completions request body for the model id; never throws. */
export function parseChatCompletionRequest(raw: string): { readonly modelId?: string } {
  try {
    const body = JSON.parse(raw) as ChatCompletionBody;
    const modelId = typeof body.model === "string" ? body.model : undefined;
    return modelId !== undefined ? { modelId } : {};
  } catch {
    return {};
  }
}
