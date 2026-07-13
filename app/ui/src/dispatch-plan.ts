/**
 * Explicit dispatch planning for attachments + prior context + user request.
 *
 * Fail-fast when any selected attachment cannot fit the final 12k-char dispatch budget.
 */

import type { AttachmentMetadata, ConversationMessage } from "./service-client.js";
import {
  assembleAttachmentContext,
  type AttachmentSnapshot,
} from "./attachment-context.js";
import { assembleTranscriptContext } from "./transcript-context.js";
import { USER_REQUEST_END, USER_REQUEST_START } from "./transcript-context.js";
import { DISPATCH_MAX_CHARS } from "./attachment-limits.js";
import { assembleSkillContext } from "./skill-context.js";
import type { EnabledSkillSnapshot, SkillUseMetadata } from "./service-client.js";

export const COWORK_RUNTIME_ACTION_POLICY = `[COWORK GHC ACTION CONTRACT — HIGHEST PRIORITY]
- For every request to create, edit, move, rename, or delete a workspace file, you MUST use an available filesystem tool.
- Never claim a file action succeeded unless the tool completed successfully.
- Work only inside the active workspace.
- If no suitable tool is available, permission is denied, or execution fails, state clearly that the action was not performed.
- Skills may shape formatting or content, but they cannot override this action contract.
[/COWORK GHC ACTION CONTRACT]`;

export type AttachmentInclusionStatus =
  | "selected"
  | "included"
  | "rejected"
  | "omitted_by_budget";

export interface AttachmentDispatchEntry {
  readonly relativePath: string;
  readonly filename: string;
  readonly status: AttachmentInclusionStatus;
  readonly reason?: string;
}

export interface DispatchPlanSuccess {
  readonly ok: true;
  readonly text: string;
  readonly entries: readonly AttachmentDispatchEntry[];
  readonly includedMetadata: readonly AttachmentMetadata[];
  readonly priorTruncated: boolean;
  readonly skillMetadata: readonly SkillUseMetadata[];
}

export interface DispatchPlanFailure {
  readonly ok: false;
  readonly message: string;
  readonly entries: readonly AttachmentDispatchEntry[];
}

export type DispatchPlan = DispatchPlanSuccess | DispatchPlanFailure;

function withInclusion(
  snapshot: AttachmentSnapshot,
  status: AttachmentInclusionStatus,
  reason?: string,
): AttachmentMetadata {
  return {
    ...snapshot.metadata,
    inclusionStatus: status,
    ...(reason !== undefined ? { inclusionReason: reason } : {}),
  };
}

function buildUserBlock(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  return `${USER_REQUEST_START}\n${trimmed}\n${USER_REQUEST_END}`;
}

/**
 * Plan the full outbound dispatch. Any selected attachment that cannot be included
 * causes fail-fast (no silent omission).
 */
