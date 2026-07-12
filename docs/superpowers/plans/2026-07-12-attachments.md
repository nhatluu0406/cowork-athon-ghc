# Attachments (Sub-project #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port file/image attachments from the Python original to the Electron app — 3 attach methods (+ button, paste, drag-drop), npm-library text extraction embedded as an `[Attachments]` prompt section, and (improvement over the original) real vision-API image delivery via base64 content blocks.

**Architecture:** `Message.content` widens to `string | ContentPart[]` (string stays the format for image-free messages; both providers convert `ContentPart[]` to their API's block format). A new `src/main/attachments/` module extracts text (mammoth/xlsx/pdf-parse/jszip), encodes images, and builds the augmented content in the main process. The renderer only holds attachment *paths* (chips) and hands them to `cowork:send`; all file reading happens in main.

**Tech Stack:** TypeScript, Electron 35 (`dialog`, `webUtils.getPathForFile`), esbuild (bundles all pure-JS deps into dist/main), Vitest. New runtime deps: `mammoth`, `xlsx`, `pdf-parse`, `jszip`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-attachments-design.md`. Python reference: `OldVersion/src/cowork_local/ui/composer.py`, `core/doc_extract.py`, `ui/chat_panel.py` (`_augment`, lines 443–475).
- Every shell command that runs `npm`/`npx`/`node` MUST be prefixed with `export PATH="$PATH:/c/Program Files/nodejs"` (bash) — Node is not on the default PATH in this environment.
- Config defaults, verbatim from spec: `attachments: { max_files: 10, max_tokens: 500000 }`. Per-file character cap = `Math.max(1000, max_tokens) * 4` (~4 chars/token, same as Python `_attach_char_limit`).
- Image extensions (exactly these): `.png .jpg .jpeg .gif .bmp .webp`.
- `[Attachments]` section header, verbatim (same as Python): `[Attachments] — read and use these files to answer the request:`.
- `ContentPart` image `data` is raw base64 with NO `data:` URI prefix. Anthropic gets `{type:'image', source:{type:'base64', media_type, data}}`; OpenAI-compat gets `{type:'image_url', image_url:{url:'data:<mimeType>;base64,<data>'}}`.
- `Message.content` stays a plain `string` whenever there are no image parts (backward compatibility — text-only attachments still produce a string).
- Unreadable files never block sending: they get a note line in the `[Attachments]` section instead (format `- <name> (<note>; located at <path>)`).
- All existing tests (75 as of Task 0) must keep passing; run the full suite before every commit: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`.
- All work happens directly on `master` (standing project decision — no feature branch).
- UI copy is Vietnamese, matching existing strings in `src/renderer/index.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/agent/types.ts` (modify) | `ContentPart` union, `Message.content: string \| ContentPart[]`, `display`/`attachments` metadata fields, `contentText()` helper |
| `src/main/agent/provider-anthropic.ts` (modify) | Convert `ContentPart[]` user content → Anthropic content blocks |
| `src/main/agent/provider-openai-compat.ts` (modify) | Convert `ContentPart[]` user content → OpenAI content array |
| `src/main/config.ts` (modify) | `AttachmentsConf` in `AppConfigData` + defaults |
| `src/main/attachments/extract-text.ts` (create) | docx/xlsx/pptx/pdf/plain-text → text (mammoth, xlsx, pdf-parse, jszip) |
| `src/main/attachments/image-encode.ts` (create) | image path → `{mimeType, data(base64)}`; `isImagePath()` |
| `src/main/attachments/augment-prompt.ts` (create) | build `string \| ContentPart[]` from text + paths, applying limits |
| `src/main/attachments/pasted-image.ts` (create) | save base64 PNG from clipboard → `~/.cowork_local/pasted/paste-<ts>.png` |
| `src/main/ipc.ts` (modify) | `attachment:pick`, `attachment:savePastedImage`, extended `cowork:send` |
| `src/preload/index.ts` (modify) | `pickAttachments`, `savePastedImage`, `getPathForFile` (webUtils), extended `send` |
| `src/renderer/index.html` (modify) | attachment chip strip markup |
| `src/renderer/index.ts` (modify) | chip state/UI, + button, paste, drag-drop, bubble chips, reload rendering |
| `src/renderer/style.css` (modify) | chip styles |

---

### Task 1: `ContentPart` type + `contentText()` helper + mechanical call-site updates

Widening `Message.content` breaks compilation wherever code calls string methods on it. This task adds the type and fixes every call site *behavior-preservingly* (all existing content is still `string`); Tasks 2–3 add the real image conversion.

**Files:**
- Modify: `src/main/agent/types.ts`
- Modify: `src/main/agent/run-cowork.ts:58,61`
- Modify: `src/main/history-store.ts:37-45`
- Modify: `src/main/agent/provider-anthropic.ts:65-95` (`split()`)
- Modify: `src/main/agent/provider-openai-compat.ts:57-75` (`toApiMessages()`)
- Test: `tests/main/agent/types.test.ts`

**Interfaces:**
- Produces: `type ContentPart = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }`; `Message.content: string | ContentPart[]`; `Message.display?: string`; `Message.attachments?: string[]`; `contentText(content: string | ContentPart[] | undefined | null): string`.

- [ ] **Step 1: Write the failing tests** — append to `tests/main/agent/types.test.ts`:

```ts
import { contentText, ContentPart } from '../../../src/main/agent/types';

describe('contentText', () => {
  it('returns a plain string unchanged', () => {
    expect(contentText('hello')).toBe('hello');
  });

  it('returns empty string for undefined/null', () => {
    expect(contentText(undefined)).toBe('');
    expect(contentText(null)).toBe('');
  });

  it('joins text parts and skips image parts', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'first' },
      { type: 'image', mimeType: 'image/png', data: 'aWNvbg==' },
      { type: 'text', text: 'second' },
    ];
    expect(contentText(parts)).toBe('first\nsecond');
  });

  it('returns empty string for an empty part array', () => {
    expect(contentText([])).toBe('');
  });
});
```

(Adjust the import line to merge with the file's existing imports; keep all existing tests untouched.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/types.test.ts`
Expected: FAIL — `contentText` is not exported.

- [ ] **Step 3: Implement in `src/main/agent/types.ts`** — replace the `Message` interface and add:

```ts
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

/** Flatten message content to plain text (text parts joined with newlines; image parts skipped). */
export function contentText(content: string | ContentPart[] | undefined | null): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}
```

- [ ] **Step 4: Fix call sites (behavior-preserving)**

`src/main/agent/run-cowork.ts` — add `contentText` to the import from `./types`, then:

```ts
// line 58, was: if (!toolCalls.length && !(assistant.content || '').trim()) {
if (!toolCalls.length && !contentText(assistant.content).trim()) {
// line 61, was: emit({ type: 'assistant_done', content: assistant.content || '' });
emit({ type: 'assistant_done', content: contentText(assistant.content) });
```

`src/main/history-store.ts` — add `contentText` to the import from `./agent/types`, replace `deriveTitle`:

```ts
export function deriveTitle(messages: Message[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const source = m.display || contentText(m.content);
    if (source) {
      const text = source.split(/\s+/).filter(Boolean).join(' ');
      return text.length > 60 ? text.slice(0, 60) + '…' : text;
    }
  }
  return '(empty)';
}
```

`src/main/agent/provider-anthropic.ts` — add `contentText` to the import from `./types`, then inside `split()` replace every direct `m.content` string use:

```ts
if (m.role === 'system') {
  const text = contentText(m.content);
  if (text) systemParts.push(text);
} else if (m.role === 'tool') {
  const block = {
    type: 'tool_result',
    tool_use_id: m.tool_call_id || '',
    content: contentText(m.content),
  };
  // ... rest of the tool branch unchanged
} else if (m.role === 'assistant') {
  const blocks: any[] = [];
  const text = contentText(m.content);
  if (text) blocks.push({ type: 'text', text });
  // ... tool_calls loop and push unchanged
} else {
  api.push({ role: 'user', content: [{ type: 'text', text: contentText(m.content) }] });
}
```

`src/main/agent/provider-openai-compat.ts` — add `contentText` to the import from `./types`, then in `toApiMessages()` replace `m.content || ''` with `contentText(m.content)` in all three branches (assistant-with-tools, tool, default).

- [ ] **Step 5: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: all tests pass (75 existing + 4 new). Also run `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/types.ts src/main/agent/run-cowork.ts src/main/history-store.ts src/main/agent/provider-anthropic.ts src/main/agent/provider-openai-compat.ts tests/main/agent/types.test.ts
git commit -m "feat: widen Message.content to string | ContentPart[] with contentText helper"
```

---

### Task 2: AnthropicProvider — `ContentPart[]` → Anthropic image/text blocks

**Files:**
- Modify: `src/main/agent/provider-anthropic.ts` (the `else` user branch of `split()`)
- Test: `tests/main/agent/provider-anthropic.test.ts`

**Interfaces:**
- Consumes: `ContentPart`, `contentText` from Task 1.
- Produces: user messages whose `content` is `ContentPart[]` are sent as `[{type:'text',text}, {type:'image', source:{type:'base64', media_type: mimeType, data}}]` in part order.

- [ ] **Step 1: Write the failing test** — append inside `describe('AnthropicProvider', ...)` in `tests/main/agent/provider-anthropic.test.ts` (it already defines `sseStream`; reuse it):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/provider-anthropic.test.ts`
Expected: FAIL — the image part is flattened away by `contentText` (content is `[{type:'text',text:'what is in this image?'}]`).

- [ ] **Step 3: Implement** — in `provider-anthropic.ts`, add a module-level helper (below the imports) and use it in the user branch:

```ts
import { ContentPart } from './types'; // merge into the existing import list

function userContentBlocks(content: string | ContentPart[]): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const blocks = content.map((p) =>
    p.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } }
      : { type: 'text', text: p.text },
  );
  return blocks.length ? blocks : [{ type: 'text', text: '' }];
}
```

In `split()`, the user branch becomes:

```ts
} else {
  api.push({ role: 'user', content: userContentBlocks(m.content) });
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/provider-anthropic.ts tests/main/agent/provider-anthropic.test.ts
git commit -m "feat: send ContentPart images as Anthropic base64 image blocks"
```

---

### Task 3: OpenAICompatProvider — `ContentPart[]` → `image_url` data URIs

**Files:**
- Modify: `src/main/agent/provider-openai-compat.ts` (default branch of `toApiMessages()`)
- Test: `tests/main/agent/provider-openai-compat.test.ts`

**Interfaces:**
- Consumes: `ContentPart`, `contentText` from Task 1.
- Produces: user messages with `ContentPart[]` content are sent as `content: [{type:'text',text}, {type:'image_url', image_url:{url:'data:<mime>;base64,<data>'}}]`.

- [ ] **Step 1: Write the failing test** — append inside the existing describe block in `tests/main/agent/provider-openai-compat.test.ts`. Mirror that file's existing SSE-mock helper (it has one analogous to `sseStream`; reuse whatever it is named there — check the top of the file). The test body:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/provider-openai-compat.test.ts`
Expected: FAIL — content arrives as a flattened string.

- [ ] **Step 3: Implement** — in `provider-openai-compat.ts`, add a module-level helper and use it in the default branch of `toApiMessages()`:

```ts
import { ContentPart } from './types'; // merge into the existing import list

function userContentParts(content: string | ContentPart[]): string | any[] {
  if (typeof content === 'string') return content;
  return content.map((p) =>
    p.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }
      : { type: 'text', text: p.text },
  );
}
```

Default branch becomes:

```ts
return { role: m.role, content: userContentParts(m.content) };
```

Note: only the default branch changes. Assistant/tool messages keep `contentText(m.content)` (their content is always a string in practice, and those APIs require strings there). System messages flow through the default branch — `userContentParts` on a string returns the string unchanged, so system behavior is untouched.

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/provider-openai-compat.ts tests/main/agent/provider-openai-compat.test.ts
git commit -m "feat: send ContentPart images as OpenAI image_url data URIs"
```

---

### Task 4: `attachments` config section

**Files:**
- Modify: `src/main/config.ts`
- Test: `tests/main/config.test.ts`

**Interfaces:**
- Produces: `interface AttachmentsConf { max_files: number; max_tokens: number }`; `AppConfigData.attachments: AttachmentsConf`; default `{ max_files: 10, max_tokens: 500000 }`.

- [ ] **Step 1: Write the failing tests** — append to `tests/main/config.test.ts`, following the exact pattern of the existing `last_session` tests in that file (temp config path via the file's existing helper):

```ts
it('exposes attachments defaults', () => {
  const config = AppConfig.load(path.join(tmpDir, 'nope.json'));
  expect(config.data.attachments).toEqual({ max_files: 10, max_tokens: 500000 });
});

it('backfills attachments for configs written before the field existed', () => {
  const p = path.join(tmpDir, 'old.json');
  fs.writeFileSync(p, JSON.stringify({ active_provider: 'anthropic' }), 'utf-8');
  const config = AppConfig.load(p);
  expect(config.data.attachments).toEqual({ max_files: 10, max_tokens: 500000 });
  expect(config.data.active_provider).toBe('anthropic');
});

it('persists a stored attachments override', () => {
  const p = path.join(tmpDir, 'att.json');
  fs.writeFileSync(p, JSON.stringify({ attachments: { max_files: 3 } }), 'utf-8');
  const config = AppConfig.load(p);
  expect(config.data.attachments).toEqual({ max_files: 3, max_tokens: 500000 });
});
```

(Adapt `tmpDir` / imports to whatever names the existing tests use — read the file first and keep its conventions.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/config.test.ts`
Expected: FAIL — `attachments` is undefined.

- [ ] **Step 3: Implement** — in `src/main/config.ts`:

```ts
export interface AttachmentsConf {
  max_files: number;
  max_tokens: number;
}
```

Add `attachments: AttachmentsConf;` to `AppConfigData` (after `last_session`), and to `DEFAULT_CONFIG`:

```ts
attachments: { max_files: 10, max_tokens: 500000 },
```

Do NOT touch `deepMerge`, `load`, `save`, or `mergeAndSave`.

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts tests/main/config.test.ts
git commit -m "feat: add attachments {max_files, max_tokens} config section"
```

---

### Task 5: `extract-text.ts` — document text extraction

Installs the extraction libraries and ports `OldVersion/src/cowork_local/core/doc_extract.py` semantics: docx via mammoth, xlsx via the `xlsx` lib, pptx via jszip + regex (faithful port of `_pptx` — no dedicated npm pptx-text lib exists), pdf via pdf-parse, everything else read as UTF-8 unless the first 8 KB contain a NUL byte. Never throws — errors become `{text: null, note}`.

**Files:**
- Create: `src/main/attachments/extract-text.ts`
- Create: `src/main/attachments/pdf-parse.d.ts`
- Modify: `package.json` (via npm install)
- Test: `tests/main/attachments/extract-text.test.ts`

**Interfaces:**
- Produces: `interface ExtractResult { text: string | null; note: string }`; `async function extractText(filePath: string): Promise<ExtractResult>`.

- [ ] **Step 1: Install dependencies**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm install mammoth xlsx pdf-parse jszip`
Expected: added to `dependencies` in package.json. (esbuild bundles them into dist/main — all four are pure JS, no native modules.)

- [ ] **Step 2: Write the failing tests** — create `tests/main/attachments/extract-text.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { extractText } from '../../../src/main/attachments/extract-text';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildPptx(slideTexts: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  slideTexts.forEach((texts, i) => {
    const runs = texts.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('');
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${runs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Minimal valid single-page PDF with one text-drawing operator; xref offsets computed at build time. */
function buildTinyPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

describe('extractText', () => {
  it('extracts paragraphs from a .docx', async () => {
    const p = path.join(tmpDir, 'a.docx');
    fs.writeFileSync(p, await buildDocx(['Hello docx', 'Second paragraph']));
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('Hello docx');
    expect(text).toContain('Second paragraph');
  });

  it('extracts sheet rows from an .xlsx with sheet headers', async () => {
    const p = path.join(tmpDir, 'a.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Qty'], ['Widget', 3]]), 'Sheet1');
    XLSX.writeFile(wb, p);
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('--- Sheet 1 ---');
    expect(text).toContain('Widget');
    expect(text).toContain('3');
  });

  it('extracts slide text from a .pptx with slide headers', async () => {
    const p = path.join(tmpDir, 'a.pptx');
    fs.writeFileSync(p, await buildPptx([['Title slide'], ['Second slide', 'bullet']]));
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('--- Slide 1 ---');
    expect(text).toContain('Title slide');
    expect(text).toContain('--- Slide 2 ---');
    expect(text).toContain('bullet');
  });

  it('extracts text from a .pdf', async () => {
    const p = path.join(tmpDir, 'a.pdf');
    fs.writeFileSync(p, buildTinyPdf('Hello PDF'));
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('Hello PDF');
  });

  it('reads unknown extensions as UTF-8 when not binary', async () => {
    const p = path.join(tmpDir, 'notes.rst');
    fs.writeFileSync(p, 'plain text content', 'utf-8');
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toBe('plain text content');
  });

  it('flags binary files instead of dumping bytes', async () => {
    const p = path.join(tmpDir, 'blob.bin');
    fs.writeFileSync(p, Buffer.from([0x89, 0x00, 0x01, 0x02]));
    const { text, note } = await extractText(p);
    expect(text).toBeNull();
    expect(note).toBe('binary file — content not extracted');
  });

  it('returns a note (never throws) for unreadable/corrupt files', async () => {
    const p = path.join(tmpDir, 'corrupt.docx');
    fs.writeFileSync(p, 'this is not a zip', 'utf-8');
    const { text, note } = await extractText(p);
    expect(text).toBeNull();
    expect(note).toMatch(/^could not read/);
  });

  it('returns a note for a missing file', async () => {
    const { text, note } = await extractText(path.join(tmpDir, 'does-not-exist.txt'));
    expect(text).toBeNull();
    expect(note).toMatch(/^could not read/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/attachments/extract-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — create `src/main/attachments/pdf-parse.d.ts`:

```ts
declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(data: Buffer): Promise<{ text: string }>;
  export default pdfParse;
}
```

(The deep import bypasses pdf-parse's index.js, whose debug mode tries to read a bundled test PDF whenever `module.parent` is unset — which is the case under both Vitest ESM and esbuild bundling.)

Create `src/main/attachments/extract-text.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export interface ExtractResult {
  text: string | null;
  note: string;
}

