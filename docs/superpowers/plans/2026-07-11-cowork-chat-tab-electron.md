# Tab Cowork (Chat) — Electron Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Cowork chat tab from the OldVersion PySide6 (Python) app to the Electron app, wiring the existing static `renderer/` UI to a real TypeScript backend that streams from Anthropic Claude and an OpenAI-compatible gateway, saves real text files, tracks a live plan checklist, and persists/lists conversation history — all running in the Electron main process.

**Architecture:** A `src/main` Node/TypeScript backend ports the canonical message/tool/provider model from `OldVersion/src/cowork_local` (providers/base.py, providers/anthropic.py, providers/openai_compat.py, core/chat_agent.py, core/tools.py, core/plan.py, config.py, core/history.py) into TypeScript modules with the same responsibilities. The main process exposes IPC handlers (`src/main/ipc.ts`) that the existing `renderer/` HTML/CSS calls through a `contextBridge` API (`src/preload/index.ts`). Per-conversation message queues in memory allow up to `max_parallel` concurrent in-flight sends per conversation, extra sends queued in-process. Everything is bundled by esbuild into `dist/` and Electron loads the bundled output.

**Tech Stack:** Electron 35, Node.js, TypeScript 5, esbuild (bundler + watch), `@anthropic-ai/sdk` is NOT used — providers are implemented with raw `fetch`/SSE parsing (to mirror the streaming/retry logic exactly, matching the Python `requests`-based implementation) rather than an SDK, so behavior (retry-after parsing, context-overflow trimming, `<think>` splitting) stays byte-for-byte controllable.

## Global Constraints

- Backend logic runs in the Electron **main process** in **TypeScript**, no Python subprocess, no embedded Python runtime.
- Build via **esbuild**, compiling `src/main`, `src/preload`, `src/renderer` into `dist/`; `npm run build` (one-shot) and `npm run dev` (watch mode). `package.json`'s `main` field points at the bundled `dist/main/index.js`.
- Keep both AI providers: **Anthropic Claude** (Messages API, SSE) and **OpenAI-compatible** (Chat Completions API, SSE) — same config keys and env var overrides as the Python app (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `COWORK_ACTIVE_PROVIDER`).
- Config file: `~/.cowork_local/config.json`, same JSON shape as `OldVersion/src/cowork_local/config.py::DEFAULT_CONFIG` (deep-merged with stored values, then env overrides applied) — so a config file written by the old Python app loads unmodified.
- History files: `~/.cowork_local/history/cowork__<session_id>.json`, same shape as `OldVersion/src/cowork_local/core/history.py::save_conversation` (`{kind, session_id, title, created, pinned, inputs, outputs, messages}`) — so history written by the old Python app loads unmodified.
- Use the existing `renderer/index.html` / `renderer/style.css` / `renderer/assets/` as-is (move into `src/renderer/`, only logic changes, no visual redesign).
- In scope: chat streaming (both providers), `save_file` (text only: `.md`/`.txt`/`.csv`/`.json`), `update_plan` tool + Plan panel, History (list/load/new/rename/pin/delete), per-conversation concurrent sends up to `max_parallel` (default 5) with queueing beyond that, Settings (provider/model/API key), Stop/cancel, 429 retry, context-overflow auto-trim.
- Out of scope (do not implement): attachments, Office document generation (.docx/.xlsx/.pptx/.pdf), Skills system (`/skill`), Teams webhook, Tab Code, Tab Structure/RAG, MS365, LibreOffice, packaging/distribution.

---

## File Structure

```
src/
├── main/
│   ├── index.ts              # entry: app lifecycle, BrowserWindow creation (ports current main.js)
│   ├── ipc.ts                 # ipcMain handlers: cowork:*, history:*, settings:*, shell:*
│   ├── config.ts              # AppConfig: load/save/deep-merge/env-override, path helpers
│   ├── history-store.ts       # save/load/list/delete/rename/setPinned conversation JSON files
│   ├── conversation-manager.ts # in-memory per-conversation queue + max_parallel gating + cancel
│   └── agent/
│       ├── types.ts            # Message, ToolCall, ToolSpec, Provider interface, StreamEvent union
│       ├── provider-base.ts     # shared retry/backoff/context-overflow/think-split helpers
│       ├── provider-anthropic.ts
│       ├── provider-openai-compat.ts
│       ├── provider-factory.ts  # builds a Provider from AppConfig
│       ├── plan.ts               # UPDATE_PLAN_SPEC tool spec + normalizePlanSteps
│       ├── save-file-tool.ts     # SAVE_FILE_SPEC + doSaveFile (text-only, titled filename)
│       └── run-cowork.ts         # the run_cowork loop: provider.chat -> tool_calls -> emit events
├── preload/
│   └── index.ts                # contextBridge: window.coworkAPI (send/cancel/history/settings/shell/window controls)
└── renderer/
    ├── index.html              # moved from renderer/index.html, unchanged markup
    ├── style.css                # moved from renderer/style.css, unchanged
    ├── assets/                  # moved from renderer/assets/
    └── index.ts                 # replaces renderer/app.js; wires UI to window.coworkAPI

tests/
├── main/agent/plan.test.ts
├── main/agent/save-file-tool.test.ts
├── main/agent/provider-anthropic.test.ts
├── main/agent/provider-openai-compat.test.ts
├── main/config.test.ts
├── main/history-store.test.ts
└── main/conversation-manager.test.ts

esbuild.config.mjs              # build script (one-shot + --watch)
tsconfig.json
package.json                    # updated: scripts, devDependencies (typescript, esbuild, vitest, @types/node)
```

`main.js`, `preload.js`, `renderer/app.js`, `renderer/index.html`, `renderer/style.css` at the project root are deleted once their replacements in `src/` are in place and building (Task 12).

We use **Vitest** for unit tests (fast, native ESM/TS support, no extra babel config) — added as a new devDependency.

---

### Task 1: Project scaffolding — TypeScript, esbuild, test runner

**Files:**
- Create: `package.json` (modify existing)
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `vitest.config.ts`
- Test: `tests/main/smoke.test.ts`

**Interfaces:**
- Produces: `npm run build` (bundles `src/main/index.ts` → `dist/main/index.js`, `src/preload/index.ts` → `dist/preload/index.js`, `src/renderer/index.ts` → `dist/renderer/index.js`), `npm run dev` (same, with `--watch`), `npm test` (runs vitest once), `npm run test:watch`.

- [ ] **Step 1: Install new devDependencies**

Run:
```bash
npm install --save-dev typescript esbuild vitest @types/node
```
Expected: `package.json` `devDependencies` gains `typescript`, `esbuild`, `vitest`, `@types/node` alongside the existing `electron`.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `esbuild.config.mjs`**

```js
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const commonOpts = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

const builds = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js', external: ['electron'] },
  { entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js', external: ['electron'] },
  {
    entryPoints: ['src/renderer/index.ts'],
    outfile: 'dist/renderer/index.js',
    platform: 'browser',
    target: 'es2020',
  },
];

async function run() {
  for (const build of builds) {
    const opts = { ...commonOpts, ...build };
    if (watch) {
      const ctx = await esbuild.context(opts);
      await ctx.watch();
    } else {
      await esbuild.build(opts);
    }
  }
  if (watch) {
    console.log('esbuild watching for changes...');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Update `package.json` scripts and main entry**

Modify `package.json`:
```json
{
  "name": "cowork-local",
  "version": "2.0.0",
  "description": "Cowork Local — AI Desktop Assistant by FPT Software",
  "main": "dist/main/index.js",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev:build": "node esbuild.config.mjs --watch",
    "start": "npm run build && electron .",
    "dev": "electron . --enable-logging",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "electron-builder"
  },
  "devDependencies": {
    "electron": "^35.0.0",
    "typescript": "^5.5.0",
    "esbuild": "^0.23.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.14.0"
  },
  "build": {
    "appId": "com.fptsoftware.cowork-local",
    "productName": "Cowork Local",
    "directories": {
      "output": "release"
    },
    "mac": {
      "category": "public.app-category.productivity"
    },
    "win": {
      "target": "nsis"
    }
  }
}
```

- [ ] **Step 6: Write the smoke test**

```ts
// tests/main/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('project scaffolding', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the test suite to verify the toolchain works**

Run: `npm test`
Expected: `1 passed` for the smoke test.

- [ ] **Step 8: Create placeholder entry files so the build script has something to bundle**

Create `src/main/index.ts`:
```ts
console.log('main entry placeholder');
```

Create `src/preload/index.ts`:
```ts
console.log('preload entry placeholder');
```

Create `src/renderer/index.ts`:
```ts
console.log('renderer entry placeholder');
```

- [ ] **Step 9: Run the build to verify esbuild produces output**

