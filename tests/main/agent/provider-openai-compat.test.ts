import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatProvider } from '../../../src/main/agent/provider-openai-compat';
import { Message } from '../../../src/main/agent/types';

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
}

describe('OpenAICompatProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams content deltas and returns the assembled assistant message', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
      '',
    ];
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: sseStream(events),
    } as unknown as Response);

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.example/v1', api_key: 'k', model: 'gpt-4o-mini' });
    const chunks: string[] = [];
    const result = await provider.chat([{ role: 'user', content: 'hi' }], null, { onText: (t) => chunks.push(t) });

    expect(chunks.join('')).toBe('Hello world');
    expect(result.content).toBe('Hello world');
  });

  it('routes reasoning_content to onReasoning, not the answer', async () => {
    const events = [
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      'data: [DONE]',
      '',
    ];
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: sseStream(events),
    } as unknown as Response);

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.example/v1', model: 'qwen' });
    const textChunks: string[] = [];
    const reasoningChunks: string[] = [];
    const result = await provider.chat([{ role: 'user', content: 'hi' }], null, {
      onText: (t) => textChunks.push(t),
      onReasoning: (r) => reasoningChunks.push(r),
    });

    expect(reasoningChunks.join('')).toBe('thinking...');
    expect(textChunks.join('')).toBe('answer');
    expect(result.content).toBe('answer');
  });

  it('assembles streamed tool_calls fragments into a complete tool call', async () => {
    const events = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"save_file","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"filename\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.md\\"}"}}]}}]}',
      'data: [DONE]',
      '',
    ];
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: sseStream(events),
    } as unknown as Response);

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.example/v1', model: 'gpt-4o-mini' });
    const result = await provider.chat([{ role: 'user', content: 'save' }], null, {});

    expect(result.tool_calls).toEqual([{ id: 'call_1', name: 'save_file', arguments: { filename: 'a.md' } }]);
  });

  it('throws ProviderError when base_url is missing', async () => {
    const provider = new OpenAICompatProvider({ base_url: '', model: 'gpt-4o-mini' });
    await expect(provider.chat([{ role: 'user', content: 'hi' }], null, {})).rejects.toThrow(
      'base_url is not configured for the OpenAI-compatible provider.',
    );
  });

  it('aborts the in-flight fetch request when cancel() returns true mid-stream', async () => {
    // A stream that never closes/emits further bytes after the first chunk,
    // simulating an upstream connection that goes silent after headers arrive.
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const silentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n'));
        // Deliberately do not close the stream or enqueue more data.
      },
    });

    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        body: silentStream,
      } as unknown as Response);
    });
    global.fetch = fetchMock;

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.example/v1', model: 'gpt-4o-mini' });

    // cancel() returns false on the first check (before the blocking read), then
    // true afterwards — this exercises the loop's second cancel() check, which is
    // the one that must actually tear down the stalled network request.
    let cancelCalls = 0;
    const cancel = () => {
      cancelCalls += 1;
      return cancelCalls > 1;
    };

    const result = await provider.chat([{ role: 'user', content: 'hi' }], null, { cancel });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
    // The stream never sent [DONE], so the partial assembled message
    // (no text yet, since the "Hel" chunk arrived before a newline was fully
    // processed and the loop broke) is returned instead of throwing.
    expect(result.tool_calls).toEqual([]);

    controllerRef?.close();
  });

  it('converts ContentPart[] user content into text + image_url data-URI parts', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"seen"}}]}',
      'data: [DONE]',
      '',
    ];
    let capturedBody: any;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({ status: 200, headers: new Headers(), body: sseStream(events) } as unknown as Response);
    });

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.test/v1', api_key: 'k', model: 'gpt-4o-mini' });
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image', mimeType: 'image/jpeg', data: 'aWNvbg==' },
        ],
      },
    ];
    await provider.chat(messages, null, {});

    expect(capturedBody.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aWNvbg==' } },
        ],
      },
    ]);
  });
});

describe('system message merging', () => {
  it('merges multiple system messages into a single leading one (gateway compatibility)', async () => {
    const events = ['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]', ''];
    let capturedBody: any;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({ status: 200, headers: new Headers(), body: sseStream(events) } as unknown as Response);
    });

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.test/v1', api_key: 'k', model: 'qwen' });
    const messages: Message[] = [
      { role: 'system', content: 'Base prompt.' },
      { role: 'system', content: '[[ACTIVE_SKILLS]]\nFollow the skills.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ];
    await provider.chat(messages, null, {});

    const systemMsgs = capturedBody.messages.filter((m: any) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(capturedBody.messages[0]).toEqual({
      role: 'system',
      content: 'Base prompt.\n\n[[ACTIVE_SKILLS]]\nFollow the skills.',
    });
    expect(capturedBody.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('sends no system message when none exist', async () => {
    const events = ['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]', ''];
    let capturedBody: any;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({ status: 200, headers: new Headers(), body: sseStream(events) } as unknown as Response);
    });

    const provider = new OpenAICompatProvider({ base_url: 'https://gw.test/v1', api_key: 'k', model: 'qwen' });
    await provider.chat([{ role: 'user', content: 'hi' }], null, {});
    expect(capturedBody.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });
});
