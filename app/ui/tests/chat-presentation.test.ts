/**
 * Chat presentation tests for Demo Polish Wave 1.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeAssistantForDisplay } from "../src/assistant-output.js";

const commercialCss = readFileSync(join(process.cwd(), "app/ui/src/commercial.css"), "utf8");
const skillMd = readFileSync(
  join(process.cwd(), "skills/builtin/concise-notes/SKILL.md"),
  "utf8",
);

test("assistant prose stays on transparent canvas; user uses accent bubble", () => {
  assert.match(commercialCss, /\.msg--assistant\s+\.msg__text[\s\S]*?background:\s*transparent/u);
  assert.match(commercialCss, /\.msg--user\s+\.msg__text[\s\S]*?accent-soft/u);
  assert.match(commercialCss, /\.msg--user\s*\{[\s\S]*?justify-content:\s*flex-end/u);
});

test("visible assistant output never keeps tool or Skill debug narration", () => {
  const cleaned = sanitizeAssistantForDisplay(
    "Sử dụng tool write\nĐã tạo notes.txt\nSKILL-CYAN-582\nHoàn tất.",
  );
  assert.equal(cleaned.includes("Sử dụng tool"), false);
  assert.equal(cleaned.includes("SKILL-CYAN"), false);
  assert.match(cleaned, /Đã tạo notes\.txt/u);
  assert.match(cleaned, /Hoàn tất/u);
});

test("Concise Notes skill does not force debug tokens or tool narration", () => {
  assert.doesNotMatch(skillMd, /SKILL-CYAN/u);
  assert.doesNotMatch(skillMd, /exactly three concise bullet/iu);
  assert.match(skillMd, /version:\s*1\.1\.1/u);
  assert.match(skillMd, /Không kể tên tool/u);
});
