/**
 * Built-in AgentDefinitions (agent-harness-plan.md Task 5.1) — shipped, read-only personas.
 *
 * Each permission preset only ever NARROWS the live session policy (validated at catalog build):
 * the researcher and reviewer cannot write (`edit: deny`), the implementer inherits the live
 * `edit: ask`. None can re-enable a denied tool (bash/task stay denied by the base policy).
 */

import type { AgentDefinition } from "@cowork-ghc/contracts";

export const BUILTIN_AGENTS: readonly AgentDefinition[] = Object.freeze([
  {
    id: "researcher",
    name: "Researcher",
    source: "built_in",
    systemPrompt:
      "Bạn là tác nhân nghiên cứu. Chỉ đọc và phân tích workspace; KHÔNG chỉnh sửa tệp. " +
      "Trả về phát hiện có trích dẫn đường dẫn cụ thể và kết luận ngắn gọn.",
    skillIds: [],
    permissionPreset: { edit: "deny" },
  },
  {
    id: "implementer",
    name: "Implementer",
    source: "built_in",
    systemPrompt:
      "Bạn là tác nhân hiện thực. Thực hiện thay đổi tối thiểu, đúng phạm vi yêu cầu, " +
      "dùng công cụ chỉnh sửa tệp; mỗi hành động ghi phải qua permission. Không tự mở rộng phạm vi.",
    skillIds: [],
    permissionPreset: {},
  },
  {
    id: "reviewer",
    name: "Reviewer",
    source: "built_in",
    systemPrompt:
      "Bạn là tác nhân review. Chỉ đọc; đánh giá tính đúng đắn, rủi ro, và độ rõ ràng. " +
      "KHÔNG chỉnh sửa tệp. Trả về danh sách phát hiện xếp theo mức độ nghiêm trọng.",
    skillIds: [],
    permissionPreset: { edit: "deny" },
  },
]);
