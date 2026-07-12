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

  it('renameConversation persists the title for a legacy bare-array file', () => {
    // Legacy format: the file's top-level JSON is a bare array of messages,
    // not the full {kind, title, ..., messages} object.
    const filePath = path.join(tmpDir, 'legacy__sess-1.json');
    fs.writeFileSync(filePath, JSON.stringify([{ role: 'user', content: 'hi' }]));

    renameConversation(filePath, 'New title');

    // The rename must actually persist (previously silently dropped because
    // `raw` was a JS array and JSON.stringify ignores non-index properties).
    expect(loadConversation(filePath).title).toBe('New title');
    // The file should also be upgraded to the full object format on disk.
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(Array.isArray(onDisk)).toBe(false);
    expect(onDisk.title).toBe('New title');
  });

  it('setPinned persists the pinned flag for a legacy bare-array file', () => {
    const filePath = path.join(tmpDir, 'legacy__sess-2.json');
    fs.writeFileSync(filePath, JSON.stringify([{ role: 'user', content: 'hi' }]));

    setPinned(filePath, true);

    expect(loadConversation(filePath).pinned).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(Array.isArray(onDisk)).toBe(false);
    expect(onDisk.pinned).toBe(true);
  });
});