Run: `npm run build`
Expected: `dist/main/index.js`, `dist/preload/index.js`, `dist/renderer/index.js` created, esbuild logs three successful builds.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json esbuild.config.mjs vitest.config.ts src/main/index.ts src/preload/index.ts src/renderer/index.ts tests/main/smoke.test.ts
git commit -m "chore: scaffold TypeScript + esbuild + vitest toolchain"
```

---

### Task 2: Canonical message/tool types

**Files:**
- Create: `src/main/agent/types.ts`
- Test: `tests/main/agent/types.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'system' | 'user' | 'assistant' | 'tool'`
  - `interface ToolCall { id: string; name: string; arguments: Record<string, any>; }`
  - `interface Message { role: Role; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string; }`
  - `interface ToolSpec { name: string; description: string; parameters: Record<string, any>; }`
  - `function toolSpecToOpenAI(spec: ToolSpec): object`
  - `function toolSpecToAnthropic(spec: ToolSpec): object`
  - `type TextCallback = (piece: string) => void;`
  - `type CancelFn = () => boolean;`
  - `type StreamEvent =`
    `| { type: 'text'; delta: string }`
    `| { type: 'reasoning'; delta: string }`
    `| { type: 'assistant_done'; content: string }`
    `| { type: 'plan_set'; steps: PlanStep[] }`
    `| { type: 'tool_proposed'; id: string; name: string; args: Record<string, any>; preview: { kind: string; title: string; text: string } }`
    `| { type: 'tool_result'; id: string; name: string; ok: boolean; output: string; path?: string }`
    `| { type: 'outputs_added' | 'outputs_removed'; paths: string[] }`
  - `interface PlanStep { title: string; status: 'pending' | 'running' | 'done'; }`
  - `class ProviderError extends Error {}`
  - `interface Provider { chat(messages: Message[], tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message>; }`
  - `interface ChatCallbacks { onText?: TextCallback; onReasoning?: TextCallback; cancel?: CancelFn; }`

- [ ] **Step 1: Write the failing test for `toolSpecToOpenAI` / `toolSpecToAnthropic`**

```ts
// tests/main/agent/types.test.ts
import { describe, it, expect } from 'vitest';
import { toolSpecToOpenAI, toolSpecToAnthropic, ToolSpec } from '../../../src/main/agent/types';

describe('tool spec conversion', () => {
  const spec: ToolSpec = {
    name: 'save_file',
    description: 'Save a file',
    parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
  };

  it('converts to OpenAI function-calling shape', () => {
    expect(toolSpecToOpenAI(spec)).toEqual({
      type: 'function',
      function: {
        name: 'save_file',
        description: 'Save a file',
        parameters: spec.parameters,
      },
    });
  });

  it('converts to Anthropic tool shape', () => {
    expect(toolSpecToAnthropic(spec)).toEqual({
      name: 'save_file',
      description: 'Save a file',
      input_schema: spec.parameters,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/types'`.

- [ ] **Step 3: Write `src/main/agent/types.ts`**

```ts
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface Message {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
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
  | { type: 'outputs_added' | 'outputs_removed'; paths: string[] };

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- types.test.ts`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/types.ts tests/main/agent/types.test.ts
git commit -m "feat: add canonical message/tool/provider types"
```

---

### Task 3: Provider shared helpers (retry, context-overflow trim, think-splitter)

**Files:**
- Create: `src/main/agent/provider-base.ts`
- Test: `tests/main/agent/provider-base.test.ts`

**Interfaces:**
- Consumes: `Message`, `CancelFn`, `TextCallback` from `src/main/agent/types.ts` (Task 2).
- Produces:
  - `function isContextOverflow(text: string): boolean`
  - `function dropOldestTurn(messages: Message[]): { messages: Message[]; changed: boolean }`
  - `function retryAfterSeconds(headers: Headers, bodyText: string): number`
  - `async function waitOrCancel(seconds: number, cancel: CancelFn | undefined, onText: TextCallback | undefined, attempt: number): Promise<boolean>`
  - `function stripThink(text: string): string`
  - `class ThinkStreamSplitter { constructor(onText?: TextCallback, onReasoning?: TextCallback); feed(piece: string): void; flush(): void; }`
  - `const MAX_RETRIES = 6`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/agent/provider-base.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- provider-base.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/provider-base'`.

- [ ] **Step 3: Write `src/main/agent/provider-base.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- provider-base.test.ts`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/provider-base.ts tests/main/agent/provider-base.test.ts
git commit -m "feat: add provider shared helpers (retry, context-overflow, think-splitter)"
```

---

### Task 4: Anthropic provider (streaming SSE)

**Files:**
- Create: `src/main/agent/provider-anthropic.ts`
- Test: `tests/main/agent/provider-anthropic.test.ts`

**Interfaces:**
- Consumes: `Provider`, `Message`, `ToolSpec`, `ChatCallbacks`, `ProviderError`, `toolSpecToAnthropic` (Task 2); `MAX_RETRIES`, `isContextOverflow`, `dropOldestTurn`, `retryAfterSeconds`, `waitOrCancel` (Task 3).
- Produces: `class AnthropicProvider implements Provider` with constructor `(conf: { base_url?: string; api_key?: string; model: string })`.
- This task mocks `global.fetch` — no real network calls in tests.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/agent/provider-anthropic.test.ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- provider-anthropic.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/provider-anthropic'`.

- [ ] **Step 3: Write `src/main/agent/provider-anthropic.ts`**

```ts
import {
  Provider,
  Message,
  ToolSpec,
  ChatCallbacks,
  ProviderError,
  toolSpecToAnthropic,
} from './types';
import { MAX_RETRIES, isContextOverflow, dropOldestTurn, retryAfterSeconds, waitOrCancel } from './provider-base';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;
const FALLBACK_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

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
        if (m.content) systemParts.push(m.content);
      } else if (m.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: m.content || '',
        };
        const last = api[api.length - 1];
        if (last && last.role === 'user' && last._tool) {
          last.content.push(block);
        } else {
          api.push({ role: 'user', content: [block], _tool: true });
        }
      } else if (m.role === 'assistant') {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls || []) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} });
        }
        api.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
      } else {
        api.push({ role: 'user', content: [{ type: 'text', text: m.content || '' }] });
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
      }).catch((exc) => {
        throw new ProviderError(`Could not reach the Anthropic API: ${exc}`);
      });

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
      if (cancel && cancel()) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (cancel && cancel()) break outer;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- provider-anthropic.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/provider-anthropic.ts tests/main/agent/provider-anthropic.test.ts
git commit -m "feat: add Anthropic provider with streaming, retry, and context-overflow handling"
```

---

### Task 5: OpenAI-compatible provider (streaming SSE)

**Files:**
- Create: `src/main/agent/provider-openai-compat.ts`
- Test: `tests/main/agent/provider-openai-compat.test.ts`

**Interfaces:**
- Consumes: `Provider`, `Message`, `ToolSpec`, `ChatCallbacks`, `ProviderError`, `toolSpecToOpenAI` (Task 2); `MAX_RETRIES`, `isContextOverflow`, `dropOldestTurn`, `retryAfterSeconds`, `waitOrCancel`, `ThinkStreamSplitter`, `stripThink` (Task 3).
- Produces: `class OpenAICompatProvider implements Provider` with constructor `(conf: { base_url: string; api_key?: string; model: string })`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/agent/provider-openai-compat.test.ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- provider-openai-compat.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/provider-openai-compat'`.

- [ ] **Step 3: Write `src/main/agent/provider-openai-compat.ts`**

```ts
import { Provider, Message, ToolCall, ToolSpec, ChatCallbacks, ProviderError, toolSpecToOpenAI } from './types';
import {
  MAX_RETRIES,
  isContextOverflow,
  dropOldestTurn,
  retryAfterSeconds,
  waitOrCancel,
  ThinkStreamSplitter,
  stripThink,
} from './provider-base';

export interface OpenAICompatConf {
  base_url: string;
  api_key?: string;
  model: string;
}

interface ToolAccSlot {
  id: string;
  name: string;
  args: string;
}

export class OpenAICompatProvider implements Provider {
  readonly name = 'openai_compat';
  readonly model: string;

  constructor(private conf: OpenAICompatConf) {
    this.model = conf.model;
  }

  private url(): string {
    const base = (this.conf.base_url || '').replace(/\/+$/, '');
    if (!base) throw new ProviderError('base_url is not configured for the OpenAI-compatible provider.');
    return `${base}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.conf.api_key) headers.Authorization = `Bearer ${this.conf.api_key}`;
    return headers;
  }

  async listModels(): Promise<string[]> {
    const base = (this.conf.base_url || '').replace(/\/+$/, '');
    if (!base) return [];
    try {
      const resp = await fetch(`${base}/models`, { headers: this.headers() });
      if (resp.status >= 400) return [];
      const body = (await resp.json()) as { data?: Array<{ id?: string }> };
      return (body.data || []).map((m) => m.id).filter((id): id is string => !!id);
    } catch {
      return [];
    }
  }

  private toApiMessages(messages: Message[]): any[] {
    return messages.map((m) => {
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
          })),
        };
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id || '', content: m.content || '' };
      }
      return { role: m.role, content: m.content || '' };
    });
  }

  async chat(messages: Message[], tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message> {
    const { onText, onReasoning, cancel } = callbacks;
    let work = [...messages];
    const payload: Record<string, any> = { model: this.model, stream: true };
    if (tools && tools.length) {
      payload.tools = tools.map(toolSpecToOpenAI);
      payload.tool_choice = 'auto';
    }

    const textParts: string[] = [];
    const toolAcc: Record<number, ToolAccSlot> = {};

    const emitAnswer = (t: string) => {
      textParts.push(t);
      if (onText) onText(t);
    };
    const splitter = new ThinkStreamSplitter(emitAnswer, onReasoning);

    let resp: Response | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      payload.messages = this.toApiMessages(work);
      resp = await fetch(this.url(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      }).catch((exc) => {
        throw new ProviderError(`Could not reach the gateway: ${exc}`);
      });

      if (resp.status >= 400) {
        const wait = retryAfterSeconds(resp.headers, '');
        const bodyText = await resp.text();
        const err = this.errorText(resp.status, bodyText);
        if (resp.status === 429 && attempt <= MAX_RETRIES) {
          const cancelled = await waitOrCancel(wait, cancel, onText, attempt);
          if (cancelled) return assembleAssistant(textParts, toolAcc);
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

    if (!resp || !resp.body) return assembleAssistant(textParts, toolAcc);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    outer: while (true) {
      if (cancel && cancel()) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (cancel && cancel()) break outer;
        if (!raw || !raw.startsWith('data:')) continue;
        const data = raw.slice('data:'.length).trim();
        if (data === '[DONE]') break outer;
        if (!data) continue;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const choices = chunk.choices || [];
        if (!choices.length) continue;
        const delta = choices[0].delta || {};
        const rc = delta.reasoning_content || delta.reasoning;
        if (rc && onReasoning) onReasoning(rc);
        if (delta.content) splitter.feed(delta.content);
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          const slot = (toolAcc[i] = toolAcc[i] || { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          const fn = tc.function || {};
          if (fn.name) slot.name = fn.name;
          if (fn.arguments) slot.args += fn.arguments;
        }
      }
    }

    splitter.flush();
    return assembleAssistant(textParts, toolAcc);
  }

  private errorText(status: number, bodyText: string): string {
    try {
      const body = JSON.parse(bodyText);
      const msg = body?.error?.message || JSON.stringify(body);
      return `Gateway error ${status}: ${msg}`;
    } catch {
      return `Gateway error ${status}: ${bodyText.slice(0, 300)}`;
    }
  }
}

function assembleAssistant(textParts: string[], toolAcc: Record<number, ToolAccSlot>): Message {
  const toolCalls: ToolCall[] = Object.keys(toolAcc)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((i) => toolAcc[i].name)
    .map((i) => {
      const slot = toolAcc[i];
      let args: Record<string, any> = {};
      try {
        args = slot.args.trim() ? JSON.parse(slot.args) : {};
      } catch {
        args = { _raw: slot.args };
      }
      return { id: slot.id || `call_${i}`, name: slot.name, arguments: args };
    });
  return { role: 'assistant', content: stripThink(textParts.join('')), tool_calls: toolCalls };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- provider-openai-compat.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/provider-openai-compat.ts tests/main/agent/provider-openai-compat.test.ts
git commit -m "feat: add OpenAI-compatible provider with streaming and reasoning-content split"
```

---

### Task 6: Config module

**Files:**
- Create: `src/main/config.ts`
- Test: `tests/main/config.test.ts`

**Interfaces:**
- Produces:
  - `interface ProviderConf { base_url?: string; api_key: string; model: string; }`
  - `interface CoworkConf { output_dir: string; max_parallel: number; }`
  - `interface AppConfigData { active_provider: string; theme: string; providers: { openai_compat: ProviderConf; anthropic: ProviderConf }; cowork: CoworkConf; history: { location: string; custom_dir: string; autosave: boolean }; }`
  - `const DEFAULT_CONFIG: AppConfigData`
  - `const CONFIG_DIR: string` (`~/.cowork_local`), `const CONFIG_PATH: string`, `const HISTORY_DIR: string`
  - `class AppConfig { data: AppConfigData; path: string; static load(path?: string): AppConfig; save(): void; get activeProvider(): string; providerConf(name?: string): ProviderConf; coworkOutputDir(): string; historyDir(): string; }`
  - Deep-merge + env override logic (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `COWORK_ACTIVE_PROVIDER`) mirrors `OldVersion/src/cowork_local/config.py`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/config.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig, DEFAULT_CONFIG } from '../../src/main/config';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-config-test-'));
  vi.unstubAllEnvs();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AppConfig', () => {
  it('loads defaults when no config file exists', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    expect(config.data.active_provider).toBe(DEFAULT_CONFIG.active_provider);
    expect(config.data.cowork.max_parallel).toBe(5);
  });

  it('deep-merges a stored config file over the defaults', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ cowork: { max_parallel: 8 } }));
    const config = AppConfig.load(configPath);
    expect(config.data.cowork.max_parallel).toBe(8);
    expect(config.data.cowork.output_dir).toBe(DEFAULT_CONFIG.cowork.output_dir);
  });

  it('applies environment variable overrides after the stored config', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ providers: { anthropic: { api_key: 'stored-key' } } }));
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key');
    const config = AppConfig.load(configPath);
    expect(config.data.providers.anthropic.api_key).toBe('env-key');
  });

  it('saves data back to disk as JSON', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    config.data.active_provider = 'anthropic';
    config.save();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.active_provider).toBe('anthropic');
  });

  it('providerConf returns the config for the active provider by default', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ active_provider: 'anthropic' }));
    const config = AppConfig.load(configPath);
    expect(config.providerConf().model).toBe(DEFAULT_CONFIG.providers.anthropic.model);
  });

  it('coworkOutputDir falls back to ~/.cowork_local/output/cowork when unset', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    expect(config.coworkOutputDir().endsWith(path.join('.cowork_local', 'output', 'cowork'))).toBe(true);
  });

  it('coworkOutputDir honors an explicit output_dir', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ cowork: { output_dir: '/custom/out' } }));
    const config = AppConfig.load(configPath);
    expect(config.coworkOutputDir()).toBe(path.resolve('/custom/out'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- config.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/config'`.

- [ ] **Step 3: Write `src/main/config.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CONFIG_DIR = path.join(os.homedir(), '.cowork_local');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const HISTORY_DIR = path.join(CONFIG_DIR, 'history');

export interface ProviderConf {
  base_url?: string;
  api_key: string;
  model: string;
}

export interface CoworkConf {
  output_dir: string;
  max_parallel: number;
}

export interface HistoryConf {
  location: string;
  custom_dir: string;
  autosave: boolean;
}

export interface AppConfigData {
  active_provider: string;
  theme: string;
  providers: {
    openai_compat: ProviderConf;
    anthropic: ProviderConf;
  };
  cowork: CoworkConf;
  history: HistoryConf;
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai_compat: 'OpenAI-compatible (Internal Gateway)',
  anthropic: 'Anthropic Claude',
};

export const DEFAULT_CONFIG: AppConfigData = {
  active_provider: 'openai_compat',
  theme: 'dark',
  providers: {
    openai_compat: { base_url: 'https://your-internal-gateway/v1', api_key: '', model: 'gpt-4o-mini' },
    anthropic: { base_url: 'https://api.anthropic.com', api_key: '', model: 'claude-sonnet-4-6' },
  },
  cowork: { output_dir: '', max_parallel: 5 },
  history: { location: 'local', custom_dir: '', autosave: true },
};

function deepMerge<T>(base: T, override: any): T {
  const out: any = JSON.parse(JSON.stringify(base));
  for (const key of Object.keys(override || {})) {
    const value = override[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object') {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function applyEnvOverrides(data: AppConfigData): AppConfigData {
  const out = JSON.parse(JSON.stringify(data)) as AppConfigData;
  if (process.env.OPENAI_API_KEY) out.providers.openai_compat.api_key = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) out.providers.openai_compat.base_url = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_MODEL) out.providers.openai_compat.model = process.env.OPENAI_MODEL;
  if (process.env.ANTHROPIC_API_KEY) out.providers.anthropic.api_key = process.env.ANTHROPIC_API_KEY;
  if (process.env.ANTHROPIC_MODEL) out.providers.anthropic.model = process.env.ANTHROPIC_MODEL;
  if (process.env.COWORK_ACTIVE_PROVIDER) out.active_provider = process.env.COWORK_ACTIVE_PROVIDER;
  return out;
}

export class AppConfig {
  constructor(
    public data: AppConfigData,
    public path: string = CONFIG_PATH,
  ) {}

  static load(configPath: string = CONFIG_PATH): AppConfig {
    let merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfigData;
    if (fs.existsSync(configPath)) {
      try {
        const stored = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        merged = deepMerge(merged, stored);
      } catch {
        merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }
    }
    merged = applyEnvOverrides(merged);
    return new AppConfig(merged, configPath);
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  get activeProvider(): string {
    const val = this.data.active_provider;
    return val in PROVIDER_LABELS ? val : 'openai_compat';
  }

  providerConf(name?: string): ProviderConf {
    const key = name || this.activeProvider;
    return (this.data.providers as any)[key];
  }

  coworkOutputDir(): string {
    const custom = (this.data.cowork.output_dir || '').trim();
    if (custom) return path.resolve(custom.startsWith('~') ? custom.replace('~', os.homedir()) : custom);
    return path.join(CONFIG_DIR, 'output', 'cowork');
  }

  historyDir(): string {
    const custom = (this.data.history.custom_dir || '').trim();
    if (custom) return path.resolve(custom.startsWith('~') ? custom.replace('~', os.homedir()) : custom);
    return HISTORY_DIR;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- config.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts tests/main/config.test.ts
git commit -m "feat: add AppConfig with deep-merge, env overrides, and path helpers"
```

---

### Task 7: History store

**Files:**
- Create: `src/main/history-store.ts`
- Test: `tests/main/history-store.test.ts`

**Interfaces:**
- Consumes: `Message` (Task 2).
- Produces:
  - `interface ConversationRecord { kind: string; session_id: string; title: string; created: string; pinned: boolean; inputs: string[]; outputs: string[]; messages: Message[]; }`
  - `interface ConversationListItem { path: string; kind: string; title: string; created: string; session_id: string; pinned: boolean; count: number; mtime: number; }`
  - `function newSessionId(): string`
  - `function deriveTitle(messages: Message[]): string`
  - `function saveConversation(directory: string, kind: string, sessionId: string, messages: Message[], opts?: { title?: string; created?: string; inputs?: string[]; outputs?: string[] }): string` (returns path)
  - `function loadConversation(filePath: string): ConversationRecord`
  - `function listConversations(directory: string): ConversationListItem[]`
  - `function deleteConversation(filePath: string): void`
  - `function renameConversation(filePath: string, newTitle: string): void`
  - `function setPinned(filePath: string, pinned: boolean): void`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/history-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  saveConversation,
  loadConversation,
  listConversations,
  deleteConversation,
  renameConversation,
  setPinned,
  deriveTitle,
} from '../../src/main/history-store';
import { Message } from '../../src/main/agent/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-history-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('deriveTitle', () => {
  it('uses the first user message, truncated to 60 chars', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a'.repeat(80) },
    ];
    const title = deriveTitle(messages);
    expect(title.length).toBe(61); // 60 chars + ellipsis
    expect(title.endsWith('…')).toBe(true);
  });

  it('returns "(empty)" when there is no user message', () => {
    expect(deriveTitle([{ role: 'system', content: 'sys' }])).toBe('(empty)');
  });
});

