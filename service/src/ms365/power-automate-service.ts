/**
 * PowerAutomateService: trigger a Power Automate flow via its HTTP-request URL. NOT on
 * Microsoft Graph — a flow is invoked like any webhook, so the target URL is guarded on TWO
 * axes before (and while) it is ever fetched, because the URL is model-controlled at the tool
 * boundary:
 *
 *  1. SSRF policy (same one the provider port + Graph client use): rejects non-https, private,
 *     link-local, loopback and cloud-metadata targets, re-resolving DNS at call time. It returns
 *     the VALIDATED resolved IPs.
 *  2. Host allowlist: the URL host must belong to the Power Automate / Logic Apps family
 *     (`*.logic.azure.com` and the sovereign-cloud variants). This stops a prompt-injected model
 *     from POSTing arbitrary JSON to an attacker host even if that host resolves to a public IP.
 *
 * The fetch itself is then IP-PINNED to a validated address via the shared HTTPS dialer (the
 * same F2 socket-pin the provider connector uses): a bare `fetch(url)` would RE-RESOLVE the
 * hostname at connect time and defeat the SSRF DNS-rebinding guard (check-time public IP,
 * connect-time private IP). After dialing we assert the socket used one of the validated IPs.
 *
 * The trigger awaits the flow's response (bounded body) so the caller sees the flow's feedback,
 * and aborts after the per-flow timeout so a slow/hung flow never holds the request open. A 2xx
 * returns { status, body }; a non-2xx throws an Ms365Error whose message folds in the flow's own
 * (bounded) response body, so the caller sees WHY it failed. Name→URL resolution against the
 * configured (enabled) flow list happens at the tool-call boundary (ms365-tools.ts), not here —
 * this service only ever receives a resolved URL.
 */
import type { ConnectTarget, SsrfPolicy } from "../provider/index.js";
import { orderConnectCandidates } from "../provider/index.js";
import { createHttpsDialer, ProbeTimeoutError, type HttpDialer } from "../provider/http-dialer.js";
import { Ms365Error } from "./ms365-errors.js";
import type { PowerAutomateStore } from "./power-automate-store.js";

export const MAX_FLOW_BODY_CHARS = 65_536;
/** How much of a failed flow's response body to fold into the error message (the rest is noise
 * for a one-line diagnostic; the full bounded body still returns on success). */
export const MAX_ERROR_BODY_CHARS = 500;

export interface PowerAutomateService {
  listFlows(): { readonly name: string; readonly description: string; readonly payloadSchema: string }[];
  resolveFlow(name: string): { url: string; timeoutMs: number; enabled: boolean } | null;
  triggerFlow(input: { url: string; payload?: unknown; timeoutMs: number }): Promise<{ status: number; body: string }>;
}

/**
 * Host suffixes for the Power Automate / Azure Logic Apps HTTP-trigger endpoint across the
 * commercial and sovereign clouds. A flow's "When an HTTP request is received" callback URL is
 * always on this family, so the allowlist is least-privilege without breaking real flows.
 */
const POWER_AUTOMATE_HOST_SUFFIXES: readonly string[] = [
  ".logic.azure.com",
  ".logic.azure.us",
  ".logic.azure.cn",
  ".logic.azure.de",
];

