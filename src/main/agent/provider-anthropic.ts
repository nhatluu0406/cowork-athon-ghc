import {
  Provider,
  Message,
  ToolSpec,
  ChatCallbacks,
  ProviderError,
  toolSpecToAnthropic,
  contentText,
  ContentPart,
} from './types';
import { MAX_RETRIES, isContextOverflow, dropOldestTurn, retryAfterSeconds, waitOrCancel } from './provider-base';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;
const FALLBACK_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

function userContentBlocks(content: string | ContentPart[]): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const blocks = content.map((p) =>
    p.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } }
      : { type: 'text', text: p.text },
  );
  return blocks.length ? blocks : [{ type: 'text', text: '' }];
}

export interface AnthropicConf {
  base_url?: string;
  api_key?: string;
  model: string;
}

interface AnthropicApiMessage {
  role: 'user' | 'assistant';
  content: any[];
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly model: string;

  constructor(private conf: AnthropicConf) {
    this.model = conf.model;
  }

  private url(): string {
    const base = (this.conf.base_url || 'https://api.anthropic.com').replace(/\/+$/, '');
    return `${base}/v1/messages`;
  }

  private headers(): Record<string, string> {
    if (!this.conf.api_key) {
      throw new ProviderError('Anthropic API key is not configured.');
    }
    return {
      'content-type': 'application/json',
      'x-api-key': this.conf.api_key,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  async listModels(): Promise<string[]> {
    const base = (this.conf.base_url || 'https://api.anthropic.com').replace(/\/+$/, '');
    try {
      const resp = await fetch(`${base}/v1/models`, { headers: this.headers() });
      if (resp.status < 400) {
        const body = (await resp.json()) as { data?: Array<{ id?: string }> };
        const ids = (body.data || []).map((m) => m.id).filter((id): id is string => !!id);
        if (ids.length) return ids;
      }
    } catch {
      // fall through to fallback list
    }
    return [...FALLBACK_MODELS];
  }

  private split(messages: Message[]): { system: string; api: AnthropicApiMessage[] } {
    const systemParts: string[] = [];
    const api: (AnthropicApiMessage & { _tool?: boolean })[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        const text = contentText(m.content);
        if (text) systemParts.push(text);
      } else if (m.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: contentText(m.content),
        };
        const last = api[api.length - 1];
        if (last && last.role === 'user' && last._tool) {
          last.content.push(block);
        } else {
          api.push({ role: 'user', content: [block], _tool: true });
        }
      } else if (m.role === 'assistant') {
        const blocks: any[] = [];
        const text = contentText(m.content);
        if (text) blocks.push({ type: 'text', text });
        for (const tc of m.tool_calls || []) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} });
        }
        api.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
      } else {
        api.push({ role: 'user', content: userContentBlocks(m.content) });
      }
    }
    return { system: systemParts.join('\n\n'), api: api.map(({ _tool, ...rest }) => rest) };
  }

  async chat(messages: Message[], tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message> {
    const { onText, onReasoning, cancel } = callbacks;
    let work = [...messages];
    const payload: Record<string, any> = { model: this.model, max_tokens: MAX_TOKENS, stream: true };
    if (tools && tools.length) payload.tools = tools.map(toolSpecToAnthropic);

    const textParts: string[] = [];
    const blocks: Record<number, { id: string; name: string; json: string }> = {};

    const controller = new AbortController();

    let resp: Response | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const { system, api } = this.split(work);
      payload.messages = api;
      if (system) payload.system = system;
      else delete payload.system;

      resp = await fetch(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).catch((exc) => {
        if (controller.signal.aborted) return undefined;
        throw new ProviderError(`Could not reach the Anthropic API: ${exc}`);
      });

      if (!resp) {
        return { role: 'assistant', content: textParts.join(''), tool_calls: [] };
      }

      if (resp.status >= 400) {
        const wait = retryAfterSeconds(resp.headers, '');
        const bodyText = await resp.text();
        const err = this.errorText(resp.status, bodyText);
        if ((resp.status === 429 || resp.status === 529) && attempt <= MAX_RETRIES) {
          const cancelled = await waitOrCancel(wait, cancel, onText, attempt);
          if (cancelled) return { role: 'assistant', content: '', tool_calls: [] };
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

    if (!resp || !resp.body) {
      return { role: 'assistant', content: '', tool_calls: [] };
    }

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
        throw new ProviderError(`Anthropic stream error: ${exc}`);
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
        if (!data) continue;
        let evt: any;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        const etype = evt.type;
        if (etype === 'content_block_start') {
          const i = evt.index ?? 0;
          const cb = evt.content_block || {};
          if (cb.type === 'tool_use') {
            blocks[i] = { id: cb.id || '', name: cb.name || '', json: '' };
          }
        } else if (etype === 'content_block_delta') {
          const i = evt.index ?? 0;
          const delta = evt.delta || {};
          if (delta.type === 'text_delta') {
            const piece = delta.text || '';
            if (piece) {
              textParts.push(piece);
              if (onText) onText(piece);
            }
          } else if (delta.type === 'thinking_delta') {
            if (onReasoning && delta.thinking) onReasoning(delta.thinking);
          } else if (delta.type === 'input_json_delta' && blocks[i]) {
            blocks[i].json += delta.partial_json || '';
          }
        } else if (etype === 'message_stop') {
          break outer;
        } else if (etype === 'error') {
          throw new ProviderError(`Anthropic: ${evt.error?.message || 'error'}`);
        }
      }
    }

    const toolCalls = Object.keys(blocks)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => {
        const b = blocks[i];
        let args: Record<string, any> = {};
        try {
          args = b.json.trim() ? JSON.parse(b.json) : {};
        } catch {
          args = { _raw: b.json };
        }
        return { id: b.id, name: b.name, arguments: args };
      });

    return { role: 'assistant', content: textParts.join(''), tool_calls: toolCalls };
  }

  private errorText(status: number, bodyText: string): string {
    try {
      const body = JSON.parse(bodyText);
      const msg = body?.error?.message || JSON.stringify(body);
      return `Anthropic error ${status}: ${msg}`;
    } catch {
      return `Anthropic error ${status}: ${bodyText.slice(0, 300)}`;
    }
  }
}