describe('saveConversation / loadConversation', () => {
  it('writes a JSON file named <kind>__<session_id>.json and reads it back', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const filePath = saveConversation(tmpDir, 'cowork', '20260711-120000-000', messages);
    expect(path.basename(filePath)).toBe('cowork__20260711-120000-000.json');

    const loaded = loadConversation(filePath);
    expect(loaded.kind).toBe('cowork');
    expect(loaded.session_id).toBe('20260711-120000-000');
    expect(loaded.messages).toEqual(messages);
    expect(loaded.pinned).toBe(false);
  });

  it('preserves the pinned flag across a re-save', () => {
    const filePath = saveConversation(tmpDir, 'cowork', 'sess-1', [{ role: 'user', content: 'hi' }]);
    setPinned(filePath, true);
    saveConversation(tmpDir, 'cowork', 'sess-1', [{ role: 'user', content: 'hi again' }]);
    const loaded = loadConversation(filePath);
    expect(loaded.pinned).toBe(true);
  });
});

describe('listConversations', () => {
  it('lists conversations sorted pinned-first then most-recent', async () => {
    const p1 = saveConversation(tmpDir, 'cowork', 'sess-1', [{ role: 'user', content: 'first' }]);
    await new Promise((r) => setTimeout(r, 10));
    const p2 = saveConversation(tmpDir, 'cowork', 'sess-2', [{ role: 'user', content: 'second' }]);
    setPinned(p1, true);

    const items = listConversations(tmpDir);
    expect(items.map((i) => i.session_id)).toEqual(['sess-1', 'sess-2']);
    expect(items[0].pinned).toBe(true);
  });

  it('returns an empty array when the directory does not exist', () => {
    expect(listConversations(path.join(tmpDir, 'missing'))).toEqual([]);
  });
});

