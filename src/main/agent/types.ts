export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }; // raw base64, no "data:" URI prefix

export interface Message {
  role: Role;
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Original user-typed text before attachment augmentation — display only, ignored by providers. */
  display?: string;
  /** Absolute paths of files attached to this user message — display only, ignored by providers. */
  attachments?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export function toolSpecToOpenAI(spec: ToolSpec) {
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  };
}

export function toolSpecToAnthropic(spec: ToolSpec) {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters,
  };
}

export type TextCallback = (piece: string) => void;
export type CancelFn = () => boolean;

export interface PlanStep {
  title: string;
  status: 'pending' | 'running' | 'done';
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'assistant_done'; content: string }
  | { type: 'plan_set'; steps: PlanStep[] }
  | {
      type: 'tool_proposed';
      id: string;
      name: string;
      args: Record<string, any>;
      preview: { kind: string; title: string; text: string };
    }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; output: string; path?: string }
  | { type: 'outputs_added' | 'outputs_removed'; paths: string[] }
  | { type: 'error'; message: string };

export class ProviderError extends Error {}

export interface ChatCallbacks {
  onText?: TextCallback;
  onReasoning?: TextCallback;
  cancel?: CancelFn;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  chat(messages: Message[], tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message>;
  listModels(): Promise<string[]>;
}

/** Flatten message content to plain text (text parts joined with newlines; image parts skipped). */
export function contentText(content: string | ContentPart[] | undefined | null): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}
