import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../../../src/main/agent/provider-anthropic';
import { Message } from '../../../src/main/agent/types';

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams text deltas and returns the assembled assistant message', async () => {
    const events = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      'data: {"type":"message_stop"}',
      '',
    ];
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: sseStream(events),
    } as unknown as Response);

    const provider = new AnthropicProvider({ api_key: 'test-key', model: 'claude-sonnet-4-6' });
    const chunks: string[] = [];
    const messages: Message[] = [{ role: 'user', content: 'hi' }];
    const result = await provider.chat(messages, null, { onText: (t) => chunks.push(t) });

    expect(chunks.join('')).toBe('Hello world');
    expect(result).toEqual({ role: 'assistant', content: 'Hello world', tool_calls: [] });
  });

  it('assembles a tool_use block into a tool call', async () => {
    const events = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"save_file"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"filename\\":"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a.md\\"}"}}',
      'data: {"type":"message_stop"}',
      '',
    ];
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: sseStream(events),
    } as unknown as Response);

    const provider = new AnthropicProvider({ api_key: 'test-key', model: 'claude-sonnet-4-6' });
    const result = await provider.chat([{ role: 'user', content: 'save a file' }], null, {});

    expect(result.tool_calls).toEqual([{ id: 'call_1', name: 'save_file', arguments: { filename: 'a.md' } }]);
  });

  it('throws ProviderError when api_key is missing', async () => {
    const provider = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    await expect(provider.chat([{ role: 'user', content: 'hi' }], null, {})).rejects.toThrow(
      'Anthropic API key is not configured.',
    );
  });

  it('retries on 429 then succeeds on the next attempt', async () => {
    const okEvents = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      'data: {"type":"message_stop"}',
      '',
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        headers: new Headers({ 'Retry-After': '0' }),
        text: async () => '{"error":{"message":"rate limited"}}',
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: sseStream(okEvents),
      } as unknown as Response);
    global.fetch = fetchMock;

    const provider = new AnthropicProvider({ api_key: 'test-key', model: 'claude-sonnet-4-6' });
    const result = await provider.chat([{ role: 'user', content: 'hi' }], null, {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('ok');
  });

  it('aborts the in-flight fetch request when cancel() returns true mid-stream', async () => {
    // A stream that never closes/emits further bytes after the first chunk,
    // simulating an upstream connection that goes silent after headers arrive.
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const silentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(
          encoder.encode(
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n',
          ),
        );
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

    const provider = new AnthropicProvider({ api_key: 'test-key', model: 'claude-sonnet-4-6' });

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
    // The stream never sent message_stop, so the partial assembled message
    // (no text yet) is returned instead of throwing.
    expect(result).toEqual({ role: 'assistant', content: '', tool_calls: [] });

    controllerRef?.close();
  });

  it('converts ContentPart[] user content into text + base64 image blocks', async () => {
    const events = [
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"seen"}}',
      'data: {"type":"message_stop"}',
      '',
    ];
    let capturedBody: any;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({ status: 200, headers: new Headers(), body: sseStream(events) } as unknown as Response);
    });

    const provider = new AnthropicProvider({ api_key: 'test-key', model: 'claude-sonnet-4-6' });
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this image?' },
          { type: 'image', mimeType: 'image/png', data: 'aWNvbg==' },
        ],
      },
    ];
    await provider.chat(messages, null, {});

    expect(capturedBody.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aWNvbg==' } },
        ],
      },
    ]);
  });
});