const MAX_ROWS = 2000; // per spreadsheet sheet, same bound as the Python original

/**
 * Best-effort text extraction so the agent can read attachments.
 * Never throws — failures come back as {text: null, note}.
 */
export async function extractText(filePath: string): Promise<ExtractResult> {
  const suffix = path.extname(filePath).toLowerCase();
  try {
    if (suffix === '.docx' || suffix === '.docm') {
      const { value } = await mammoth.extractRawText({ path: filePath });
      return { text: value.trim(), note: '' };
    }
    if (suffix === '.xlsx' || suffix === '.xlsm') {
      return { text: extractXlsx(filePath), note: '' };
    }
    if (suffix === '.pptx') {
      return { text: await extractPptx(filePath), note: '' };
    }
    if (suffix === '.pdf') {
      const { text } = await pdfParse(fs.readFileSync(filePath));
      const trimmed = (text || '').trim();
      if (trimmed) return { text: trimmed, note: '' };
      return { text: null, note: 'PDF text could not be extracted' };
    }
    const raw = fs.readFileSync(filePath);
    if (raw.subarray(0, 8192).includes(0)) {
      return { text: null, note: 'binary file — content not extracted' };
    }
    return { text: raw.toString('utf-8'), note: '' };
  } catch (exc) {
    return { text: null, note: `could not read (${exc instanceof Error ? exc.message : String(exc)})` };
  }
}