describe('renameConversation / deleteConversation', () => {
  it('renameConversation updates the title on disk', () => {
    const filePath = saveConversation(tmpDir, 'cowork', 'sess-1', [{ role: 'user', content: 'hi' }]);
    renameConversation(filePath, 'New title');
    expect(loadConversation(filePath).title).toBe('New title');
  });

  it('deleteConversation removes the file', () => {
    const filePath = saveConversation(tmpDir, 'cowork', 'sess-1', [{ role: 'user', content: 'hi' }]);
    deleteConversation(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- history-store.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/history-store'`.

- [ ] **Step 3: Write `src/main/history-store.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { Message } from './agent/types';

export interface ConversationRecord {
  kind: string;
  session_id: string;
  title: string;
  created: string;
  pinned: boolean;
  inputs: string[];
  outputs: string[];
  messages: Message[];
}

export interface ConversationListItem {
  path: string;
  kind: string;
  title: string;
  created: string;
  session_id: string;
  pinned: boolean;
  count: number;
  mtime: number;
}

export function newSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
    pad(now.getMilliseconds(), 3)
  );
}

export function deriveTitle(messages: Message[]): string {
  for (const m of messages) {
    if (m.role === 'user' && m.content) {
      const text = m.content.split(/\s+/).filter(Boolean).join(' ');
      return text.length > 60 ? text.slice(0, 60) + '…' : text;
    }
  }
  return '(empty)';
}

export function saveConversation(
  directory: string,
  kind: string,
  sessionId: string,
  messages: Message[],
  opts: { title?: string; created?: string; inputs?: string[]; outputs?: string[] } = {},
): string {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${kind}__${sessionId}.json`);
  let pinned = false;
  if (fs.existsSync(filePath)) {
    try {
      pinned = Boolean(JSON.parse(fs.readFileSync(filePath, 'utf-8')).pinned);
    } catch {
      pinned = false;
    }
  }
  const payload: ConversationRecord = {
    kind,
    session_id: sessionId,
    title: opts.title || deriveTitle(messages),
    created: opts.created || new Date().toISOString(),
    pinned,
    inputs: opts.inputs || [],
    outputs: opts.outputs || [],
    messages,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}

export function loadConversation(filePath: string): ConversationRecord {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(data)) {
      return { kind: '', session_id: '', title: deriveTitle(data), created: '', pinned: false, inputs: [], outputs: [], messages: data };
    }
    return {
      kind: data.kind || '',
      session_id: data.session_id || '',
      title: data.title || path.basename(filePath, '.json'),
      created: data.created || '',
      pinned: Boolean(data.pinned),
      inputs: data.inputs || [],
      outputs: data.outputs || [],
      messages: data.messages || [],
    };
  } catch {
    return { kind: '', session_id: '', title: '(read error)', created: '', pinned: false, inputs: [], outputs: [], messages: [] };
  }
}

export function listConversations(directory: string): ConversationListItem[] {
  if (!directory || !fs.existsSync(directory)) return [];
  const items: ConversationListItem[] = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(directory, name);
    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      continue;
    }
    const messages = Array.isArray(data) ? data : data.messages || [];
    const title = Array.isArray(data) ? deriveTitle(data) : data.title || path.basename(filePath, '.json');
    items.push({
      path: filePath,
      kind: Array.isArray(data) ? '' : data.kind || '',
      title,
      created: Array.isArray(data) ? '' : data.created || '',
      session_id: Array.isArray(data) ? path.basename(filePath, '.json') : data.session_id || path.basename(filePath, '.json'),
      pinned: Array.isArray(data) ? false : Boolean(data.pinned),
      count: messages.length,
      mtime: fs.statSync(filePath).mtimeMs,
    });
  }
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.mtime - a.mtime;
  });
  return items;
}

export function deleteConversation(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export function renameConversation(filePath: string, newTitle: string): void {
  const data = loadConversation(filePath);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  raw.title = newTitle;
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf-8');
  void data;
}

export function setPinned(filePath: string, pinned: boolean): void {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  raw.pinned = pinned;
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- history-store.test.ts`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/history-store.ts tests/main/history-store.test.ts
git commit -m "feat: add history-store for conversation persistence"
```

---

### Task 8: Plan tool + save_file tool

**Files:**
- Create: `src/main/agent/plan.ts`
- Create: `src/main/agent/save-file-tool.ts`
- Test: `tests/main/agent/plan.test.ts`
- Test: `tests/main/agent/save-file-tool.test.ts`

**Interfaces:**
- Consumes: `ToolSpec`, `PlanStep` (Task 2).
- Produces (plan.ts):
  - `const UPDATE_PLAN_SPEC: ToolSpec`
  - `function normalizePlanSteps(raw: unknown): PlanStep[]`
- Produces (save-file-tool.ts):
  - `const SAVE_FILE_SPEC: ToolSpec`
  - `function safeFilename(name: string): string`
  - `function titledFilename(title: string, agentFilename: string): string`
  - `function doSaveFile(outputDir: string, title: string, args: { filename?: string; content?: string }): { ok: boolean; output: string; path?: string }`

- [ ] **Step 1: Write the failing tests for plan.ts**

```ts
// tests/main/agent/plan.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePlanSteps, UPDATE_PLAN_SPEC } from '../../../src/main/agent/plan';

describe('UPDATE_PLAN_SPEC', () => {
  it('is named update_plan and requires steps', () => {
    expect(UPDATE_PLAN_SPEC.name).toBe('update_plan');
    expect(UPDATE_PLAN_SPEC.parameters.required).toEqual(['steps']);
  });
});

describe('normalizePlanSteps', () => {
  it('normalizes valid steps and clamps unknown status to pending', () => {
    const result = normalizePlanSteps([
      { title: 'Read data', status: 'done' },
      { title: 'Write report', status: 'bogus' },
      { title: 'Send Teams message' },
    ]);
    expect(result).toEqual([
      { title: 'Read data', status: 'done' },
      { title: 'Write report', status: 'pending' },
      { title: 'Send Teams message', status: 'pending' },
    ]);
  });

  it('drops items with an empty title and non-object items', () => {
    const result = normalizePlanSteps([{ title: '   ' }, 'not-an-object', { title: 'Valid' }]);
    expect(result).toEqual([{ title: 'Valid', status: 'pending' }]);
  });

  it('returns an empty array when raw is not an array', () => {
    expect(normalizePlanSteps(null)).toEqual([]);
    expect(normalizePlanSteps({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/plan'`.

- [ ] **Step 3: Write `src/main/agent/plan.ts`**

```ts
import { ToolSpec, PlanStep } from './types';

const VALID_STATUS = new Set(['pending', 'running', 'done']);

export const UPDATE_PLAN_SPEC: ToolSpec = {
  name: 'update_plan',
  description:
    "Update the task checklist shown to the user. Pass the FULL list of steps with each step's status " +
    "(pending / running / done). Call it as you work: mark the current step 'running', then 'done' when finished.",
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'running', 'done'] },
          },
          required: ['title'],
        },
      },
    },
    required: ['steps'],
  },
};

export function normalizePlanSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const title = String((item as any).title ?? '').trim();
    if (!title) continue;
    let status = String((item as any).status ?? 'pending').trim().toLowerCase();
    if (!VALID_STATUS.has(status)) status = 'pending';
    out.push({ title, status: status as PlanStep['status'] });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- plan.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Write the failing tests for save-file-tool.ts**

```ts
// tests/main/agent/save-file-tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeFilename, titledFilename, doSaveFile, SAVE_FILE_SPEC } from '../../../src/main/agent/save-file-tool';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-savefile-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SAVE_FILE_SPEC', () => {
  it('requires filename and content', () => {
    expect(SAVE_FILE_SPEC.name).toBe('save_file');
    expect(SAVE_FILE_SPEC.parameters.required).toEqual(['filename', 'content']);
  });
});

describe('safeFilename', () => {
  it('strips path separators and unsafe characters but keeps unicode letters', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('Báo cáo tuần.md')).toBe('Báo cáo tuần.md');
  });

  it('adds a .txt extension when none is present', () => {
    expect(safeFilename('notes')).toBe('notes.txt');
  });

  it('falls back to output.txt when the name is empty after sanitizing', () => {
    expect(safeFilename('///')).toBe('output.txt');
  });
});

describe('titledFilename', () => {
  it('uses the chat title as the base name, keeping the agent extension', () => {
    expect(titledFilename('Báo cáo tuần', 'draft.md')).toBe('Báo cáo tuần.md');
  });

  it('falls back to the agent filename stem when the title is empty', () => {
    expect(titledFilename('', 'draft.md')).toBe('draft.md');
  });

  it('truncates very long titles to 80 characters', () => {
    const longTitle = 'a'.repeat(200);
    const result = titledFilename(longTitle, 'x.md');
    expect(result.length).toBeLessThanOrEqual(83); // 80 + '.md'
  });
});