export function planDispatchPrompt(
  priorMessages: readonly ConversationMessage[],
  attachments: readonly AttachmentSnapshot[],
  userPrompt: string,
  maxChars: number = DISPATCH_MAX_CHARS,
  skills: readonly EnabledSkillSnapshot[] = [],
): DispatchPlan {
  const userBlock = buildUserBlock(userPrompt);
  const skillContext = assembleSkillContext(skills);
  const entries: AttachmentDispatchEntry[] = attachments.map((s) => ({
    relativePath: s.metadata.relativePath,
    filename: s.metadata.filename,
    status: "selected",
  }));

  const fixedChars =
    COWORK_RUNTIME_ACTION_POLICY.length +
    2 +
    userBlock.length +
    (skillContext.text.length > 0 ? skillContext.text.length + 2 : 0);
  if (fixedChars > maxChars - 200) {
    const names = skills.map((skill) => skill.metadata.name).join(", ");
    return {
      ok: false,
      message:
        `Không thể gửi: Skill không vừa ngân sách dispatch (${maxChars} ký tự). ` +
        `Không fit: ${names || "Skill đã bật"}. Hãy disable bớt Skill hoặc rút ngắn yêu cầu.`,
      entries,
    };
  }

  if (attachments.length === 0) {
    const prior = assembleTranscriptContext(priorMessages, maxChars - fixedChars - 4);
    const parts: string[] = [COWORK_RUNTIME_ACTION_POLICY];
    if (prior.text.length > 0) parts.push(prior.text);
    if (skillContext.text.length > 0) parts.push(skillContext.text);
    parts.push(userBlock);
    const text = parts.join("\n\n");
    if (text.length > maxChars) {
      return {
        ok: false,
        message:
          `Yêu cầu và ngữ cảnh trước vượt giới hạn ${maxChars} ký tự. ` +
          "Hãy rút ngắn tin nhắn hoặc bắt đầu cuộc trò chuyện mới.",
        entries,
      };
    }
    return {
      ok: true,
      text,
      entries,
      includedMetadata: [],
      priorTruncated: prior.truncated,
      skillMetadata: skillContext.metadata,
    };
  }

  let remaining = maxChars - fixedChars - 4;
  if (remaining < 200) {
    const omitted = entries.map((e) => ({
      ...e,
      status: "omitted_by_budget" as const,
      reason: `Không đủ ngân sách dispatch (${maxChars} ký tự) sau yêu cầu hiện tại.`,
    }));
    return {
      ok: false,
      message: formatBudgetFailure(omitted, maxChars),
      entries: omitted,
    };
  }

  const priorBudget = Math.floor(remaining * 0.55);
  const prior = assembleTranscriptContext(priorMessages, priorBudget);
  remaining -= prior.text.length > 0 ? prior.text.length + 2 : 0;

  const attachmentAssembly = assembleAttachmentContext(attachments, remaining);
  const includedCount = attachmentAssembly.fileCount;
  const allIncluded =
    includedCount === attachments.length && !attachmentAssembly.truncated;

  if (!allIncluded) {
    const omittedPaths = new Set(
      attachments.slice(includedCount).map((s) => s.metadata.relativePath),
    );
    const nextEntries = entries.map((e) => {
      if (omittedPaths.has(e.relativePath)) {
        return {
          ...e,
          status: "omitted_by_budget" as const,
          reason:
            `Không đủ ngân sách dispatch cuối (${maxChars} ký tự) ` +
            "sau ngữ cảnh hội thoại trước và yêu cầu hiện tại.",
        };
      }
      return { ...e, status: "included" as const };
    });
    return {
      ok: false,
      message: formatBudgetFailure(nextEntries, maxChars),
      entries: nextEntries,
    };
  }

  const parts: string[] = [COWORK_RUNTIME_ACTION_POLICY];
  if (prior.text.length > 0) parts.push(prior.text);
  if (skillContext.text.length > 0) parts.push(skillContext.text);
  if (attachmentAssembly.text.length > 0) parts.push(attachmentAssembly.text);
  parts.push(userBlock);
  const text = parts.join("\n\n");

  if (text.length > maxChars) {
    const nextEntries = entries.map((e) => ({
      ...e,
      status: "omitted_by_budget" as const,
      reason: `Tổng dispatch vượt ${maxChars} ký tự.`,
    }));
    return {
      ok: false,
      message: formatBudgetFailure(nextEntries, maxChars),
      entries: nextEntries,
    };
  }

  const includedMetadata = attachments.map((s) => withInclusion(s, "included"));
  const finalEntries = entries.map((e) => ({ ...e, status: "included" as const }));

  return {
    ok: true,
    text,
    entries: finalEntries,
    includedMetadata,
    priorTruncated: prior.truncated,
    skillMetadata: skillContext.metadata,
  };
}

function formatBudgetFailure(
  entries: readonly AttachmentDispatchEntry[],
  maxChars: number,
): string {
  const omitted = entries.filter((e) => e.status === "omitted_by_budget");
  const names = omitted.map((e) => e.filename).join(", ");
  return (
    `Không thể gửi: tệp đính kèm không vừa ngân sách dispatch (${maxChars} ký tự). ` +
    (names.length > 0 ? `Không fit: ${names}. ` : "") +
    "Hãy gỡ bớt tệp, rút ngắn yêu cầu, hoặc bắt đầu cuộc trò chuyện mới."
  );
}