function extractXlsx(filePath: string): string {
  const wb = XLSX.readFile(filePath, { sheetRows: MAX_ROWS });
  const out: string[] = [];
  wb.SheetNames.forEach((name, idx) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t' }).trim();
    if (csv) out.push(`--- Sheet ${idx + 1} ---\n${csv}`);
  });
  return out.join('\n\n').trim();
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function extractPptx(filePath: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10));
  const out: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1]));
    if (texts.length) out.push(`--- Slide ${i + 1} ---\n${texts.join('\n')}`);
  }
  return out.join('\n\n').trim();
}
```

- [ ] **Step 5: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: PASS. Also run `export PATH="$PATH:/c/Program Files/nodejs" && npm run build` — the esbuild bundle must succeed with the new deps.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/attachments/extract-text.ts src/main/attachments/pdf-parse.d.ts tests/main/attachments/extract-text.test.ts
git commit -m "feat: attachment text extraction (docx/xlsx/pptx/pdf/plain) via npm libraries"
```

---

### Task 6: `image-encode.ts`

**Files:**
- Create: `src/main/attachments/image-encode.ts`
- Test: `tests/main/attachments/image-encode.test.ts`

**Interfaces:**
- Produces: `function isImagePath(filePath: string): boolean`; `function encodeImage(filePath: string): { mimeType: string; data: string }` (throws on non-image extension or unreadable file — the caller handles it).