describe('doSaveFile', () => {
  it('writes content to the output dir using the titled filename', () => {
    const result = doSaveFile(tmpDir, 'Weekly report', { filename: 'draft.md', content: '# Hello' });
    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.join(tmpDir, 'Weekly report.md'));
    expect(fs.readFileSync(result.path!, 'utf-8')).toBe('# Hello');
  });

  it('overwrites an existing file of the same name in place', () => {
    doSaveFile(tmpDir, 'Notes', { filename: 'a.md', content: 'v1' });
    const result = doSaveFile(tmpDir, 'Notes', { filename: 'a.md', content: 'v2' });
    expect(fs.readFileSync(result.path!, 'utf-8')).toBe('v2');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- save-file-tool.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/save-file-tool'`.

- [ ] **Step 7: Write `src/main/agent/save-file-tool.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { ToolSpec } from './types';

export const SAVE_FILE_SPEC: ToolSpec = {
  name: 'save_file',
  description: 'Save content to a file (e.g. .md, .txt, .csv, .json) when the user asks.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name with extension' },
      content: { type: 'string', description: 'Full file content' },
    },
    required: ['filename', 'content'],
  },
};

const UNSAFE = /[\\/:*?"<>|\x00-\x1f]+/g;

export function safeFilename(name: string): string {
  let base = path.basename(String(name)).trim();
  base = base.replace(UNSAFE, '_').replace(/^[ _.]+|[ _.]+$/g, '') || 'output.txt';
  if (!base.includes('.')) base += '.txt';
  return base;
}

export function titledFilename(title: string, agentFilename: string): string {
  const ext = path.extname(String(agentFilename)) || '.md';
  let base = String(title || '').trim().replace(UNSAFE, '_').replace(/^[ _.]+|[ _.]+$/g, '');
  base = base.slice(0, 80).replace(/^[ _.]+|[ _.]+$/g, '');
  if (!base) {
    base = path.basename(String(agentFilename), path.extname(String(agentFilename))) || 'output';
  }
  return base + ext;
}

export function doSaveFile(
  outputDir: string,
  title: string,
  args: { filename?: string; content?: string },
): { ok: boolean; output: string; path?: string } {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const fname = titledFilename(title, args.filename || 'output.txt');
    const target = path.join(outputDir, fname);
    fs.writeFileSync(target, String(args.content || ''), 'utf-8');
    return { ok: true, output: `Saved ${path.basename(target)}.`, path: target };
  } catch (exc: any) {
    return { ok: false, output: `Save failed: ${exc.message || exc}` };
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- save-file-tool.test.ts`
Expected: `8 passed`.

- [ ] **Step 9: Commit**

```bash
git add src/main/agent/plan.ts src/main/agent/save-file-tool.ts tests/main/agent/plan.test.ts tests/main/agent/save-file-tool.test.ts
git commit -m "feat: add update_plan and save_file tool specs/handlers"
```

---

### Task 9: Provider factory + run-cowork loop

**Files:**
- Create: `src/main/agent/provider-factory.ts`
- Create: `src/main/agent/run-cowork.ts`
- Test: `tests/main/agent/provider-factory.test.ts`
- Test: `tests/main/agent/run-cowork.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `ProviderConf` (Task 6); `Provider`, `Message`, `ToolSpec`, `StreamEvent`, `CancelFn` (Task 2); `AnthropicProvider` (Task 4); `OpenAICompatProvider` (Task 5); `UPDATE_PLAN_SPEC`, `normalizePlanSteps` (Task 8); `SAVE_FILE_SPEC`, `doSaveFile`, `titledFilename` (Task 8).
- Produces (provider-factory.ts): `function createProvider(config: AppConfig, providerName?: string): Provider`
- Produces (run-cowork.ts):
  - `const COWORK_SYSTEM_PROMPT: string`
  - `const COWORK_TOOL_PROMPT: string`
  - `type EmitFn = (event: StreamEvent) => void`
  - `async function runCowork(provider: Provider, messages: Message[], outputDir: string, emit: EmitFn, opts?: { cancel?: CancelFn; maxSteps?: number; title?: string }): Promise<Message[]>`

- [ ] **Step 1: Write the failing test for provider-factory.ts**

```ts
// tests/main/agent/provider-factory.test.ts
import { describe, it, expect } from 'vitest';
import { createProvider } from '../../../src/main/agent/provider-factory';
import { AppConfig, DEFAULT_CONFIG } from '../../../src/main/config';
import { AnthropicProvider } from '../../../src/main/agent/provider-anthropic';
import { OpenAICompatProvider } from '../../../src/main/agent/provider-openai-compat';

describe('createProvider', () => {
  it('creates an AnthropicProvider when active_provider is anthropic', () => {
    const config = new AppConfig({ ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), active_provider: 'anthropic' });
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('creates an OpenAICompatProvider when active_provider is openai_compat', () => {
    const config = new AppConfig({ ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), active_provider: 'openai_compat' });
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(OpenAICompatProvider);
  });

  it('honors an explicit providerName override', () => {
    const config = new AppConfig({ ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), active_provider: 'openai_compat' });
    const provider = createProvider(config, 'anthropic');
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- provider-factory.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/provider-factory'`.

- [ ] **Step 3: Write `src/main/agent/provider-factory.ts`**

```ts
import { AppConfig } from '../config';
import { Provider } from './types';
import { AnthropicProvider } from './provider-anthropic';
import { OpenAICompatProvider } from './provider-openai-compat';

export function createProvider(config: AppConfig, providerName?: string): Provider {
  const name = providerName || config.activeProvider;
  const conf = config.providerConf(name);
  if (name === 'anthropic') {
    return new AnthropicProvider({ base_url: conf.base_url, api_key: conf.api_key, model: conf.model });
  }
  return new OpenAICompatProvider({ base_url: conf.base_url || '', api_key: conf.api_key, model: conf.model });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- provider-factory.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Write the failing tests for run-cowork.ts**

```ts
// tests/main/agent/run-cowork.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCowork } from '../../../src/main/agent/run-cowork';
import { Provider, Message, ToolSpec, ChatCallbacks, StreamEvent } from '../../../src/main/agent/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-run-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  readonly model = 'scripted-model';
  private call = 0;
  constructor(private turns: Array<(messages: Message[], callbacks: ChatCallbacks) => Message>) {}
  async chat(messages: Message[], _tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message> {
    const turn = this.turns[this.call++];
    return turn(messages, callbacks);
  }
  async listModels() {
    return [];
  }
}

describe('runCowork', () => {
  it('streams plain text and emits assistant_done when there is no tool call', async () => {
    const provider = new ScriptedProvider([
      (_messages, callbacks) => {
        callbacks.onText?.('Hello');
        callbacks.onText?.(' there');
        return { role: 'assistant', content: 'Hello there', tool_calls: [] };
      },
    ]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'hi' }], tmpDir, (e) => events.push(e), { title: 'Test chat' });

    expect(events).toContainEqual({ type: 'text', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text', delta: ' there' });
    expect(events).toContainEqual({ type: 'assistant_done', content: 'Hello there' });
  });

  it('runs the save_file tool and emits tool_proposed/tool_result/outputs_added', async () => {
    const provider = new ScriptedProvider([
      () => ({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'save_file', arguments: { filename: 'note.md', content: '# Note' } }],
      }),
      () => ({ role: 'assistant', content: 'Done.', tool_calls: [] }),
    ]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'save a note' }], tmpDir, (e) => events.push(e), {
      title: 'Weekly report',
    });

    const proposed = events.find((e) => e.type === 'tool_proposed');
    expect(proposed).toBeTruthy();
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ type: 'tool_result', name: 'save_file', ok: true });
    const added = events.find((e) => e.type === 'outputs_added');
    expect(added).toBeTruthy();
    expect(fs.existsSync(path.join(tmpDir, 'Weekly report.md'))).toBe(true);
  });

  it('handles update_plan by emitting plan_set without writing a file', async () => {
    const provider = new ScriptedProvider([
      () => ({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'update_plan', arguments: { steps: [{ title: 'Step 1', status: 'running' }] } }],
      }),
      () => ({ role: 'assistant', content: 'Working on it.', tool_calls: [] }),
    ]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'do something' }], tmpDir, (e) => events.push(e));

    expect(events).toContainEqual({ type: 'plan_set', steps: [{ title: 'Step 1', status: 'running' }] });
    expect(fs.readdirSync(tmpDir).length).toBe(0);
  });

  it('stops immediately when cancel() is already true', async () => {
    const provider = new ScriptedProvider([() => ({ role: 'assistant', content: 'should not run', tool_calls: [] })]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'hi' }], tmpDir, (e) => events.push(e), {
      cancel: () => true,
    });
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- run-cowork.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/run-cowork'`.

- [ ] **Step 7: Write `src/main/agent/run-cowork.ts`**

```ts
import * as path from 'path';
import { Message, Provider, StreamEvent, CancelFn, ToolSpec } from './types';
import { UPDATE_PLAN_SPEC, normalizePlanSteps } from './plan';
import { SAVE_FILE_SPEC, doSaveFile, titledFilename } from './save-file-tool';

export type EmitFn = (event: StreamEvent) => void;

export const COWORK_SYSTEM_PROMPT =
  "You are Cowork Local — a friendly internal assistant. Answer concisely and " +
  "accurately in the user's language. When unsure, say so.";

export const COWORK_TOOL_PROMPT =
  COWORK_SYSTEM_PROMPT +
  '\nYou can create real files for the user in the output folder.\n' +
  '• For text (.md/.txt/.csv/.json): call save_file(filename, content) ONCE with the FINAL ' +
  'content. Re-saving the same filename overwrites in place.\n' +
  'If a command fails, read the error, fix it, and retry until the file is produced; then ' +
  'report the final file name. For plain conversation, do NOT call any tool.\n' +
  'For any task that takes more than one step, FIRST call update_plan with a short checklist ' +
  "(2–6 short imperative steps, each status 'pending'); then, as you work, call update_plan " +
  "again to mark the current step 'running' and finished steps 'done'. Skip the plan for a " +
  'trivial one-line reply.\n' +
  'Do NOT ask the user clarifying or confirmation questions — make reasonable assumptions and ' +
  'carry out the ORIGINAL request end-to-end on your own, then report only the final result.';

export interface RunCoworkOptions {
  cancel?: CancelFn;
  maxSteps?: number;
  title?: string;
}

export async function runCowork(
  provider: Provider,
  messages: Message[],
  outputDir: string,
  emit: EmitFn,
  opts: RunCoworkOptions = {},
): Promise<Message[]> {
  const cancel = opts.cancel || (() => false);
  const maxSteps = opts.maxSteps ?? 30;
  const title = opts.title || '';

  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: COWORK_TOOL_PROMPT });
  }

  const toolSpecs: ToolSpec[] = [SAVE_FILE_SPEC, UPDATE_PLAN_SPEC];

  for (let step = 0; step < maxSteps; step++) {
    if (cancel()) break;

    const onText = (piece: string) => emit({ type: 'text', delta: piece });
    const onReasoning = (piece: string) => emit({ type: 'reasoning', delta: piece });

    const assistant = await provider.chat(messages, toolSpecs, { onText, onReasoning, cancel });
    messages.push(assistant);

    const toolCalls = assistant.tool_calls || [];
    if (!toolCalls.length && !(assistant.content || '').trim()) {
      emit({ type: 'text', delta: '*(model returned only its reasoning — try rephrasing)*' });
    }
    emit({ type: 'assistant_done', content: assistant.content || '' });

    if (!toolCalls.length) break;

    for (const tc of toolCalls) {
      if (cancel()) break;
      const { id: tcId, name, arguments: args } = tc;

      if (name === 'update_plan') {
        emit({ type: 'plan_set', steps: normalizePlanSteps((args as any).steps) });
        messages.push({ role: 'tool', tool_call_id: tcId, name, content: 'Plan updated.' });
        continue;
      }

      if (name === 'save_file') {
        const previewFilename = titledFilename(title, String((args as any).filename || 'output.txt'));
        emit({
          type: 'tool_proposed',
          id: tcId,
          name,
          args,
          preview: { kind: 'diff', title: `Save ${previewFilename}`, text: String((args as any).content || '').slice(0, 4000) },
        });
        const result = doSaveFile(outputDir, title, args as any);
        emit({
          type: 'tool_result',
          id: tcId,
          name,
          ok: result.ok,
          output: result.output,
          ...(result.path ? { path: result.path } : {}),
        });
        if (result.ok && result.path) {
          emit({ type: 'outputs_added', paths: [result.path] });
        }
        messages.push({ role: 'tool', tool_call_id: tcId, name, content: result.output });
        continue;
      }

      // Unknown tool — should not happen given the fixed toolSpecs above.
      messages.push({ role: 'tool', tool_call_id: tcId, name, content: `Tool not found: ${name}` });
    }
  }

  return messages;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- run-cowork.test.ts`
