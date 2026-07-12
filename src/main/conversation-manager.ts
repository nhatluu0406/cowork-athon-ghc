import { Message, StreamEvent } from './agent/types';

export type RunTurnFn = (
  messages: Message[],
  emit: (event: StreamEvent) => void,
  cancel: () => boolean,
) => Promise<Message[]>;

export interface SendResult {
  messageId: string;
  queued: boolean;
}

interface PendingSend {
  messageId: string;
  userMessage: Message;
  getHistory: () => Message[];
  onEvent: (messageId: string, event: StreamEvent) => void;
}

interface ActiveSend {
  cancelled: boolean;
}

let counter = 0;
function nextMessageId(): string {
  counter += 1;
  return `msg_${counter}`;
}

export class ConversationManager {
  private queues = new Map<string, PendingSend[]>();
  private active = new Map<string, Map<string, ActiveSend>>();

  constructor(private opts: { maxParallel: number; runTurn: RunTurnFn }) {}

  activeCount(conversationId: string): number {
    return this.active.get(conversationId)?.size ?? 0;
  }

  queuedCount(conversationId: string): number {
    return this.queues.get(conversationId)?.length ?? 0;
  }

  send(
    conversationId: string,
    userMessage: Message,
    getHistory: () => Message[],
    onEvent: (messageId: string, event: StreamEvent) => void,
  ): SendResult {
    const messageId = nextMessageId();
    const pending: PendingSend = { messageId, userMessage, getHistory, onEvent };

    if (!this.queues.has(conversationId)) this.queues.set(conversationId, []);
    if (!this.active.has(conversationId)) this.active.set(conversationId, new Map());

    const activeMap = this.active.get(conversationId)!;
    if (activeMap.size >= this.opts.maxParallel) {
      this.queues.get(conversationId)!.push(pending);
      return { messageId, queued: true };
    }

    this.start(conversationId, pending);
    return { messageId, queued: false };
  }

  cancel(conversationId: string, messageId: string): boolean {
    const activeSend = this.active.get(conversationId)?.get(messageId);
    if (!activeSend) return false;
    activeSend.cancelled = true;
    return true;
  }

  private start(conversationId: string, pending: PendingSend): void {
    const activeMap = this.active.get(conversationId)!;
    const activeSend: ActiveSend = { cancelled: false };
    activeMap.set(pending.messageId, activeSend);

    const messages = [...pending.getHistory(), pending.userMessage];
    const emit = (event: StreamEvent) => pending.onEvent(pending.messageId, event);
    const cancel = () => activeSend.cancelled;

    this.opts
      .runTurn(messages, emit, cancel)
      .catch(() => undefined)
      .then(() => {
        activeMap.delete(pending.messageId);
        this.dequeueNext(conversationId);
      });
  }

  private dequeueNext(conversationId: string): void {
    const queue = this.queues.get(conversationId);
    if (!queue || !queue.length) return;
    const activeMap = this.active.get(conversationId)!;
    if (activeMap.size >= this.opts.maxParallel) return;
    const next = queue.shift()!;
    this.start(conversationId, next);
  }
}