- [ ] **Step 1: Write the failing tests** — create `tests/main/attachments/image-encode.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isImagePath, encodeImage } from '../../../src/main/attachments/image-encode';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgenc-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isImagePath', () => {
  it('recognises the supported extensions case-insensitively', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'PNG', 'JPG']) {
      expect(isImagePath(`photo.${ext}`)).toBe(true);
    }
  });

  it('rejects non-image extensions', () => {
    expect(isImagePath('report.docx')).toBe(false);
    expect(isImagePath('archive.zip')).toBe(false);
    expect(isImagePath('noext')).toBe(false);
  });
});

describe('encodeImage', () => {
  it('returns mime type and base64 payload without a data: prefix', () => {
    const p = path.join(tmpDir, 'tiny.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fs.writeFileSync(p, bytes);
    const { mimeType, data } = encodeImage(p);
    expect(mimeType).toBe('image/png');
    expect(data).toBe(bytes.toString('base64'));
    expect(data.startsWith('data:')).toBe(false);
  });

  it('maps .jpg and .jpeg to image/jpeg', () => {
    const p = path.join(tmpDir, 'a.jpg');
    fs.writeFileSync(p, Buffer.from([1, 2, 3]));
    expect(encodeImage(p).mimeType).toBe('image/jpeg');
  });

  it('throws for a missing file', () => {
    expect(() => encodeImage(path.join(tmpDir, 'gone.png'))).toThrow();
  });

  it('throws for a non-image extension', () => {
    expect(() => encodeImage(path.join(tmpDir, 'a.txt'))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/attachments/image-encode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/attachments/image-encode.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
};

export function isImagePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() in IMAGE_MIME;
}

export function encodeImage(filePath: string): { mimeType: string; data: string } {
  const mimeType = IMAGE_MIME[path.extname(filePath).toLowerCase()];
  if (!mimeType) throw new Error(`not a supported image type: ${filePath}`);
  return { mimeType, data: fs.readFileSync(filePath).toString('base64') };
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/attachments/image-encode.ts tests/main/attachments/image-encode.test.ts
git commit -m "feat: image mime detection and base64 encoding for attachments"
```