Expected: `4 passed`.

- [ ] **Step 9: Commit**

```bash
git add src/main/agent/provider-factory.ts src/main/agent/run-cowork.ts tests/main/agent/provider-factory.test.ts tests/main/agent/run-cowork.test.ts
git commit -m "feat: add provider factory and run-cowork chat loop"
```

---

### Task 10: Conversation manager (per-conversation concurrency + queue)

**Files:**
- Create: `src/main/conversation-manager.ts`
- Test: `tests/main/conversation-manager.test.ts`

**Interfaces:**
- Consumes: `Provider`, `Message`, `StreamEvent`, `EmitFn` shape (Task 2, Task 9); `runCowork` (Task 9).
- Produces:
  - `interface SendResult { messageId: string; queued: boolean; }`
  - `class ConversationManager { constructor(opts: { maxParallel: number; runTurn: (messages: Message[], emit: (e: StreamEvent) => void, cancel: () => boolean) => Promise<Message[]> }); send(conversationId: string, userMessage: Message, getHistory: () => Message[], onEvent: (messageId: string, event: StreamEvent) => void): SendResult; cancel(conversationId: string, messageId: string): boolean; activeCount(conversationId: string): number; queuedCount(conversationId: string): number; }`

The manager owns **scheduling** only (how many turns run concurrently per conversation and the overflow queue); it delegates the actual provider call + tool loop to the injected `runTurn` function (which in production is a closure over `runCowork` + a specific provider + output dir), so the manager itself has no knowledge of providers or tools and is simple to unit-test with a fake `runTurn`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/conversation-manager.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- conversation-manager.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/conversation-manager'`.

- [ ] **Step 3: Write `src/main/conversation-manager.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- conversation-manager.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/conversation-manager.ts tests/main/conversation-manager.test.ts
git commit -m "feat: add conversation-manager for per-conversation concurrency and queueing"
```

---

### Task 11: Main process wiring — IPC handlers, window creation, preload

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts` (replace placeholder from Task 1)
- Modify: `src/preload/index.ts` (replace placeholder from Task 1)

**Interfaces:**
- Consumes: `AppConfig` (Task 6), `createProvider` (Task 9), `runCowork` (Task 9), `ConversationManager` (Task 10), history-store functions (Task 7), `newSessionId` (Task 7).
- Produces: registered `ipcMain.handle`/`ipcMain.on` channels consumed by the renderer in Task 12:
  - `cowork:send` (invoke) `(conversationId: string, text: string) => { messageId: string; queued: boolean }`
  - `cowork:cancel` (invoke) `(conversationId: string, messageId: string) => boolean`
  - `history:list` (invoke) `() => ConversationListItem[]`
  - `history:load` (invoke) `(sessionId: string) => ConversationRecord`
  - `history:new` (invoke) `() => { sessionId: string }`
  - `history:rename` (invoke) `(sessionId: string, title: string) => void`
  - `history:pin` (invoke) `(sessionId: string, pinned: boolean) => void`
  - `history:delete` (invoke) `(sessionId: string) => void`
  - `settings:get` (invoke) `() => AppConfigData`
  - `settings:save` (invoke) `(partial: Partial<AppConfigData>) => void`
  - `shell:openPath` (invoke) `(targetPath: string) => void`
  - `win:minimize` / `win:maximize` / `win:close` (send, unchanged from current `main.js`)
  - `open-external` (send, unchanged from current `main.js`)
  - main → renderer event: `webContents.send('cowork:event', messageId, event: StreamEvent)`

This task has no isolated unit test (it is Electron glue code exercised via the app itself in Task 13's manual verification); instead, we verify it by type-checking and by the manual smoke test in Task 13.

- [ ] **Step 1: Write `src/main/ipc.ts`**

```ts
import { ipcMain, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import { AppConfig, AppConfigData, CONFIG_PATH } from './config';
import { createProvider } from './agent/provider-factory';
import { runCowork } from './agent/run-cowork';
import { ConversationManager } from './conversation-manager';
import {
  newSessionId,
  saveConversation,
  loadConversation,
  listConversations,
  deleteConversation,
  renameConversation,
  setPinned,
} from './history-store';
import { Message } from './agent/types';

const config = AppConfig.load(CONFIG_PATH);

const conversationHistories = new Map<string, Message[]>();
const conversationTitles = new Map<string, string>();

function getHistory(conversationId: string): Message[] {
  return conversationHistories.get(conversationId) || [];
}

const manager = new ConversationManager({
  maxParallel: config.data.cowork.max_parallel,
  runTurn: (messages, emit, cancel) =>
    runCowork(createProvider(config), messages, config.coworkOutputDir(), emit, { cancel }),
});

export function registerIpcHandlers(mainWin: BrowserWindow): void {
  ipcMain.handle('cowork:send', (_e, conversationId: string, text: string) => {
    const userMessage: Message = { role: 'user', content: text };
    const result = manager.send(conversationId, userMessage, () => getHistory(conversationId), (messageId, event) => {
      mainWin.webContents.send('cowork:event', messageId, event);
      if (event.type === 'assistant_done') {
        const history = getHistory(conversationId);
        history.push(userMessage, { role: 'assistant', content: event.content, tool_calls: [] });
        conversationHistories.set(conversationId, history);
        persistConversation(conversationId);
      }
    });
    return result;
  });

  ipcMain.handle('cowork:cancel', (_e, conversationId: string, messageId: string) => manager.cancel(conversationId, messageId));

  ipcMain.handle('history:list', () => listConversations(config.historyDir()).filter((c) => c.kind === 'cowork' || c.kind === ''));

  ipcMain.handle('history:load', (_e, sessionId: string) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    const record = loadConversation(filePath);
    conversationHistories.set(sessionId, record.messages);
    conversationTitles.set(sessionId, record.title);
    return record;
  });

  ipcMain.handle('history:new', () => {
    const sessionId = newSessionId();
    conversationHistories.set(sessionId, []);
    return { sessionId };
  });

  ipcMain.handle('history:rename', (_e, sessionId: string, title: string) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    renameConversation(filePath, title);
  });

  ipcMain.handle('history:pin', (_e, sessionId: string, pinned: boolean) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    setPinned(filePath, pinned);
  });

  ipcMain.handle('history:delete', (_e, sessionId: string) => {
    const filePath = path.join(config.historyDir(), `cowork__${sessionId}.json`);
    deleteConversation(filePath);
    conversationHistories.delete(sessionId);
  });

  ipcMain.handle('settings:get', () => config.data);

  ipcMain.handle('settings:save', (_e, partial: Partial<AppConfigData>) => {
    config.data = { ...config.data, ...partial } as AppConfigData;
    config.save();
  });

  ipcMain.handle('shell:openPath', (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath);
  });

  ipcMain.on('win:minimize', () => mainWin.minimize());
  ipcMain.on('win:maximize', () => (mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize()));
  ipcMain.on('win:close', () => mainWin.close());
  ipcMain.on('open-external', (_e, url: string) => shell.openExternal(url));
}

function persistConversation(conversationId: string): void {
  const messages = getHistory(conversationId);
  const title = conversationTitles.get(conversationId);
  saveConversation(config.historyDir(), 'cowork', conversationId, messages, title ? { title } : {});
}
```

- [ ] **Step 2: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc';

let mainWin: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';

  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    frame: isMac,
    backgroundColor: '#FAF8F3',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWin.webContents.on('dom-ready', () => {
    mainWin?.webContents.send('platform', process.platform);
  });

  mainWin.on('closed', () => {
    mainWin = null;
  });

  registerIpcHandlers(mainWin);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { StreamEvent } from '../main/agent/types';

contextBridge.exposeInMainWorld('coworkAPI', {
  platform: process.platform,

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onPlatform: (cb: (platform: string) => void) => ipcRenderer.on('platform', (_e, p) => cb(p)),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),

  send: (conversationId: string, text: string) => ipcRenderer.invoke('cowork:send', conversationId, text),
  cancel: (conversationId: string, messageId: string) => ipcRenderer.invoke('cowork:cancel', conversationId, messageId),
  onEvent: (cb: (messageId: string, event: StreamEvent) => void) =>
    ipcRenderer.on('cowork:event', (_e, messageId, event) => cb(messageId, event)),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyLoad: (sessionId: string) => ipcRenderer.invoke('history:load', sessionId),
  historyNew: () => ipcRenderer.invoke('history:new'),
  historyRename: (sessionId: string, title: string) => ipcRenderer.invoke('history:rename', sessionId, title),
  historyPin: (sessionId: string, pinned: boolean) => ipcRenderer.invoke('history:pin', sessionId, pinned),
  historyDelete: (sessionId: string) => ipcRenderer.invoke('history:delete', sessionId),

  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (partial: Record<string, any>) => ipcRenderer.invoke('settings:save', partial),

  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
});
```

- [ ] **Step 4: Verify the whole project type-checks**

Run: `npx tsc --noEmit`
Expected: no errors (fix any type mismatches surfaced between `src/main/ipc.ts` and earlier modules before proceeding).

- [ ] **Step 5: Verify the full test suite still passes**

