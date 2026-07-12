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
