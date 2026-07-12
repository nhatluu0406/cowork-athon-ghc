/**
 * Transcript context assembly tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleTranscriptContext,
  augmentPromptWithContext,
  MAX_CONTEXT_CHARS,
} from "../src/transcript-context.js";

const msg = (role: "user" | "assistant", text: string) => ({
  id: "m1",
  role,
  text,
  at: "2026-07-12T08:00:00.000Z",
});

test("assembleTranscriptContext includes ORANGE-731 in bounded block", () => {
  const messages = [
    msg("user", "Hãy nhớ mã kiểm tra là ORANGE-731."),
    msg("assistant", "Đã ghi nhớ mã ORANGE-731."),
  ];
  const assembled = assembleTranscriptContext(messages);
  assert.match(assembled.text, /ORANGE-731/);
  assert.equal(assembled.truncated, false);
  assert.equal(assembled.messageCount, 2);
});

test("augmentPromptWithContext prepends prior turns before user prompt", () => {
  const prior = [msg("user", "Hãy nhớ mã kiểm tra là ORANGE-731.")];
  const out = augmentPromptWithContext(prior, "Mã kiểm tra vừa rồi là gì?");
  assert.match(out, /ORANGE-731/);
  assert.match(out, /Mã kiểm tra vừa rồi là gì\?/);
  assert.ok(out.indexOf("ORANGE-731") < out.indexOf("Mã kiểm tra"));
});

test("assembleTranscriptContext truncates when over budget", () => {
  const long = "x".repeat(500);
  const messages = Array.from({ length: 40 }, (_, i) =>
    msg(i % 2 === 0 ? "user" : "assistant", `${long}-${i}`),
  );
  const assembled = assembleTranscriptContext(messages, 2000);
  assert.equal(assembled.truncated, true);
  assert.ok(assembled.text.length <= MAX_CONTEXT_CHARS);
});
