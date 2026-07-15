/**
 * Dispatch plan — explicit inclusion and fail-fast budget tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttachmentMetadata, ConversationMessage } from "../src/service-client.js";
import {
  COWORK_SYSTEM_PROMPT,
  MS365_ORCHESTRATION_POLICY,
  planDispatchPrompt,
} from "../src/dispatch-plan.js";
import type { AttachmentSnapshot } from "../src/attachment-context.js";
import { DISPATCH_MAX_CHARS } from "../src/attachment-limits.js";

const baseMeta = (relativePath: string, content: string): AttachmentMetadata => ({
  relativePath,
  filename: relativePath,
  sizeBytes: content.length,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  contentHash: "abc",
  truncated: false,
  maxBytesApplied: 32768,
});

function snapshot(relativePath: string, content: string): AttachmentSnapshot {
  return { metadata: baseMeta(relativePath, content), content };
}

const priorUser: ConversationMessage = {
  id: "1",
  role: "user",
  text: "hello",
  at: "2026-01-01T00:00:00.000Z",
};

test("planDispatchPrompt always prepends the Cowork GHC system prompt", () => {
  const plan = planDispatchPrompt([], [], "Hãy tạo file demo.txt");
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.ok(plan.text.startsWith(COWORK_SYSTEM_PROMPT));
    assert.match(plan.text, /You are Cowork GHC/u);
    assert.match(plan.text, /use the available filesystem tools/i);
    assert.match(plan.text, /Never claim a file action succeeded/i);
    assert.match(plan.text, /Reply in the user's language/i);
    assert.doesNotMatch(plan.text, /contentHash|SKILL-CYAN|COWORK GHC ACTION CONTRACT/u);
  }
});

test("planDispatchPrompt includes single small attachment", () => {
  const plan = planDispatchPrompt([], [snapshot("a.txt", "VIOLET-428")], "what is the code?");
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.includedMetadata.length, 1);
    assert.equal(plan.includedMetadata[0]?.inclusionStatus, "included");
    assert.ok(plan.text.includes("VIOLET-428"));
  }
});

test("planDispatchPrompt fails when attachments exceed final budget", () => {
  const big = "x".repeat(4000);
  const plan = planDispatchPrompt(
    [],
    [snapshot("a.txt", big), snapshot("b.txt", big), snapshot("c.txt", big)],
    "short",
    DISPATCH_MAX_CHARS,
  );
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.match(plan.message, /ngân sách dispatch/i);
    assert.ok(plan.entries.some((e) => e.status === "omitted_by_budget"));
  }
});

test("planDispatchPrompt fails when prior context consumes attachment budget", () => {
  const longPrior: ConversationMessage[] = [];
  for (let i = 0; i < 60; i += 1) {
    longPrior.push({
      id: `u-${i}`,
      role: "user",
      text: `turn ${i} `.repeat(120),
      at: "2026-01-01T00:00:00.000Z",
    });
    longPrior.push({
      id: `a-${i}`,
      role: "assistant",
      text: `reply ${i} `.repeat(120),
      at: "2026-01-01T00:00:00.000Z",
    });
  }
  const plan = planDispatchPrompt(
    longPrior,
    [snapshot("small.txt", "y".repeat(7000))],
    "question",
  );
  assert.equal(plan.ok, false);
});

test("plan failure lists omitted attachments and includes no dispatch metadata", () => {
  const big = "z".repeat(4000);
  const plan = planDispatchPrompt(
    [],
    [snapshot("big.txt", big), snapshot("big2.txt", big), snapshot("big3.txt", big)],
    "q",
  );
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.ok(plan.entries.some((e) => e.status === "omitted_by_budget"));
    assert.equal(plan.includedMetadata?.length ?? 0, 0);
  }
});

test("MS365 policy block absent by default and when not connected", () => {
  const plan = planDispatchPrompt([], [], "xin chào");
  assert.equal(plan.ok, true);
  assert.ok(plan.ok && !plan.text.includes("MS365 ORCHESTRATION"));
  const explicit = planDispatchPrompt([], [], "xin chào", undefined, [], false);
  assert.ok(explicit.ok && !explicit.text.includes("MS365 ORCHESTRATION"));
});

test("MS365 policy block present right after the action policy when connected", () => {
  const plan = planDispatchPrompt([], [], "xin chào", undefined, [], true);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.ok(plan.text.includes(MS365_ORCHESTRATION_POLICY));
  const actionIdx = plan.text.indexOf(COWORK_SYSTEM_PROMPT);
  const ms365Idx = plan.text.indexOf(MS365_ORCHESTRATION_POLICY);
  assert.ok(actionIdx >= 0 && ms365Idx > actionIdx);
});

test("MS365 policy block contains the five orchestration rules", () => {
  for (const marker of [
    "hỏi lại user",          // rule 1: ask-if-ambiguous via chat
    "kế hoạch",              // rule 2: announce the step plan
    "etag",                  // rule 3: read-before-edit
    "planner_create_tasks",  // rule 4: batch tool
    "manual_mode",           // rule 4: fallback per-item on manual mode
    "thành công",            // rule 5: never fake success
  ]) {
    assert.ok(
      MS365_ORCHESTRATION_POLICY.toLowerCase().includes(marker.toLowerCase()),
      `policy must mention: ${marker}`,
    );
  }
});

test("MS365 policy block is budget-accounted (attachments path)", () => {
  // Với maxChars nhỏ, block bật lên phải tính vào fixedChars → fail-fast thay vì tràn budget.
  const tight = COWORK_SYSTEM_PROMPT.length + MS365_ORCHESTRATION_POLICY.length + 250;
  const plan = planDispatchPrompt([], [], "yêu cầu", tight, [], true);
  if (plan.ok) {
    assert.ok(plan.text.length <= tight);
  } else {
    assert.ok(plan.message.length > 0);
  }
});
