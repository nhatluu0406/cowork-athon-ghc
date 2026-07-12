import { describe, it, expect, vi } from 'vitest';
import {
  isContextOverflow,
  dropOldestTurn,
  retryAfterSeconds,
  stripThink,
  ThinkStreamSplitter,
} from '../../../src/main/agent/provider-base';
import { Message } from '../../../src/main/agent/types';

describe('isContextOverflow', () => {
  it('detects known context-overflow phrases', () => {
    expect(isContextOverflow('Error: maximum context length exceeded')).toBe(true);
    expect(isContextOverflow('context_length_exceeded')).toBe(true);
    expect(isContextOverflow('please reduce the length of the messages')).toBe(true);
    expect(isContextOverflow('unauthorized')).toBe(false);
  });
});

describe('dropOldestTurn', () => {
  it('drops the oldest user->assistant turn but keeps leading system messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply2' },
    ];
    const { messages: out, changed } = dropOldestTurn(messages);
    expect(changed).toBe(true);
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply2' },
    ]);
  });

  it('returns unchanged when only one turn remains', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'only' },
    ];
    const { messages: out, changed } = dropOldestTurn(messages);
    expect(changed).toBe(false);
    expect(out).toBe(messages);
  });
});

describe('retryAfterSeconds', () => {
  it('reads the Retry-After header when present', () => {
    const headers = new Headers({ 'Retry-After': '5' });
    expect(retryAfterSeconds(headers, '')).toBe(5);
  });

  it('falls back to parsing "in Ns" from the body', () => {
    const headers = new Headers();
    expect(retryAfterSeconds(headers, 'rate limited, try again in 12s')).toBe(12);
  });

  it('defaults to 20 when nothing is found', () => {
    const headers = new Headers();
    expect(retryAfterSeconds(headers, 'no hints here')).toBe(20);
  });

  it('caps the wait at 120 seconds', () => {
    const headers = new Headers({ 'Retry-After': '999' });
    expect(retryAfterSeconds(headers, '')).toBe(120);
  });
});

describe('stripThink', () => {
  it('removes an inline <think> block', () => {
    expect(stripThink('<think>internal reasoning</think>The answer is 42.')).toBe('The answer is 42.');
  });

  it('returns text unchanged when there is no think block', () => {
    expect(stripThink('plain answer')).toBe('plain answer');
  });
});

describe('ThinkStreamSplitter', () => {
  it('routes text inside <think>...</think> to onReasoning and the rest to onText', () => {
    const textChunks: string[] = [];
    const reasoningChunks: string[] = [];
    const splitter = new ThinkStreamSplitter(
      (t) => textChunks.push(t),
      (r) => reasoningChunks.push(r),
    );
    splitter.feed('Hello <think>pondering');
    splitter.feed(' more</think> world');
    splitter.flush();
    expect(textChunks.join('')).toBe('Hello  world');
    expect(reasoningChunks.join('')).toBe('pondering more');
  });

  it('holds back a partial tag across chunk boundaries', () => {
    const textChunks: string[] = [];
    const splitter = new ThinkStreamSplitter((t) => textChunks.push(t));
    splitter.feed('Hello <thi');
    splitter.feed('nk>secret</think> world');
    splitter.flush();
    expect(textChunks.join('')).toBe('Hello  world');
  });
});