function isAllowedFlowHost(host: string): boolean {
  const lower = host.toLowerCase();
  return POWER_AUTOMATE_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function createPowerAutomateService(deps: {
  store: PowerAutomateStore;
  ssrf: SsrfPolicy;
  /** Injected IP-pinning dial seam; defaults to the real HTTPS dialer. Tests inject a fake. */
  dialer?: HttpDialer;
}): PowerAutomateService {
  const dialer = deps.dialer ?? createHttpsDialer();

  async function dialPinned(
    target: ConnectTarget,
    body: string,
    timeoutMs: number,
  ): Promise<{ status: number; body: string }> {
    // IP-pinned Happy-Eyeballs: try the first validated address, then a different family. Every
    // candidate is an SSRF-validated IP, so the socket can only ever reach a vetted address.
    const candidates = orderConnectCandidates(target.resolved);
    if (candidates.length === 0) {
      throw new Ms365Error("graph_error", "Không phân giải được địa chỉ flow.", "Kiểm tra lại URL rồi thử lại.", false);
    }
    let lastError: unknown;
    for (const pin of candidates) {
      try {
        const response = await dialer({
          url: target.url,
          ip: pin.address,
          family: pin.family,
          headers: { "content-type": "application/json" },
          timeoutMs,
          method: "POST",
          body,
          // Await the flow's feedback (bounded) so the caller sees the response payload.
          readBody: true,
          maxBodyBytes: MAX_FLOW_BODY_CHARS,
        });
        // F2: refuse a socket that reached an IP the SSRF policy never validated (rebinding guard).
        if (!target.resolved.some((a) => a.address === response.dialedIp)) {
          throw new Ms365Error(
            "graph_error",
            "Kết nối flow bị từ chối (địa chỉ không hợp lệ).",
            "Thử lại; nếu tiếp diễn, kiểm tra lại URL flow.",
            false,
          );
        }
        // A non-2xx is a real answer from the flow, not a transport failure: return the bounded
        // body so the tool layer can surface the flow's own error payload.
        return { status: response.status, body: response.bodyText ?? "" };
      } catch (cause) {
        // An Ms365Error is a real answer (validation/pin), not a transport failure — do not fall back.
        if (cause instanceof Ms365Error) throw cause;
        // A per-flow timeout is a real, non-retryable outcome — surface it, don't try other IPs.
        if (cause instanceof ProbeTimeoutError) {
          throw new Ms365Error(
            "timeout",
            `Flow không phản hồi trong ${Math.round(timeoutMs / 1000)}s.`,
            "Tăng timeout của flow hoặc để flow trả action Response sớm hơn, rồi thử lại.",
            true,
          );
        }
        lastError = cause;
      }
    }
    throw new Ms365Error(
      "graph_error",
      "Không kết nối được tới flow.",
      lastError instanceof Error && lastError.name === "ProbeTimeoutError"
        ? "Flow không phản hồi kịp; thử lại sau."
        : "Kiểm tra lại URL flow và kết nối mạng rồi thử lại.",
      true,
    );
  }

  return {
    listFlows() {
      return deps.store.list().filter((f) => f.enabled).map((f) => ({ name: f.name, description: f.description, payloadSchema: f.payloadSchema }));
    },

    resolveFlow(name) {
      const flow = deps.store.resolve(name);
      if (flow === null) return null;
      return { url: flow.url, timeoutMs: flow.timeoutMs, enabled: flow.enabled };
    },

    async triggerFlow(input) {
      // Axis 1: SSRF policy (scheme/private/metadata/rebinding) — returns the validated target.
      const target = await deps.ssrf.assertAllowed(input.url);
      // Axis 2: host allowlist — only genuine Power Automate / Logic Apps hosts.
      if (!isAllowedFlowHost(target.url.hostname)) {
        throw new Ms365Error(
          "graph_error",
          "URL không thuộc Power Automate (chỉ chấp nhận *.logic.azure.com).",
          "Dùng URL trigger của flow Power Automate.",
          false,
        );
      }
      // The pinned dialer reads the bounded body WITHIN the per-flow timeout; it returns
      // { status, body } for any status, and this layer decides how to treat a non-2xx.
      const { status, body } = await dialPinned(target, JSON.stringify(input.payload ?? {}), input.timeoutMs);
      if (status < 200 || status >= 300) {
        // Surface the flow's own response body (bounded) so the caller sees WHY it failed — a 401
        // body usually explains the auth failure, which "HTTP 401" alone hides.
        const snippet = body.trim().slice(0, MAX_ERROR_BODY_CHARS);
        throw new Ms365Error(
          "graph_error",
          snippet.length > 0 ? `Flow trả lỗi HTTP ${status}: ${snippet}` : `Flow trả lỗi HTTP ${status}.`,
          status === 401
            ? "401 = URL/chữ ký SAS sai hoặc trigger yêu cầu xác thực. Kiểm tra lại URL flow (đủ query string) và cấu hình 'Who can trigger'."
            : "Kiểm tra lại flow/URL rồi thử lại.",
          false,
        );
      }
      return { status, body };
    },
  };
}