---

### Task 7: `augment-prompt.ts` — build the final message content

Port of Python `_augment` (chat_panel.py:452-475) plus the vision upgrade: images become real `ContentPart` image blocks instead of path-only text lines.

**Files:**
- Create: `src/main/attachments/augment-prompt.ts`
- Test: `tests/main/attachments/augment-prompt.test.ts`

**Interfaces:**
- Consumes: `extractText` (Task 5), `isImagePath`/`encodeImage` (Task 6), `ContentPart` (Task 1).
- Produces: `interface AttachmentLimits { maxFiles: number; maxTokens: number }`; `async function augmentPrompt(text: string, attachmentPaths: string[], limits: AttachmentLimits): Promise<string | ContentPart[]>`.

Behavior contract:
- No attachments → returns `text` unchanged (string).
- Attachments but no images → returns a single augmented **string**.
- ≥1 successfully encoded image → returns `ContentPart[]`: one leading text part (the full augmented text) followed by the image parts in attachment order.
- Per-file char cap = `Math.max(1000, limits.maxTokens) * 4`; over-limit content is cut with the trailer `\n…(truncated to ~<cap/4> tokens)…`.
- More than `limits.maxFiles` paths (when `maxFiles > 0`): only the first `maxFiles` are processed; a final note line records how many were dropped.
- Unreadable file → `- <name> (<note>; located at <path>)`. Failed image encode → `- <name> (could not read image: <reason>; located at <path>)`, no image part, no throw.

- [ ] **Step 1: Write the failing tests** — create `tests/main/attachments/augment-prompt.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { augmentPrompt } from '../../../src/main/attachments/augment-prompt';
import { ContentPart } from '../../../src/main/agent/types';

let tmpDir: string;
const limits = { maxFiles: 10, maxTokens: 500000 };

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'augment-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeText(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('augmentPrompt', () => {
  it('returns the text unchanged when there are no attachments', async () => {
    expect(await augmentPrompt('just chat', [], limits)).toBe('just chat');
  });

  it('embeds a text file as an [Attachments] section and stays a string', async () => {
    const p = writeText('notes.txt', 'file body here');
    const result = await augmentPrompt('summarise this', [p], limits);
    expect(typeof result).toBe('string');
    const s = result as string;
    expect(s.startsWith('summarise this')).toBe(true);
    expect(s).toContain('[Attachments] — read and use these files to answer the request:');
    expect(s).toContain(`- notes.txt (${p})`);
    expect(s).toContain('--- Content of notes.txt ---');
    expect(s).toContain('file body here');
    expect(s).toContain('--- end of notes.txt ---');
  });

  it('returns ContentPart[] with a leading text part when an image is attached', async () => {
    const img = path.join(tmpDir, 'shot.png');
    fs.writeFileSync(img, Buffer.from([1, 2, 3, 4]));
    const result = await augmentPrompt('what is this?', [img], limits);
    expect(Array.isArray(result)).toBe(true);
    const parts = result as ContentPart[];
    expect(parts[0].type).toBe('text');
    expect((parts[0] as any).text).toContain('what is this?');
    expect((parts[0] as any).text).toContain('shot.png');
    expect(parts[1]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3, 4]).toString('base64'),
    });
  });

  it('mixes text extraction and image parts in one message', async () => {
    const doc = writeText('data.txt', 'tabular stuff');
    const img = path.join(tmpDir, 'pic.jpg');
    fs.writeFileSync(img, Buffer.from([9, 9]));
    const parts = (await augmentPrompt('analyse', [doc, img], limits)) as ContentPart[];
    expect(parts).toHaveLength(2);
    expect((parts[0] as any).text).toContain('tabular stuff');
    expect((parts[1] as any).mimeType).toBe('image/jpeg');
  });

  it('truncates over-limit file content and notes the cut', async () => {
    const small = { maxFiles: 10, maxTokens: 1000 }; // cap = 4000 chars (floor 1000 tokens)
    const p = writeText('big.txt', 'x'.repeat(10000));
    const s = (await augmentPrompt('read', [p], small)) as string;
    expect(s).toContain('…(truncated to ~1000 tokens)…');
    expect(s.length).toBeLessThan(6000);
  });

  it('notes unreadable files without blocking the send', async () => {
    const missing = path.join(tmpDir, 'gone.txt');
    const s = (await augmentPrompt('read', [missing], limits)) as string;
    expect(s).toContain('- gone.txt (');
    expect(s).toContain(`located at ${missing}`);
    expect(s).not.toContain('--- Content of gone.txt ---');
  });

  it('drops paths beyond maxFiles and records how many were skipped', async () => {
    const a = writeText('a.txt', 'A');
    const b = writeText('b.txt', 'B');
    const c = writeText('c.txt', 'C');
    const s = (await augmentPrompt('read', [a, b, c], { maxFiles: 2, maxTokens: 500000 })) as string;
    expect(s).toContain('--- Content of a.txt ---');
    expect(s).toContain('--- Content of b.txt ---');
    expect(s).not.toContain('--- Content of c.txt ---');
    expect(s).toContain('1');
  });

  it('sends only the [Attachments] section when the user typed no text', async () => {
    const p = writeText('only.txt', 'body');
    const s = (await augmentPrompt('', [p], limits)) as string;
    expect(s.trimStart().startsWith('[Attachments]')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/attachments/augment-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/attachments/augment-prompt.ts`:

