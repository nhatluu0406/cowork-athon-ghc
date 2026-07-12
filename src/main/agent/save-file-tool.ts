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
  const str = String(name);
  // Extract basename if there are path separators
  let base = str.includes('\\') || str.includes('/')
    ? str.split(/[\\\/]+/).pop() || ''
    : str;

  base = base.trim().replace(UNSAFE, '_').replace(/^[ _.]+|[ _.]+$/g, '') || 'output.txt';

  // Only add .txt if there's no dot and the original input didn't have path separators
  if (!str.includes('\\') && !str.includes('/') && !base.includes('.')) {
    base += '.txt';
  }

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
