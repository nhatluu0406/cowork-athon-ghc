import { Message, TextCallback, CancelFn } from './types';

export const MAX_RETRIES = 6;

const CONTEXT_OVERFLOW_PHRASES = [
  'context length',
  'context window',
  'maximum context',
  'context_length_exceeded',
  'input tokens',
  'reduce the length',
  'too many tokens',
  'maximum_tokens',
  'max_tokens',
  'prompt is too long',
];

export function isContextOverflow(text: string): boolean {
  const t = (text || '').toLowerCase();
  return CONTEXT_OVERFLOW_PHRASES.some((phrase) => t.includes(phrase));
}

export function dropOldestTurn(messages: Message[]): { messages: Message[]; changed: boolean } {
  const n = messages.length;
  let i = 0;
  while (i < n && messages[i].role === 'system') i++;
  if (i >= n) return { messages, changed: false };
  let j = i + 1;
  while (j < n && messages[j].role !== 'user') j++;
  if (j >= n) return { messages, changed: false };
  return { messages: [...messages.slice(0, i), ...messages.slice(j)], changed: true };
}

export function retryAfterSeconds(headers: Headers, bodyText: string): number {
  const ra = headers.get('Retry-After');
  if (ra) {
    const parsed = parseFloat(ra);
    if (!Number.isNaN(parsed)) return Math.min(120, Math.max(1, Math.round(parsed)));
  }
  const match = /in\s+(\d+)\s*s/i.exec(bodyText || '');
  if (match) return Math.min(120, Math.max(1, parseInt(match[1], 10)));
  return 20;
}

export async function waitOrCancel(
  seconds: number,
  cancel: CancelFn | undefined,
  onText: TextCallback | undefined,
  attempt: number,
): Promise<boolean> {
  if (onText) onText(`\n⏳ Rate limit — waiting ${seconds}s, then retrying (attempt ${attempt})…\n`);
  const steps = Math.max(1, seconds * 2);
  for (let i = 0; i < steps; i++) {
    if (cancel && cancel()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const THINK_BLOCK = /<think>[\s\S]*?<\/think>\s*/gi;

export function stripThink(text: string): string {
  if (!text || !text.toLowerCase().includes('<think>')) return text;
  return text.replace(THINK_BLOCK, '').trim();
}

export class ThinkStreamSplitter {
  private static OPEN = '<think>';
  private static CLOSE = '</think>';
  private buf = '';
  private inThink = false;

  constructor(
    private onText?: TextCallback,
    private onReasoning?: TextCallback,
  ) {}

  feed(piece: string): void {
    if (!piece) return;
    this.buf += piece;
    this.drain();
  }

  flush(): void {
    if (this.buf) {
      this.emit(this.buf);
      this.buf = '';
    }
  }

  private emit(text: string): void {
    if (!text) return;
    const cb = this.inThink ? this.onReasoning : this.onText;
    if (cb) cb(text);
  }

  private partialTail(tag: string): number {
    for (let k = Math.min(tag.length - 1, this.buf.length); k > 0; k--) {
      if (this.buf.slice(-k).toLowerCase() === tag.slice(0, k).toLowerCase()) return k;
    }
    return 0;
  }

  private drain(): void {
    while (this.buf) {
      const tag = this.inThink ? ThinkStreamSplitter.CLOSE : ThinkStreamSplitter.OPEN;
      const idx = this.buf.toLowerCase().indexOf(tag);
      if (idx === -1) {
        const keep = this.partialTail(tag);
        const cut = this.buf.length - keep;
        if (cut > 0) {
          this.emit(this.buf.slice(0, cut));
          this.buf = this.buf.slice(cut);
        }
        return;
      }
      this.emit(this.buf.slice(0, idx));
      this.buf = this.buf.slice(idx + tag.length);
      this.inThink = !this.inThink;
    }
  }
}
