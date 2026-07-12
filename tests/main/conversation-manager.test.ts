import { describe, it, expect, vi } from 'vitest';
import { ConversationManager } from '../../src/main/conversation-manager';
import { Message, StreamEvent } from '../../src/main/agent/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ConversationManager', () => {
  it('runs up to maxParallel sends concurrently for the same conversation', async () => {
    const gate1 = deferred<Message[]>();
    const gate2 = deferred<Message[]>();
    const gate3 = deferred<Message[]>();
    const gates = [gate1, gate2, gate3];
    let callIndex = 0;
    const runTurn = vi.fn(() => gates[callIndex++].promise);

    const manager = new ConversationManager({ maxParallel: 2, runTurn });
    manager.send('conv-1', { role: 'user', content: 'one' }, () => [], () => {});
    manager.send('conv-1', { role: 'user', content: 'two' }, () => [], () => {});
    manager.send('conv-1', { role: 'user', content: 'three' }, () => [], () => {});

    await Promise.resolve(); // let microtasks schedule the first two
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(manager.activeCount('conv-1')).toBe(2);
    expect(manager.queuedCount('conv-1')).toBe(1);

    gate1.resolve([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(runTurn).toHaveBeenCalledTimes(3);
    expect(manager.queuedCount('conv-1')).toBe(0);

    gate2.resolve([]);
    gate3.resolve([]);
  });

  it('runs different conversations fully independently', async () => {
    const runTurn = vi.fn().mockResolvedValue([]);
    const manager = new ConversationManager({ maxParallel: 1, runTurn });
    manager.send('conv-a', { role: 'user', content: 'a' }, () => [], () => {});
    manager.send('conv-b', { role: 'user', content: 'b' }, () => [], () => {});

    await Promise.resolve();
    expect(runTurn).toHaveBeenCalledTimes(2);
  });

  it('cancel() sets the cancel flag observed by runTurn and returns true when the message was active', async () => {
    let capturedCancel: (() => boolean) | undefined;
    const runTurn = vi.fn((_messages: Message[], _emit: any, cancel: () => boolean) => {
      capturedCancel = cancel;
      return new Promise<Message[]>(() => {}); // never resolves
    });
    const manager = new ConversationManager({ maxParallel: 1, runTurn });
    const { messageId } = manager.send('conv-1', { role: 'user', content: 'hi' }, () => [], () => {});

    await Promise.resolve();
    const cancelled = manager.cancel('conv-1', messageId);
    expect(cancelled).toBe(true);
    expect(capturedCancel!()).toBe(true);
  });

  it('cancel() returns false for an unknown messageId', () => {
    const manager = new ConversationManager({ maxParallel: 1, runTurn: vi.fn() });
    expect(manager.cancel('conv-1', 'no-such-id')).toBe(false);
  });

  it('forwards emitted events tagged with the originating messageId', async () => {
    const runTurn = vi.fn((_messages: Message[], emit: (e: StreamEvent) => void) => {
      emit({ type: 'text', delta: 'hi' });
      return Promise.resolve([]);
    });
    const manager = new ConversationManager({ maxParallel: 1, runTurn });
    const received: Array<{ messageId: string; event: StreamEvent }> = [];
    const { messageId } = manager.send('conv-1', { role: 'user', content: 'hi' }, () => [], (id, event) =>
      received.push({ messageId: id, event }),
    );

    await Promise.resolve();
    expect(received).toEqual([{ messageId, event: { type: 'text', delta: 'hi' } }]);
  });
});
