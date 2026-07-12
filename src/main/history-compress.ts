import { Message } from './agent/types';

/**
 * Trims conversation history to reduce token usage: keeps every leading
 * system message plus the last `keepTurns` user-initiated turns (a "turn"
 * starts at a user message and runs up to, but not including, the next
 * user message). Returns the original array unchanged (same reference)
 * when there is nothing to trim.
 */
export function compressHistory(
  messages: Message[],
  keepTurns = 3,
): { messages: Message[]; removed: number } {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const userStarts = rest.reduce<number[]>((acc, m, i) => {
    if (m.role === 'user') acc.push(i);
    return acc;
  }, []);

  if (userStarts.length <= keepTurns) {
    return { messages, removed: 0 };
  }

  const cutIndex = userStarts[userStarts.length - keepTurns];
  const trimmedRest = rest.slice(cutIndex);
  return {
    messages: [...systemMessages, ...trimmedRest],
    removed: cutIndex,
  };
}
