/**
 * Real {@link WorkflowDraftGenerator} (Task 4.3, live wiring): turn a natural-language description
 * into a RAW `{ task, newAgent? }` candidate by asking the configured OpenAI-compatible provider
 * for a single JSON completion. The candidate is UNTRUSTED — `createWorkflowBuilder` runs the shared
 * `core/contracts` validators + key whitelist + preset-narrowing on it; this module never persists
 * and never runs anything.
 *
 * Security discipline mirrors `provider/model-discovery.ts` EXACTLY — it reuses the same primitives
 * with no new egress path: SSRF-validate the base_url at call time (DNS-rebinding guard), the
 * IP-pinning dialer, the F2 socket-pin assertion, and refuse redirects so the credential is never
 * resent to another host. The key is produced ONLY by {@link CredentialResolver.resolveInjection}
 * (scrubber-registered), placed ONLY into the Authorization header, and never logged or returned.
 *
 * The instruction prompt states the EXACT whitelisted schema so the model cannot emit `id`/`source`
 * (assigned by the builder) or unknown fields (refused by the builder). A proposed new agent is
 * referenced from the task by its NAME (the model cannot know the id the builder will assign);
 * `workflow-builder.ts` rewrites that name to the assigned id.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import type { ProviderEnvSpec } from "@cowork-ghc/runtime";
import type { ConnectTarget, SsrfPolicy } from "../provider/ssrf-policy.js";
import { orderConnectCandidates } from "../provider/ssrf-policy.js";
import type { CredentialResolver } from "../provider/http-connector.js";
import { SocketPinViolationError } from "../provider/http-connector.js";
import { createHttpsDialer, type HttpDialer, type HttpProbeResponse } from "../provider/http-dialer.js";
import { chatCompletionUrl } from "../provider/probe-profiles.js";
import type {
  WorkflowDraftCandidate,
  WorkflowDraftContext,
  WorkflowDraftGenerator,
} from "./workflow-builder.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_MAX_TOKENS = 2_000;

/** The active provider coordinates a draft call resolves at request time (never cached with a key). */
export interface WorkflowGenTarget {
  readonly baseUrl: string;
  readonly credentialRef: CredentialRef;
  readonly envSpec: ProviderEnvSpec;
  readonly modelId: string;
}

export interface WorkflowGeneratorOptions {
  readonly ssrf: SsrfPolicy;
  readonly credentials: CredentialResolver;
  /** Resolve the active provider profile's coordinates, or null when none is configured. */
  readonly resolveTarget: () => Promise<WorkflowGenTarget | null>;
  /** Injected dial seam; defaults to the real IP-pinning HTTPS dialer. Tests inject a fake. */
  readonly dialer?: HttpDialer;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly maxTokens?: number;
}

/** A non-secret failure surfaced to the builder (which maps it to an honest draft refusal). */
export class WorkflowGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowGenerationError";
  }
}

/** Build the instruction (system) message stating the exact whitelisted TaskDefinition schema. */
export function buildInstruction(knownAgentIds: readonly string[]): string {
  const agents = knownAgentIds.length > 0 ? knownAgentIds.join(", ") : "(không có)";
  return [
    "Bạn là bộ tạo workflow cho hệ thống Dispatch. Dựa trên MÔ TẢ của người dùng, hãy soạn MỘT",
    "workflow (task) để nhiều agent chạy song song. CHỈ trả về JSON hợp lệ, KHÔNG kèm văn bản, KHÔNG",
    "dùng markdown fence. Cấu trúc bắt buộc:",
    "",
    '{ "task": { ... }, "newAgent"?: { ... } }',
    "",
    "task:",
    "- name: string (≤100 ký tự, ngắn gọn).",
    "- goal: string (≤8000). ĐÂY LÀ NỘI DUNG THẬT, cụ thể, đã brainstorm — KHÔNG để placeholder.",
    "- loop: { mode: 'run_once' | 'retry_until_verified' | 'scheduled', maxTurns: 1..100,",
    "         maxDurationMs: 1000..3600000, requireVerifiedEvidence?: true }.",
    "- branches?: mảng ≤5 phần tử [{ agentId: string, focus?: string (≤8000) }] — mỗi branch là 1",
    "  agent chạy song song với trọng tâm riêng. HOẶC dùng agentId (1 agent) thay cho branches.",
    "- Phải có agentId HOẶC ≥1 branch.",
    "- maxConcurrency?: số nguyên dương ≤5 (mặc định 3).",
    "",
    `agentId hợp lệ: ${agents}. researcher/reviewer CHỈ ĐỌC (không sửa file); implementer sửa được file.`,
    "",
    "newAgent (CHỈ khi không agent sẵn nào hợp): { name, systemPrompt (≤8000), skillIds?: string[]≤32,",
    "permissionPreset?: { [tool]: 'allow'|'ask'|'deny' } (chỉ được THU HẸP quyền, không nới), model? }.",
    "Nếu dùng newAgent, trong task hãy tham chiếu nó bằng ĐÚNG chuỗi name của agent đó ở agentId.",
    "",
    "TUYỆT ĐỐI KHÔNG thêm field 'id' hay 'source' (hệ thống tự gán). KHÔNG field lạ ngoài danh sách trên.",
  ].join("\n");
}

