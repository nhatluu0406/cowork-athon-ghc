import { describe, it, expect } from 'vitest';
import { compressHistory } from '../../src/main/history-compress';
import { Message } from '../../src/main/agent/types';

function userMsg(text: string): Message {
  return { role: 'user', content: text };
}
function assistantMsg(text: string): Message {
  return { role: 'assistant', content: text, tool_calls: [] };
}

describe('compressHistory', () => {
  it('keeps system messages and the last 3 user turns, dropping older ones', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      userMsg('turn 1'),
      assistantMsg('reply 1'),
      userMsg('turn 2'),
      assistantMsg('reply 2'),
      userMsg('turn 3'),
      assistantMsg('reply 3'),
      userMsg('turn 4'),
      assistantMsg('reply 4'),
    ];
    const { messages: out, removed } = compressHistory(messages);
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      userMsg('turn 2'),
      assistantMsg('reply 2'),
      userMsg('turn 3'),
      assistantMsg('reply 3'),
      userMsg('turn 4'),
      assistantMsg('reply 4'),
    ]);
    expect(removed).toBe(2); // turn 1 + reply 1 dropped
  });

  it('keeps multiple system messages at the front', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys A' },
      { role: 'system', content: 'sys B' },
      userMsg('turn 1'),
      userMsg('turn 2'),
      userMsg('turn 3'),
      userMsg('turn 4'),
    ];
    const { messages: out, removed } = compressHistory(messages);
    expect(out[0]).toEqual({ role: 'system', content: 'sys A' });
    expect(out[1]).toEqual({ role: 'system', content: 'sys B' });
    expect(removed).toBe(1); // only "turn 1" dropped
  });

  it('does nothing when there are 3 or fewer user turns', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      userMsg('turn 1'),
      assistantMsg('reply 1'),
      userMsg('turn 2'),
      userMsg('turn 3'),
    ];
    const { messages: out, removed } = compressHistory(messages);
    expect(out).toEqual(messages);
    expect(removed).toBe(0);
  });

  it('does nothing on an empty message array', () => {
    const { messages: out, removed } = compressHistory([]);
    expect(out).toEqual([]);
    expect(removed).toBe(0);
  });

  it('honors a custom keepTurns value', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      userMsg('turn 1'),
      userMsg('turn 2'),
      userMsg('turn 3'),
    ];
    const { messages: out, removed } = compressHistory(messages, 1);
    expect(out).toEqual([{ role: 'system', content: 'sys' }, userMsg('turn 3')]);
    expect(removed).toBe(2);
  });
});
