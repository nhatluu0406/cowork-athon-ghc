/**
 * PowerAutomateService: trigger a Power Automate flow via its HTTP-request URL. NOT on
 * Microsoft Graph — a flow is invoked like any webhook, so the target URL runs through the
 * same SsrfPolicy the provider HTTP connector uses before it is ever fetched (a flow URL is a
 * user-configured external endpoint, exactly the class of input SSRF pinning exists for).
 * Name→URL resolution against the configured flow list happens at the tool-call boundary
 * (ms365-tools.ts), not here — this service only ever receives an already-resolved URL.
 */
import type { SsrfPolicy } from "../provider/index.js";
import { Ms365Error } from "./ms365-errors.js";
import type { PowerAutomateStore } from "./power-automate-store.js";

export interface PowerAutomateService {
  listFlows(): { readonly name: string }[];
  triggerFlow(input: { url: string; payload?: unknown }): Promise<{ status: number }>;
}

export function createPowerAutomateService(deps: {
  store: PowerAutomateStore;
  ssrf: SsrfPolicy;
  fetchImpl?: typeof fetch;
}): PowerAutomateService {
  const fetchFn = deps.fetchImpl ?? fetch;

  return {
    listFlows() {
      return deps.store.list().map((f) => ({ name: f.name }));
    },

    async triggerFlow(input) {
      await deps.ssrf.assertAllowed(input.url);

      const response = await fetchFn(input.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.payload ?? {}),
        redirect: "error",
      });
      if (!response.ok) {
        throw new Ms365Error(
          "graph_error",
          `Flow trả lỗi HTTP ${response.status}.`,
          "Kiểm tra lại flow/URL rồi thử lại.",
          false,
        );
      }
      return { status: response.status };
    },
  };
}
