/**
 * Create text/image/pdf demo files for demo-seed.bat
 * Usage: node tools/demo/seed-binary.mjs <demo-workspace-dir>
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/demo/seed-binary.mjs <dir>");
  process.exit(1);
}

mkdirSync(target, { recursive: true });

writeFileSync(
  join(target, "welcome.txt"),
  "Cowork GHC Workspace Companion demo.\n",
  "utf8",
);
writeFileSync(
  join(target, "notes.md"),
  "# Demo notes\n\n- Open this file in Workspace mode.\n- Edit and save from the preview pane.\n",
  "utf8",
);

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
writeFileSync(join(target, "sample.png"), png);

const pdf = [
  "%PDF-1.1",
  "1 0 obj<<>>endobj",
  "2 0 obj<</Length 44>>stream",
  "BT /F1 12 Tf 72 720 Td (Demo PDF) Tj ET",
  "endstream",
  "endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 2 0 R>>endobj",
  "trailer<</Root<</Pages<</Kids[3 0 R]/Count 1>>>>>>",
  "%%EOF",
].join("\n");
writeFileSync(join(target, "sample.pdf"), pdf, "utf8");

console.log("binary demo files written");
