/**
 * Built-in TaskDefinition templates (agent-harness-plan.md Task 4.1) — read-only starting points
 * users can 1-touch reuse. They reference built-in agents (researcher/implementer/reviewer) so a
 * fresh install has runnable examples, including a fan-out template (the D1 headline).
 */

import type { TaskDefinition } from "@cowork-ghc/contracts";

export const BUILTIN_TASK_TEMPLATES: readonly TaskDefinition[] = Object.freeze([
  {
    id: "tpl-investigate",
    name: "Điều tra một câu hỏi",
    source: "built_in",
    goal: "Điều tra câu hỏi sau trong workspace và trả về phát hiện có trích dẫn đường dẫn: {mục tiêu}",
    loop: { mode: "run_once", maxTurns: 8, maxDurationMs: 300_000 },
    agentId: "researcher",
  },
  {
    id: "tpl-implement-verified",
    name: "Hiện thực đến khi được xác minh",
    source: "built_in",
    goal: "Thực hiện thay đổi tối thiểu cho yêu cầu sau, rồi tự kiểm tra kết quả: {mục tiêu}",
    loop: { mode: "retry_until_verified", maxTurns: 12, maxDurationMs: 600_000, requireVerifiedEvidence: true },
    agentId: "implementer",
  },
  {
    id: "tpl-fanout-review",
    name: "Review song song (fan-out)",
    source: "built_in",
    goal: "Đánh giá thay đổi hiện tại từ nhiều góc độ và tổng hợp phát hiện: {mục tiêu}",
    loop: { mode: "run_once", maxTurns: 8, maxDurationMs: 300_000 },
    branches: [
      { agentId: "reviewer", focus: "tính đúng đắn và rủi ro" },
      { agentId: "researcher", focus: "bối cảnh và ràng buộc liên quan" },
    ],
    maxConcurrency: 2,
  },
]);
