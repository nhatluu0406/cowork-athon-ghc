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
 * Name→URL resolution against the configured flow list happens at the tool-call boundary
 * (ms365-tools.ts), not here — this service only ever receives an already-resolved URL.
 */
import type { ConnectTarget, SsrfPolicy } from "../provider/index.js";
import { orderConnectCandidates } from "../provider/index.js";
import { createHttpsDialer, type HttpDialer } from "../provider/http-dialer.js";
import { Ms365Error } from "./ms365-errors.js";
import type { PowerAutomateStore } from "./power-automate-store.js";

export interface PowerAutomateService {
  listFlows(): { readonly name: string }[];
  triggerFlow(input: { url: string; payload?: unknown }): Promise<{ status: number }>;
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

/** Hard upper bound on a flow trigger (ms); bounded, no retry loop. */
const TRIGGER_TIMEOUT_MS = 15_000;

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

  async function dialPinned(target: ConnectTarget, body: string): Promise<number> {
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
          timeoutMs: TRIGGER_TIMEOUT_MS,
          method: "POST",
          body,
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
        if (response.status < 200 || response.status >= 300) {
          throw new Ms365Error(
            "graph_error",
            `Flow trả lỗi HTTP ${response.status}.`,
            "Kiểm tra lại flow/URL rồi thử lại.",
            false,
          );
        }
        return response.status;
      } catch (cause) {
        // An Ms365Error is a real answer (status/pin), not a transport failure — do not fall back.
        if (cause instanceof Ms365Error) throw cause;
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
      return deps.store.list().map((f) => ({ name: f.name }));
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
      const status = await dialPinned(target, JSON.stringify(input.payload ?? {}));
      return { status };
    },
  };
}