```ts
import * as path from 'path';
import { ContentPart } from '../agent/types';
import { extractText } from './extract-text';
import { isImagePath, encodeImage } from './image-encode';

export interface AttachmentLimits {
  maxFiles: number;
  maxTokens: number;
}

/**
 * Embed attachment paths AND their extracted contents into the prompt so the
 * agent actually reads each attached file; images become real vision content
 * blocks. Returns a plain string unless at least one image was encoded.
 */
export async function augmentPrompt(
  text: string,
  attachmentPaths: string[],
  limits: AttachmentLimits,
): Promise<string | ContentPart[]> {
  if (!attachmentPaths.length) return text;

  let paths = attachmentPaths;
  let droppedNote = '';
  if (limits.maxFiles > 0 && paths.length > limits.maxFiles) {
    droppedNote = `(giới hạn ${limits.maxFiles} tệp đính kèm — ${paths.length - limits.maxFiles} tệp cuối bị bỏ qua)`;
    paths = paths.slice(0, limits.maxFiles);
  }
  const charLimit = Math.max(1000, limits.maxTokens) * 4;

  const lines: string[] = text ? [text] : [];
  lines.push('\n[Attachments] — read and use these files to answer the request:');
  const imageParts: ContentPart[] = [];

  for (const p of paths) {
    const name = path.basename(p);
    if (isImagePath(p)) {
      try {
        const { mimeType, data } = encodeImage(p);
        imageParts.push({ type: 'image', mimeType, data });
        lines.push(`- ${name} (image attached below; located at ${p})`);
      } catch (exc) {
        const reason = exc instanceof Error ? exc.message : String(exc);
        lines.push(`- ${name} (could not read image: ${reason}; located at ${p})`);
      }
      continue;
    }
    const { text: content, note } = await extractText(p);
    if (content === null) {
      lines.push(`- ${name} (${note}; located at ${p})`);
      continue;
    }
    let body = content;
    let extra = '';
    if (body.length > charLimit) {
      body = body.slice(0, charLimit);
      extra = `\n…(truncated to ~${Math.floor(charLimit / 4)} tokens)…`;
    }
    lines.push(`- ${name} (${p})`);
    lines.push(`\n--- Content of ${name} ---\n${body}${extra}\n--- end of ${name} ---`);
  }
  if (droppedNote) lines.push(droppedNote);

  const fullText = lines.join('\n');
  if (!imageParts.length) return fullText;
  return [{ type: 'text', text: fullText }, ...imageParts];
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/attachments/augment-prompt.ts tests/main/attachments/augment-prompt.test.ts
git commit -m "feat: build augmented prompt content from attachments with limits"
```

---

### Task 8: Pasted-image saver + IPC + preload wiring

**Files:**
- Create: `src/main/attachments/pasted-image.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/attachments/pasted-image.test.ts` (IPC/preload wiring itself has no automated tests, same convention as sub-project #1 — gate is `tsc --noEmit` + `npm run build`)

**Interfaces:**
- Consumes: `augmentPrompt` + `AttachmentLimits` (Task 7), `config.data.attachments` (Task 4), `Message.display`/`attachments` (Task 1).
- Produces:
  - `function savePastedImage(base64Png: string, dir?: string): string` (returns saved file path; default dir `~/.cowork_local/pasted`)
  - IPC `attachment:pick` → `Promise<string[]>`
  - IPC `attachment:savePastedImage(base64Png: string)` → `Promise<string>`
  - IPC `cowork:send(conversationId, text, attachmentPaths: string[])` (3rd arg new, defaults `[]`)
  - preload: `pickAttachments(): Promise<string[]>`; `savePastedImage(base64Png: string): Promise<string>`; `getPathForFile(file: File): string`; `send(conversationId, text, attachmentPaths?: string[])`

- [ ] **Step 1: Write the failing test** — create `tests/main/attachments/pasted-image.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { savePastedImage } from '../../../src/main/attachments/pasted-image';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasted-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('savePastedImage', () => {
  it('writes the decoded bytes to paste-<timestamp>.png and returns the path', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const saved = savePastedImage(bytes.toString('base64'), tmpDir);
    expect(path.basename(saved)).toMatch(/^paste-\d{8}-\d{6}-\d{3}\.png$/);
    expect(fs.readFileSync(saved)).toEqual(bytes);
  });

  it('creates the target directory when missing', () => {
    const nested = path.join(tmpDir, 'deep', 'dir');
    const saved = savePastedImage(Buffer.from([1]).toString('base64'), nested);
    expect(fs.existsSync(saved)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/attachments/pasted-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pasted-image.ts`**:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_DIR } from '../config';

