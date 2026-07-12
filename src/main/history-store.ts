import * as fs from 'fs';
import * as path from 'path';
import { Message, contentText } from './agent/types';

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
    if (m.role !== 'user') continue;
    const source = m.display || contentText(m.content);
    if (source) {
      const text = source.split(/\s+/).filter(Boolean).join(' ');
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
  const record = loadConversation(filePath);
  record.title = newTitle;
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

export function setPinned(filePath: string, pinned: boolean): void {
  const record = loadConversation(filePath);
  record.pinned = pinned;
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
}