/** Extract `choices[0].message.content` from an OpenAI-compatible chat response body. */
export function extractCompletionContent(bodyText: string | undefined): string | null {
  if (bodyText === undefined || bodyText.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>)["content"];
  return typeof content === "string" ? content : null;
}

/** Strip an optional ```json … ``` fence and parse the model's content into a raw draft candidate. */
export function parseDraftCandidate(content: string): WorkflowDraftCandidate {
  let text = content.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/u.exec(text);
  if (fence !== null) text = fence[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WorkflowGenerationError("Mô hình trả về JSON không hợp lệ.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WorkflowGenerationError("Mô hình trả về cấu trúc workflow không hợp lệ.");
  }
  const rec = parsed as Record<string, unknown>;
  if (rec["task"] === undefined) {
    throw new WorkflowGenerationError("Mô hình không trả về 'task'.");
  }
  return {
    task: rec["task"],
    ...(rec["newAgent"] !== undefined ? { newAgent: rec["newAgent"] } : {}),
  };
}

function completionBody(modelId: string, instruction: string, prompt: string, maxTokens: number): string {
  return JSON.stringify({
    model: modelId,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: prompt },
    ],
    stream: false,
    temperature: 0.2,
    max_tokens: maxTokens,
  });
}

/** Build a live workflow-draft generator backed by the configured provider's chat/completions. */
export function createLlmWorkflowDraftGenerator(
  options: WorkflowGeneratorOptions,
): WorkflowDraftGenerator {
  const { ssrf, credentials, resolveTarget } = options;
  const dialer = options.dialer ?? createHttpsDialer();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return async (prompt: string, context: WorkflowDraftContext): Promise<WorkflowDraftCandidate> => {
    const target = await resolveTarget();
    if (target === null) {
      throw new WorkflowGenerationError(
        "Chưa cấu hình provider. Vào Cài đặt → Nhà cung cấp để chọn provider + model trước.",
      );
    }

    // SSRF-validate + re-resolve the base_url at call time (DNS-rebinding guard), same as discovery.
    let connectTarget: ConnectTarget;
    try {
      connectTarget = await ssrf.assertAllowed(target.baseUrl);
    } catch {
      throw new WorkflowGenerationError("Endpoint provider bị chính sách mạng từ chối.");
    }

    const url = new URL(chatCompletionUrl(connectTarget));
    const candidates = orderConnectCandidates(connectTarget.resolved);
    if (candidates.length === 0) {
      throw new WorkflowGenerationError("Không phân giải được địa chỉ endpoint provider.");
    }

    const injection = await credentials.resolveInjection(target.credentialRef, target.envSpec);
    const headers = {
      authorization: `Bearer ${injection.value}`,
      "content-type": "application/json",
      accept: "application/json",
    };
    const body = completionBody(target.modelId, buildInstruction(context.knownAgentIds), prompt, maxTokens);

    let response: HttpProbeResponse | undefined;
    let pin = candidates[0]!;
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        response = await dialer({
          url,
          ip: candidate.address,
          family: candidate.family,
          headers,
          timeoutMs,
          method: "POST",
          body,
          readBody: true,
          maxBodyBytes,
        });
        pin = candidate;
        break;
      } catch (cause) {
        lastError = cause;
      }
    }
    if (response === undefined) {
      throw new WorkflowGenerationError(
        lastError instanceof Error ? `Gọi provider thất bại: ${lastError.message}` : "Gọi provider thất bại.",
      );
    }

    // F2: the socket MUST have used the exact validated IP (never trust re-resolution).
    const validated = connectTarget.resolved.some((a) => a.address === response!.dialedIp);
    if (response.dialedIp !== pin.address || !validated) {
      throw new SocketPinViolationError(pin.address, response.dialedIp);
    }
    // A redirect is REFUSED, not followed — the credential is never resent to another host.
    if (response.status >= 300 && response.status < 400) {
      throw new WorkflowGenerationError("Endpoint provider trả về redirect (bị từ chối).");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new WorkflowGenerationError(`Provider trả về lỗi HTTP ${response.status}.`);
    }

    const content = extractCompletionContent(response.bodyText);
    if (content === null) {
      throw new WorkflowGenerationError("Provider trả về phản hồi không đúng định dạng chat completion.");
    }
    return parseDraftCandidate(content);
  };
}
