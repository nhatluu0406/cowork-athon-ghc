import { Provider, Message, ToolCall, ToolSpec, ChatCallbacks, ProviderError, toolSpecToOpenAI, contentText, ContentPart } from './types';
import {
  MAX_RETRIES,
  isContextOverflow,
  dropOldestTurn,
  retryAfterSeconds,
  waitOrCancel,
  ThinkStreamSplitter,
  stripThink,
} from './provider-base';

function userContentParts(content: string | ContentPart[]): string | any[] {
  if (typeof content === 'string') return content;
  return content.map((p) =>
    p.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }
      : { type: 'text', text: p.text },
  );
}

export interface OpenAICompatConf {
  base_url: string;
  api_key?: string;
  model: string;
}

interface ToolAccSlot {
  id: string;
  name: string;
  args: string;
}

export class OpenAICompatProvider implements Provider {
  readonly name = 'openai_compat';
  readonly model: string;

  constructor(private conf: OpenAICompatConf) {
    this.model = conf.model;
  }

  private url(): string {
    const base = (this.conf.base_url || '').replace(/\/+$/, '');
    if (!base) throw new ProviderError('base_url is not configured for the OpenAI-compatible provider.');
    return `${base}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.conf.api_key) headers.Authorization = `Bearer ${this.conf.api_key}`;
    return headers;
  }

  async listModels(): Promise<string[]> {
    const base = (this.conf.base_url || '').replace(/\/+$/, '');
    if (!base) return [];
    try {
      const resp = await fetch(`${base}/models`, { headers: this.headers() });
      if (resp.status >= 400) return [];
      const body = (await resp.json()) as { data?: Array<{ id?: string }> };
      return (body.data || []).map((m) => m.id).filter((id): id is string => !!id);
    } catch {
      return [];
    }
  }

  private toApiMessages(messages: Message[]): any[] {
    // Some OpenAI-compatible gateways (e.g. the FPT internal gateway serving
    // Qwen) return an EMPTY stream when the request carries more than one
    // system message — the chat template silently rejects it. Merge every
    // system message into a single leading one (same join the Anthropic
    // provider already does).
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => contentText(m.content))
      .filter((t) => t.trim());
    const rest = messages.filter((m) => m.role !== 'system');
    const merged: any[] = systemParts.length ? [{ role: 'system', content: systemParts.join('\n\n') }] : [];
    return merged.concat(rest.map((m) => {
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
        return {
          role: 'assistant',
          content: contentText(m.content),
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
          })),
        };
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id || '', content: contentText(m.content) };
      }
      return { role: m.role, content: userContentParts(m.content) };
    }));
  }

  async chat(messages: Message[], tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message> {
    const { onText, onReasoning, cancel } = callbacks;
    let work = [...messages];
    const payload: Record<string, any> = { model: this.model, stream: true };
    if (tools && tools.length) {
      payload.tools = tools.map(toolSpecToOpenAI);
      payload.tool_choice = 'auto';
    }

    const textParts: string[] = [];
    const toolAcc: Record<number, ToolAccSlot> = {};

    const emitAnswer = (t: string) => {
      textParts.push(t);
      if (onText) onText(t);
    };
    const splitter = new ThinkStreamSplitter(emitAnswer, onReasoning);

    const controller = new AbortController();

    let resp: Response | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      payload.messages = this.toApiMessages(work);
      resp = await fetch(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).catch((exc) => {
        if (controller.signal.aborted) return undefined;
        throw new ProviderError(`Could not reach the gateway: ${exc}`);
      });

      if (!resp) {
        return assembleAssistant(textParts, toolAcc);
      }

      if (resp.status >= 400) {
        const wait = retryAfterSeconds(resp.headers, '');
        const bodyText = await resp.text();
        const err = this.errorText(resp.status, bodyText);
        if (resp.status === 429 && attempt <= MAX_RETRIES) {
          const cancelled = await waitOrCancel(wait, cancel, onText, attempt);
          if (cancelled) return assembleAssistant(textParts, toolAcc);
          continue;
        }
        if (resp.status === 400 && attempt <= MAX_RETRIES && isContextOverflow(err)) {
          const { messages: trimmed, changed } = dropOldestTurn(work);
          if (changed) {
            work = trimmed;
            if (onText) onText('\n✂ Lịch sử quá dài — tự nén bớt rồi thử lại…\n');
            continue;
          }
        }
        throw new ProviderError(err);
      }
      break;
    }

    if (!resp || !resp.body) return assembleAssistant(textParts, toolAcc);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    outer: while (true) {
      if (cancel && cancel()) {
        controller.abort();
        break;
      }
      let readResult: { done: boolean; value?: Uint8Array };
      try {
        readResult = await reader.read();
      } catch (exc) {
        if (controller.signal.aborted) break outer;
        throw new ProviderError(`Gateway stream error: ${exc}`);
      }
      const { done, value } = readResult;
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (cancel && cancel()) {
          controller.abort();
          break outer;
        }
        if (!raw || !raw.startsWith('data:')) continue;
        const data = raw.slice('data:'.length).trim();
        if (data === '[DONE]') break outer;
        if (!data) continue;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const choices = chunk.choices || [];
        if (!choices.length) continue;
        const delta = choices[0].delta || {};
        const rc = delta.reasoning_content || delta.reasoning;
        if (rc && onReasoning) onReasoning(rc);
        if (delta.content) splitter.feed(delta.content);
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          const slot = (toolAcc[i] = toolAcc[i] || { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          const fn = tc.function || {};
          if (fn.name) slot.name = fn.name;
          if (fn.arguments) slot.args += fn.arguments;
        }
      }
    }

    splitter.flush();
    return assembleAssistant(textParts, toolAcc);
  }

  private errorText(status: number, bodyText: string): string {
    try {
      const body = JSON.parse(bodyText);
      const msg = body?.error?.message || JSON.stringify(body);
      return `Gateway error ${status}: ${msg}`;
    } catch {
      return `Gateway error ${status}: ${bodyText.slice(0, 300)}`;
    }
  }
}

function assembleAssistant(textParts: string[], toolAcc: Record<number, ToolAccSlot>): Message {
  const toolCalls: ToolCall[] = Object.keys(toolAcc)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((i) => toolAcc[i].name)
    .map((i) => {
      const slot = toolAcc[i];
      let args: Record<string, any> = {};
      try {
        args = slot.args.trim() ? JSON.parse(slot.args) : {};
      } catch {
        args = { _raw: slot.args };
      }
      return { id: slot.id || `call_${i}`, name: slot.name, arguments: args };
    });
  return { role: 'assistant', content: stripThink(textParts.join('')), tool_calls: toolCalls };
}