/** Save a clipboard-pasted PNG (base64) under the config dir; returns the file path. */
export function savePastedImage(base64Png: string, dir: string = path.join(CONFIG_DIR, 'pasted')): string {
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const name =
    `paste-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
    `${pad(now.getMilliseconds(), 3)}.png`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from(base64Png, 'base64'));
  return filePath;
}
```

- [ ] **Step 4: Run the test**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/attachments/pasted-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC in `src/main/ipc.ts`**

Add imports:

```ts
import { ipcMain, shell, dialog, BrowserWindow } from 'electron'; // add dialog
import { augmentPrompt } from './attachments/augment-prompt';
import { savePastedImage } from './attachments/pasted-image';
```

Replace the `cowork:send` handler (lines 63-70) with:

```ts
ipcMain.handle('cowork:send', async (_e, conversationId: string, text: string, attachmentPaths: string[] = []) => {
  const limits = {
    maxFiles: config.data.attachments.max_files,
    maxTokens: config.data.attachments.max_tokens,
  };
  const content = await augmentPrompt(text, attachmentPaths, limits);
  const userMessage: Message = { role: 'user', content };
  if (attachmentPaths.length) {
    userMessage.display = text;
    userMessage.attachments = [...attachmentPaths];
  }
  turnConversation.set(userMessage, conversationId);
  const result = manager.send(conversationId, userMessage, () => getHistory(conversationId), (messageId, event) => {
    mainWin.webContents.send('cowork:event', messageId, event);
  });
  return result;
});
```

Add the two new handlers (next to `cowork:compress`):

```ts
ipcMain.handle('attachment:pick', async () => {
  const result = await dialog.showOpenDialog(mainWin, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('attachment:savePastedImage', (_e, base64Png: string) => savePastedImage(base64Png));
```

- [ ] **Step 6: Extend `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer, webUtils } from 'electron'; // add webUtils
```

Change `send` and add three entries inside the `exposeInMainWorld` object:

```ts
send: (conversationId: string, text: string, attachmentPaths?: string[]) =>
  ipcRenderer.invoke('cowork:send', conversationId, text, attachmentPaths ?? []),
pickAttachments: () => ipcRenderer.invoke('attachment:pick'),
savePastedImage: (base64Png: string) => ipcRenderer.invoke('attachment:savePastedImage', base64Png),
// Electron ≥32 removed File.path from the renderer; webUtils in the preload is
// the supported way to resolve a dragged/pasted File back to its disk path.
getPathForFile: (file: File) => webUtils.getPathForFile(file),
```

- [ ] **Step 7: Verify gates**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx tsc --noEmit && npm test && npm run build`
Expected: all clean/passing.

- [ ] **Step 8: Commit**

```bash
git add src/main/attachments/pasted-image.ts src/main/ipc.ts src/preload/index.ts tests/main/attachments/pasted-image.test.ts
git commit -m "feat: attachment IPC (pick, paste-save, extended cowork:send) and preload bridge"
```

---

### Task 9: Renderer — pending-attachment chips, "+" button, extended send

No automated tests (renderer wiring convention from sub-project #1); gates are `tsc --noEmit` + `npm run build` + full suite regression.

**Files:**
- Modify: `src/renderer/index.html` (chip strip markup)
- Modify: `src/renderer/index.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: preload `pickAttachments()`, extended `send(conversationId, text, attachmentPaths?)` (Task 8); `settingsGet().attachments.max_files` (Task 4); existing `showComposerStatus(message)` helper.
- Produces (used by Task 10): `pendingAttachments: string[]` module state; `addAttachments(paths: string[]): void`; `shortName(p: string): string`; `appendUserBubble(text: string, attachmentPaths?: string[])` extended signature.

- [ ] **Step 1: Markup** — in `src/renderer/index.html`, insert the chip strip as the FIRST child of `.composer__box` (above the `composer-input` div):

```html
<div class="composer__attachments" id="composer-attachments" hidden></div>
```

- [ ] **Step 2: CSS** — append to `src/renderer/style.css`:

```css
/* ── Attachment chips (composer + message bubbles) ── */
.composer__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px 0;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 10px;
  border-radius: 999px;
  background: rgba(140, 146, 152, 0.18);
  font-size: 12px;
  max-width: 220px;
}
.attach-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attach-chip__x {
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 999px;
}
.attach-chip__x:hover {
  background: rgba(140, 146, 152, 0.3);
}
.bubble .attach-chip {
  background: rgba(255, 255, 255, 0.22);
}
.bubble__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
```

- [ ] **Step 3: Renderer state + chip rendering** — in `src/renderer/index.ts`:

Extend the `CoworkAPI` interface:

```ts
send(conversationId: string, text: string, attachmentPaths?: string[]): Promise<{ messageId: string; queued: boolean }>;
pickAttachments(): Promise<string[]>;
savePastedImage(base64Png: string): Promise<string>;
getPathForFile(file: File): string;
```

Add below the Compress-button section:

```ts
// ── Attachments ──────────────────────────────────────────────
let pendingAttachments: string[] = [];
let maxAttachFiles = 10;
void api?.settingsGet().then((s) => {
  const n = Number(s?.attachments?.max_files);
  if (Number.isFinite(n)) maxAttachFiles = n;
});

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function shortName(p: string): string {
  const name = baseName(p);
  return name.length > 22 ? name.slice(0, 19) + '…' : name;
}

function renderAttachmentChips(): void {
  const strip = document.getElementById('composer-attachments');
  if (!strip) return;
  strip.innerHTML = '';
  for (const p of pendingAttachments) {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.title = p;
    const name = document.createElement('span');
    name.className = 'attach-chip__name';
    name.textContent = `📎 ${shortName(p)}`;
    const x = document.createElement('button');
    x.className = 'attach-chip__x';
    x.setAttribute('aria-label', 'Bỏ tệp này');
    x.textContent = '✕';
    x.addEventListener('click', () => {
      pendingAttachments = pendingAttachments.filter((q) => q !== p);
      renderAttachmentChips();
    });
    chip.append(name, x);
    strip.appendChild(chip);
  }
  strip.hidden = pendingAttachments.length === 0;
}

function addAttachments(paths: string[]): void {
  let limited = false;
  for (const p of paths) {
    if (!p || pendingAttachments.includes(p)) continue;
    if (maxAttachFiles > 0 && pendingAttachments.length >= maxAttachFiles) {
      limited = true;
      break;
    }
    pendingAttachments.push(p);
  }
  renderAttachmentChips();
  if (limited) showComposerStatus(`Tối đa ${maxAttachFiles} tệp đính kèm — bỏ qua phần dư.`);
}

const btnAttach = document.querySelector<HTMLButtonElement>('.composer__bar [aria-label="Đính kèm"]');
btnAttach?.addEventListener('click', async () => {
  if (!api) return;
  const paths = await api.pickAttachments();
  if (paths.length) addAttachments(paths);
});
```

- [ ] **Step 4: Extend user bubbles and the send flow**

Replace `appendUserBubble` with:

```ts
function appendUserBubble(text: string, attachmentPaths: string[] = []): void {
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  const bubble = document.createElement('div');
  bubble.className = 'msg msg--user';
  const chips = attachmentPaths.length
    ? `<div class="bubble__attachments">${attachmentPaths
        .map((p) => `<span class="attach-chip" title="${escapeHtml(p)}"><span class="attach-chip__name">📎 ${escapeHtml(shortName(p))}</span></span>`)
        .join('')}</div>`
    : '';
  bubble.innerHTML = `<div class="bubble bubble--user"><p>${escapeHtml(text)}</p>${chips}</div>`;
  inner?.insertBefore(bubble, thinking);
  scrollToBottom();
}
```

(Note: `shortName`/`baseName` must be defined above `appendUserBubble` in the file, or use function declarations — they are `function` declarations, so hoisting makes either order fine.)

Replace `sendMessage` with:

```ts
async function sendMessage(): Promise<void> {
  const text = composerInput?.innerText.trim() || '';
  if ((!text && !pendingAttachments.length) || !api) return;

  if (!currentConversationId) {
    const { sessionId } = await api.historyNew();
    currentConversationId = sessionId;
  }

  const attachments = [...pendingAttachments];
  pendingAttachments = [];
  renderAttachmentChips();

  appendUserBubble(text || '(tệp đính kèm)', attachments);
  composerInput!.innerText = '';
  composerInput!.focus();

  const { messageId } = await api.send(currentConversationId, text, attachments);
  setInFlight(messageId);
}
```

- [ ] **Step 5: Verify gates**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx tsc --noEmit && npm test && npm run build`
Expected: all clean/passing.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/index.ts src/renderer/style.css
git commit -m "feat: attachment chips, + button picker, and attachment-aware send in renderer"
```

---

### Task 10: Renderer — paste, drag-drop, and history reload rendering

**Files:**
- Modify: `src/renderer/index.ts`

**Interfaces:**
- Consumes: `addAttachments`, `appendUserBubble(text, attachments)` (Task 9); preload `savePastedImage`, `getPathForFile` (Task 8); `contentText`, `Message.display`/`attachments` (Task 1).

- [ ] **Step 1: Paste handler** — add after the attachments section from Task 9:

```ts
composerInput?.addEventListener('paste', (e) => {
  const items = (e as ClipboardEvent).clipboardData?.items;
  if (!items || !api) return;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    e.preventDefault();
    const realPath = api.getPathForFile(file);
    if (realPath) {
      addAttachments([realPath]);
    } else if (file.type.startsWith('image/')) {
      // Clipboard screenshot: no disk path — save it via main, then attach the saved file.
      void file.arrayBuffer().then((buf) => {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return api!.savePastedImage(base64).then((saved) => addAttachments([saved]));
      });
    }
  }
});
```

- [ ] **Step 2: Drag-drop handler**:

```ts
composerInput?.addEventListener('dragover', (e) => {
  if ((e as DragEvent).dataTransfer?.types.includes('Files')) e.preventDefault();
});

composerInput?.addEventListener('drop', (e) => {
  const files = (e as DragEvent).dataTransfer?.files;
  if (!files || !files.length || !api) return;
  e.preventDefault();
  const paths = Array.from(files)
    .map((f) => api!.getPathForFile(f))
    .filter(Boolean);
  if (paths.length) addAttachments(paths);
});
```

- [ ] **Step 3: History reload rendering** — in `openConversation`, `import { contentText } from '../main/agent/types';` (merge into the existing import from that module) and replace the message loop:

```ts
for (const message of record.messages) {
  if (message.role === 'user') {
    const display = message.display ?? contentText(message.content);
    appendUserBubble(display || '(tệp đính kèm)', message.attachments || []);
  } else if (message.role === 'assistant') {
    const tempId = `history_${Math.random()}`;
    const text = contentText(message.content);
    if (text.trim()) {
      appendAssistantText(tempId, text);
    } else {
      appendAssistantText(tempId, '✓ (tool actions completed)');
    }
  }
}
```

(`message.display` shows the original typed text instead of the multi-thousand-character augmented prompt; messages saved before this sub-project have plain-string content and no `display`, so they render exactly as before.)

- [ ] **Step 4: Verify gates**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx tsc --noEmit && npm test && npm run build`
Expected: all clean/passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.ts
git commit -m "feat: paste and drag-drop attachments; history reload renders display text + chips"
```

---

### Task 11: Manual end-to-end verification (deferred to the user)

No code. Run `npm start` with a real API key and verify:

- [ ] "+" opens the file dialog; multi-select adds removable chips above the input.
- [ ] Attaching a `.docx`/`.xlsx`/`.pdf` and asking "tóm tắt file này" → the model answers using the file's actual content.
- [ ] Attaching a screenshot via **paste** (Print Screen → Ctrl+V) creates `~/.cowork_local/pasted/paste-*.png`, and the model describes the image (vision).
- [ ] Drag-dropping a file from Explorer onto the input adds a chip.
- [ ] The 11th chip is refused with the "Tối đa 10 tệp đính kèm…" status line.
- [ ] Sent bubbles show the original text + chips; after app restart, reloading that conversation still shows text + chips (not the augmented prompt dump).
- [ ] A conversation with no attachments behaves exactly as before (regression).
