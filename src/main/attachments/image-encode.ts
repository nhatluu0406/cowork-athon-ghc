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