Run: `npm test`
Expected: all prior tests (Tasks 2–10) still pass — this task added no new unit tests, only Electron glue.

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: esbuild bundles `dist/main/index.js`, `dist/preload/index.js` successfully (renderer bundling still uses the Task 1 placeholder until Task 12).

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: wire IPC handlers, window creation, and preload bridge"
```

---

### Task 12: Renderer wiring — move UI into src/renderer, connect real logic

**Files:**
- Create: `src/renderer/index.html` (moved + adjusted from `renderer/index.html`)
- Create: `src/renderer/style.css` (moved from `renderer/style.css`, unchanged)
- Create: `src/renderer/assets/fpt-logo-color.png` (moved from `renderer/assets/`)
- Modify: `src/renderer/index.ts` (replace placeholder from Task 1 with the ported/extended logic from `renderer/app.js`)
- Delete: `main.js`, `preload.js`, `renderer/app.js`, `renderer/index.html`, `renderer/style.css`, `renderer/assets/` (old root-level files, now superseded)

**Interfaces:**
- Consumes (via `window.coworkAPI`, exposed by Task 11's preload): `send`, `cancel`, `onEvent`, `historyList`, `historyLoad`, `historyNew`, `historyRename`, `historyPin`, `historyDelete`, `settingsGet`, `settingsSave`, `openPath`, plus the existing window-control methods.
- No new automated tests — renderer DOM wiring is verified manually in Task 13. (Unit-testing DOM glue code with jsdom would duplicate what manual verification already covers for a UI this size; the manual test plan in Task 13 exercises every code path this task adds.)

- [ ] **Step 1: Move `renderer/index.html` to `src/renderer/index.html`**

Run:
```bash
mkdir -p src/renderer/assets
cp renderer/index.html src/renderer/index.html
cp renderer/style.css src/renderer/style.css
cp renderer/assets/fpt-logo-color.png src/renderer/assets/fpt-logo-color.png
```

Edit `src/renderer/index.html`: change the script tag at the bottom from `<script src="app.js"></script>` to `<script src="index.js"></script>` (esbuild's renderer bundle output name), and remove the static example history items / example transcript messages (lines showing "Báo cáo tuần & gửi Teams" mock data, the mock user/assistant bubble, the mock inline-plan and tool-step) since real data now drives the transcript and sidebar — keep only the structural containers (`#history-list`, `.transcript__inner`, `#thinking`, the composer, and the right panel's `.plan-card` / file-section templates, marked so JS can clone/populate them). Concretely:
- Empty out `<div class="sidebar__history" id="history-list">` to just the empty container (history items are rendered by JS).
- Empty out `<div class="transcript__inner">` down to just the `<div class="thinking" id="thinking">…</div>` block (kept, toggled by JS) — remove the two mock `.msg` blocks above it.
- In the chat header, change the static title `Báo cáo tuần &amp; gửi Teams` to a `<span id="chat-title">Cuộc trò chuyện mới</span>` and the sub-label to `<span id="chat-sub">Internal Agent</span>`.
- In the right panel, wrap the plan card contents in a container `id="plan-card-steps"` (empty by default) and the file lists in `id="output-files"` / `id="input-files"` (empty by default), keeping the section headers.
- Add a Settings modal markup right before `</body>`:
```html
<div class="modal" id="settings-modal" hidden>
  <div class="modal__panel">
    <h2>Settings</h2>
    <label>Provider
      <select id="settings-provider">
        <option value="openai_compat">OpenAI-compatible (Internal Gateway)</option>
        <option value="anthropic">Anthropic Claude</option>
      </select>
    </label>
    <label>Base URL <input type="text" id="settings-base-url"></label>
    <label>API Key <input type="password" id="settings-api-key"></label>
    <label>Model <input type="text" id="settings-model"></label>
    <div class="modal__actions">
      <button id="settings-cancel">Cancel</button>
      <button id="settings-save">Save</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add minimal modal CSS to `src/renderer/style.css`**

Append to the end of `src/renderer/style.css`:
```css
.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal[hidden] { display: none; }
.modal__panel { background: var(--bg-elevated, #fff); border-radius: 12px; padding: 24px; width: 360px; display: flex; flex-direction: column; gap: 12px; }
.modal__panel label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.modal__panel input, .modal__panel select { padding: 8px; border-radius: 6px; border: 1px solid #ccc; }
.modal__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
```

- [ ] **Step 3: Write `src/renderer/index.ts`**

```ts
import { PlanStep, StreamEvent } from '../main/agent/types';

interface CoworkAPI {
  platform: string;
  minimize(): void;
  maximize(): void;
  close(): void;
  onPlatform(cb: (platform: string) => void): void;
  openExternal(url: string): void;
  send(conversationId: string, text: string): Promise<{ messageId: string; queued: boolean }>;
  cancel(conversationId: string, messageId: string): Promise<boolean>;
  onEvent(cb: (messageId: string, event: StreamEvent) => void): void;
  historyList(): Promise<Array<{ session_id: string; title: string; pinned: boolean }>>;
  historyLoad(sessionId: string): Promise<{ title: string; messages: any[] }>;
  historyNew(): Promise<{ sessionId: string }>;
  historyRename(sessionId: string, title: string): Promise<void>;
  historyPin(sessionId: string, pinned: boolean): Promise<void>;
  historyDelete(sessionId: string): Promise<void>;
  settingsGet(): Promise<any>;
  settingsSave(partial: any): Promise<void>;
  openPath(targetPath: string): Promise<void>;
}

declare global {
  interface Window {
    coworkAPI?: CoworkAPI;
    lucide?: { createIcons: () => void };
  }
}

const api = window.coworkAPI;

// ── Platform setup ──────────────────────────────────────────
document.body.classList.add('platform-' + (api?.platform ?? 'unknown'));
api?.onPlatform((p) => {
  document.body.classList.remove('platform-unknown');
  document.body.classList.add('platform-' + p);
});

document.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
});

// ── Window controls ─────────────────────────────────────────
document.getElementById('btn-min')?.addEventListener('click', () => api?.minimize());
document.getElementById('btn-max')?.addEventListener('click', () => api?.maximize());
document.getElementById('btn-close')?.addEventListener('click', () => api?.close());

// ── State ────────────────────────────────────────────────────
let currentConversationId = '';
const assistantBubbles = new Map<string, HTMLElement>(); // messageId -> bubble element

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Transcript rendering ─────────────────────────────────────
function appendUserBubble(text: string): void {
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  const bubble = document.createElement('div');
  bubble.className = 'msg msg--user';
  bubble.innerHTML = `<div class="bubble bubble--user"><p>${escapeHtml(text)}</p></div>`;
  inner?.insertBefore(bubble, thinking);
  scrollToBottom();
}

function ensureAssistantBubble(messageId: string): HTMLElement {
  let bubble = assistantBubbles.get(messageId);
  if (bubble) return bubble;
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  bubble = document.createElement('div');
  bubble.className = 'msg msg--assistant';
  bubble.innerHTML = `
    <div class="msg__avatar"><i data-lucide="sparkles"></i></div>
    <div class="msg__body">
      <div class="msg__name">Internal Agent</div>
      <div class="msg__text"><p></p></div>
    </div>`;
  inner?.insertBefore(bubble, thinking);
  assistantBubbles.set(messageId, bubble);
  window.lucide?.createIcons();
  return bubble;
}

function appendAssistantText(messageId: string, delta: string): void {
  const bubble = ensureAssistantBubble(messageId);
  const p = bubble.querySelector('.msg__text p');
  if (p) p.textContent = (p.textContent || '') + delta;
  scrollToBottom();
}

function setThinking(active: boolean): void {
  const thinking = document.getElementById('thinking');
  if (thinking) thinking.style.display = active ? '' : 'none';
}

function scrollToBottom(): void {
  const transcript = document.getElementById('transcript');
  if (transcript) transcript.scrollTop = transcript.scrollHeight;
}

// ── Plan panel ───────────────────────────────────────────────
function renderPlan(steps: PlanStep[]): void {
  const container = document.getElementById('plan-card-steps');
  if (!container) return;
  container.innerHTML = steps
    .map((s) => {
      const cls = s.status === 'done' ? 'pstep--done' : s.status === 'running' ? 'pstep--active' : 'pstep--pending';
      const icon = s.status === 'done' ? 'check-circle-2' : s.status === 'running' ? 'loader' : 'circle';
      const spin = s.status === 'running' ? ' class="spin"' : '';
      return `<div class="pstep ${cls}"><i data-lucide="${icon}"${spin}></i><span>${escapeHtml(s.title)}</span></div>`;
    })
    .join('');
  window.lucide?.createIcons();
}

// ── Output files panel ───────────────────────────────────────
function addOutputFile(filePath: string): void {
  const container = document.getElementById('output-files');
  if (!container) return;
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const item = document.createElement('div');
  item.className = 'file-item file-item--elevated';
  item.dataset.path = filePath;
  item.innerHTML = `
    <i data-lucide="file-text" class="fi-icon fi-icon--doc"></i>
    <div class="fi-info"><div class="fi-name">${escapeHtml(name)}</div><div class="fi-meta">vừa cập nhật</div></div>
    <i data-lucide="external-link" class="fi-action"></i>`;
  item.addEventListener('click', () => api?.openPath(filePath));
  container.appendChild(item);
  window.lucide?.createIcons();
}

function removeOutputFile(filePath: string): void {
  const container = document.getElementById('output-files');
  container?.querySelector(`[data-path="${CSS.escape(filePath)}"]`)?.remove();
}

// ── Event stream from main ───────────────────────────────────
api?.onEvent((messageId, event: StreamEvent) => {
  setThinking(true);
  switch (event.type) {
    case 'text':
      appendAssistantText(messageId, event.delta);
      break;
    case 'assistant_done':
      setThinking(false);
      break;
    case 'plan_set':
      renderPlan(event.steps);
      break;
    case 'tool_result':
      if (event.path) addOutputFile(event.path);
      break;
    case 'outputs_added':
      event.paths.forEach(addOutputFile);
      break;
    case 'outputs_removed':
      event.paths.forEach(removeOutputFile);
      break;
    default:
      break;
  }
});

// ── Composer: Enter = send, Shift+Enter = newline ────────────
const composerInput = document.getElementById('composer-input') as HTMLElement | null;
const btnSend = document.getElementById('btn-send');

composerInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

btnSend?.addEventListener('click', () => void sendMessage());

async function sendMessage(): Promise<void> {
  const text = composerInput?.innerText.trim();
  if (!text || !api) return;

  if (!currentConversationId) {
    const { sessionId } = await api.historyNew();
    currentConversationId = sessionId;
  }

  appendUserBubble(text);
  composerInput!.innerText = '';
  composerInput!.focus();

  await api.send(currentConversationId, text);
}

// ── History sidebar ───────────────────────────────────────────
async function refreshHistoryList(): Promise<void> {
  if (!api) return;
  const items = await api.historyList();
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = items
    .map(
      (item) => `
    <div class="history-item${item.session_id === currentConversationId ? ' history-item--active' : ''}" data-session-id="${escapeHtml(item.session_id)}">
      <i data-lucide="message-square" class="hi-icon"></i>
      <div class="hi-body">
        <div class="hi-title">${escapeHtml(item.title)}</div>
        <div class="hi-meta"><span class="badge badge--cowork">COWORK</span></div>
      </div>
    </div>`,
    )
    .join('');
  list.querySelectorAll<HTMLElement>('.history-item').forEach((el) => {
    el.addEventListener('click', () => void openConversation(el.dataset.sessionId!));
  });
  window.lucide?.createIcons();
}

async function openConversation(sessionId: string): Promise<void> {
  if (!api) return;
  currentConversationId = sessionId;
  const record = await api.historyLoad(sessionId);
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  inner?.querySelectorAll('.msg').forEach((m) => m.remove());
  assistantBubbles.clear();

  for (const message of record.messages) {
    if (message.role === 'user') appendUserBubble(message.content);
    else if (message.role === 'assistant' && message.content) {
      const tempId = `history_${Math.random()}`;
      appendAssistantText(tempId, message.content);
    }
  }

  const titleEl = document.getElementById('chat-title');
  if (titleEl) titleEl.textContent = record.title || 'Cuộc trò chuyện mới';
  void thinking;
  await refreshHistoryList();
}

document.getElementById('btn-new-chat')?.addEventListener('click', () => {
  currentConversationId = '';
  const inner = document.querySelector('.transcript__inner');
  inner?.querySelectorAll('.msg').forEach((m) => m.remove());
  assistantBubbles.clear();
  const titleEl = document.getElementById('chat-title');
  if (titleEl) titleEl.textContent = 'Cuộc trò chuyện mới';
  composerInput?.focus();
});

// ── Settings modal ────────────────────────────────────────────
const settingsModal = document.getElementById('settings-modal') as HTMLElement | null;
document.getElementById('btn-settings')?.addEventListener('click', async () => {
  if (!api || !settingsModal) return;
  const data = await api.settingsGet();
  (document.getElementById('settings-provider') as HTMLSelectElement).value = data.active_provider;
  const conf = data.providers[data.active_provider];
  (document.getElementById('settings-base-url') as HTMLInputElement).value = conf.base_url || '';
  (document.getElementById('settings-api-key') as HTMLInputElement).value = conf.api_key || '';
  (document.getElementById('settings-model') as HTMLInputElement).value = conf.model || '';
  settingsModal.hidden = false;
});

document.getElementById('settings-cancel')?.addEventListener('click', () => {
  if (settingsModal) settingsModal.hidden = true;
});

document.getElementById('settings-save')?.addEventListener('click', async () => {
  if (!api || !settingsModal) return;
  const provider = (document.getElementById('settings-provider') as HTMLSelectElement).value;
  const baseUrl = (document.getElementById('settings-base-url') as HTMLInputElement).value;
  const apiKey = (document.getElementById('settings-api-key') as HTMLInputElement).value;
  const model = (document.getElementById('settings-model') as HTMLInputElement).value;
  const current = await api.settingsGet();
  current.active_provider = provider;
  current.providers[provider] = { ...current.providers[provider], base_url: baseUrl, api_key: apiKey, model };
  await api.settingsSave(current);
  settingsModal.hidden = true;
});

// ── Sidebar / panel collapse (unchanged from the static mockup) ──
const sidebar = document.getElementById('sidebar');
const btnCollapse = document.getElementById('btn-collapse-sidebar');

function setSidebar(expanded: boolean): void {
  if (!sidebar || !btnCollapse) return;
  sidebar.dataset.expanded = expanded ? 'true' : 'false';
  const icon = btnCollapse.querySelector('i');
  icon?.setAttribute('data-lucide', expanded ? 'panel-left-close' : 'panel-left-open');
  window.lucide?.createIcons();
}

btnCollapse?.addEventListener('click', () => setSidebar(sidebar?.dataset.expanded === 'false'));

const rightPanel = document.getElementById('right-panel');
const btnCollapseRp = document.getElementById('btn-collapse-panel');

function setPanel(expanded: boolean): void {
  if (!rightPanel || !btnCollapseRp) return;
  rightPanel.dataset.expanded = expanded ? 'true' : 'false';
  const icon = btnCollapseRp.querySelector('i');
  icon?.setAttribute('data-lucide', expanded ? 'panel-right-close' : 'panel-right-open');
  window.lucide?.createIcons();
}

btnCollapseRp?.addEventListener('click', () => setPanel(rightPanel?.dataset.expanded === 'false'));

// ── Init ───────────────────────────────────────────────────────
window.addEventListener('load', () => {
  scrollToBottom();
  window.lucide?.createIcons();
  void refreshHistoryList();
});
```

- [ ] **Step 4: Update `esbuild.config.mjs`'s renderer entry to also copy static assets**

Modify `esbuild.config.mjs` — after the `builds` loop in `run()`, add a static-file copy step:

```js
import * as fs from 'fs';
import * as path from 'path';

// ...inside run(), after the for-of loop over builds:
  const staticFiles = ['index.html', 'style.css'];
  for (const file of staticFiles) {
    fs.mkdirSync('dist/renderer', { recursive: true });
    fs.copyFileSync(path.join('src/renderer', file), path.join('dist/renderer', file));
  }
  fs.mkdirSync('dist/renderer/assets', { recursive: true });
  fs.cpSync('src/renderer/assets', 'dist/renderer/assets', { recursive: true });
```

- [ ] **Step 5: Remove the old root-level Electron files now superseded by `src/`**

Run:
```bash
git rm main.js preload.js renderer/app.js renderer/index.html renderer/style.css
git rm -r renderer/assets
```

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: `dist/main/index.js`, `dist/preload/index.js`, `dist/renderer/index.js`, `dist/renderer/index.html`, `dist/renderer/style.css`, `dist/renderer/assets/fpt-logo-color.png` all present.

- [ ] **Step 7: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer package.json esbuild.config.mjs
git commit -m "feat: move renderer into src/, wire real chat/history/settings logic"
```

---

### Task 13: Manual end-to-end verification

**Files:** none (verification only, no code changes expected unless a bug is found — if so, fix it in the relevant file from an earlier task and re-run this task's steps).

- [ ] **Step 1: Configure a real provider for manual testing**

Set an environment variable before launching (use whichever provider you have credentials for):
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export COWORK_ACTIVE_PROVIDER="anthropic"
```
(On Windows PowerShell: `$env:ANTHROPIC_API_KEY = "sk-ant-..."`, `$env:COWORK_ACTIVE_PROVIDER = "anthropic"`.)

- [ ] **Step 2: Launch the app**

Run: `npm start`
Expected: Electron window opens showing the Cowork tab UI, empty history sidebar, empty transcript, composer visible.

- [ ] **Step 3: Send a plain chat message**

Action: type "Xin chào, bạn là ai?" and press Enter.
Expected: user bubble appears immediately; assistant bubble appears and streams text word-by-word; Thinking indicator shows while streaming then hides; a new entry appears in the History sidebar.

- [ ] **Step 4: Request a text file to be generated**

Action: type "Tạo file ghi-chu.md với nội dung 'Xin chào từ Cowork Local'" and press Enter.
Expected: assistant streams a response; Plan panel shows steps transitioning pending → running → done; Output Files panel shows `ghi-chu.md`; clicking the file entry opens the containing folder in the OS file explorer; the file exists on disk at the configured `cowork.output_dir` (default `~/.cowork_local/output/cowork`) with the expected content.

- [ ] **Step 5: Send multiple messages in quick succession to exercise the queue**

Action: in the same conversation, send 6 short messages back-to-back (e.g. "1", "2", "3", "4", "5", "6") without waiting for replies.
Expected: no responses are lost or scrambled — each of the 6 gets its own reply; with `max_parallel` at its default of 5, the 6th visibly starts only once one of the first 5 completes (observable via the Thinking indicators / bubbles resolving in a staggered order, not strictly reverse or forward order).

- [ ] **Step 6: Reopen a previous conversation**

Action: click "Cuộc trò chuyện mới", then click back on the earlier conversation in the History sidebar.
Expected: the full prior transcript (user + assistant messages) re-renders correctly; composer is empty; sending a new message in this reopened conversation continues the same history (verify by asking the assistant to recall something said earlier in that conversation).

- [ ] **Step 7: Change provider via Settings**

Action: click the Settings (⚙) icon, switch Provider to the other option, fill in Base URL/API Key/Model, click Save.
Expected: modal closes; sending a new message now uses the newly selected provider (verify by checking that the model name behaves consistently with the new provider, or by temporarily using an invalid key for the old provider to confirm the switch took effect).

- [ ] **Step 8: Test Stop / cancel**

Action: send a message likely to produce a long response (e.g. "Viết một bài luận 500 từ về AI"), then click Stop shortly after streaming begins.
Expected: streaming halts promptly; no application crash; the conversation remains usable for the next message.

- [ ] **Step 9: Verify rate-limit and context-overflow handling do not crash the app (best-effort, non-blocking)**

If you have a way to trigger a 429 (e.g. sending many rapid requests to a rate-limited gateway) or a very long conversation that exceeds context, observe that the app shows the "⏳ Rate limit — waiting…" or "✂ Lịch sử quá dài…" message inline and continues, rather than showing an unhandled error. If you cannot trigger these conditions manually, skip this step — it is already covered by the unit tests in Tasks 4–5.

- [ ] **Step 10: Record the outcome**

If every expected behavior in Steps 2–8 was observed, the sub-project is functionally complete. If any step failed, identify the responsible file from Tasks 1–12, fix it, re-run the relevant unit tests (`npm test`), rebuild (`npm run build`), and repeat the failing manual step until it passes. Do not mark the plan complete until Steps 2–8 all pass.

---

## Self-Review Notes

- **Spec coverage:** chat streaming (Tasks 4, 5, 9), `save_file` text-only (Task 8, 9), plan panel/`update_plan` (Task 8, 9), History list/load/new/rename/pin/delete (Task 7, 11, 12), concurrent sends with `max_parallel` + queue (Task 10), Settings modal (Task 12), Stop/cancel (Task 10, 11, 12), 429 retry + context-overflow trim (Task 3, 4, 5) — all covered. Renderer base reuse from existing `renderer/` markup — covered in Task 12. esbuild TypeScript build — covered in Task 1. Out-of-scope items (attachments, Office docs, skills, Teams, Code/Structure/MS365 tabs) are explicitly excluded from every task's file list.
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code or an exact command with expected output.
- **Type consistency:** `StreamEvent`, `Message`, `ToolCall`, `ToolSpec`, `PlanStep`, `Provider`, `ChatCallbacks` are defined once in Task 2 and referenced identically (same names/shapes) in Tasks 3–12. `ConversationManager`'s `RunTurnFn` signature `(messages, emit, cancel) => Promise<Message[]>` matches how Task 11 wires `runCowork` into it. `doSaveFile`'s return shape `{ ok, output, path? }` matches its usage in `run-cowork.ts` (Task 9) and its test (Task 8).
