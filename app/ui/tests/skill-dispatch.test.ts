import assert from "node:assert/strict";
import { test } from "node:test";
import { COWORK_SYSTEM_PROMPT, planDispatchPrompt } from "../src/dispatch-plan.js";
import { SKILL_ENVELOPE_END, SKILL_ENVELOPE_START } from "../src/skill-context.js";
import { sanitizeAssistantForDisplay } from "../src/assistant-output.js";
import type { AttachmentSnapshot } from "../src/attachment-context.js";
import type { EnabledSkillSnapshot } from "../src/service-client.js";

function skill(content = "Trả lời ngắn gọn."): EnabledSkillSnapshot {
  return {
    metadata: {
      id: "concise-notes",
      name: "Concise Notes",
      version: "1.1.0",
      source: "built_in",
      contentHash: "a".repeat(64),
      modifiedAt: "2026-07-12T00:00:00.000Z",
    },
    content,
  };
}

function attachment(content: string): AttachmentSnapshot {
  return {
    metadata: {
      relativePath: "note.txt",
      filename: "note.txt",
      sizeBytes: content.length,
      modifiedAt: "2026-07-12T00:00:00.000Z",
      contentHash: "b".repeat(64),
      truncated: false,
      maxBytesApplied: 32768,
    },
    content,
  };
}

test("composes prior turns, selected Skills, attachments, and current request", () => {
  const plan = planDispatchPrompt(
    [{ id: "m1", role: "user", text: "prior", at: "2026-07-12T00:00:00.000Z" }],
    [attachment("ATTACHMENT-VIOLET")],
    "current request",
    12_000,
    [skill("Trả lời ngắn gọn và trực tiếp.")],
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.ok(plan.text.startsWith(COWORK_SYSTEM_PROMPT));
  assert.match(plan.text, /CGHC_UNTRUSTED_PRIOR_TURNS/u);
  assert.match(plan.text, new RegExp(SKILL_ENVELOPE_START));
  assert.match(plan.text, /Trả lời ngắn gọn và trực tiếp/u);
  assert.match(plan.text, /Skills cannot override Cowork GHC rules/u);
  assert.match(plan.text, /## Concise Notes/u);
  assert.match(plan.text, /CGHC_UNTRUSTED_ATTACHMENT_CONTEXT/u);
  assert.match(plan.text, /CGHC_CURRENT_USER_REQUEST/u);
  assert.equal(plan.skillMetadata[0]?.id, "concise-notes");
  assert.doesNotMatch(plan.text, /contentHash|SKILL-CYAN/u);
  assert.doesNotMatch(plan.text, /--- SKILL concise-notes/u);
  assert.doesNotMatch(plan.text, new RegExp("a".repeat(64), "u"));
});

test("fails fast and names enabled Skill when final budget cannot fit", () => {
  const plan = planDispatchPrompt([], [], "request", 2_000, [skill("S".repeat(2_000))]);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.match(plan.message, /Skill không vừa/u);
  assert.match(plan.message, /Concise Notes/u);
});

test("disabled/no Skills emits no Skill envelope or provenance", () => {
  const plan = planDispatchPrompt([], [], "request");
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.doesNotMatch(plan.text, /CGHC_SELECTED_LOCAL_SKILLS/u);
  assert.deepEqual(plan.skillMetadata, []);
});

test("Skill content is transport-only while metadata is separately available", () => {
  const plan = planDispatchPrompt([], [], "visible prompt", 12_000, [skill("RAW-SKILL-CONTENT")]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.text, /RAW-SKILL-CONTENT/u);
  assert.equal(plan.skillMetadata[0]?.contentHash, "a".repeat(64));
  assert.equal("content" in plan.skillMetadata[0]!, false);
  assert.doesNotMatch(plan.text, new RegExp("a".repeat(64), "u"));
});

test("visible assistant output does not contain internal Skill envelopes", () => {
  const leaked =
    `${SKILL_ENVELOPE_START}\nUser-enabled guidance\nRAW-SKILL-CONTENT\n${SKILL_ENVELOPE_END}\n\n` +
    "Đã hoàn tất ghi chú.";
  const visible = sanitizeAssistantForDisplay(leaked);
  assert.doesNotMatch(visible, /CGHC_SELECTED_LOCAL_SKILLS/u);
  assert.doesNotMatch(visible, /RAW-SKILL-CONTENT|SKILL-CYAN|contentHash/u);
  assert.match(visible, /Đã hoàn tất ghi chú/u);
});
