/**
 * LIVE {@link ProviderConnector} over the supervised OpenCode child (CGHC-028 Wave A2).
 *
 * Fills the Tier 2 provider wire seam (`compose-service.ts` default: unreachable probe, no-op
 * cancel). It satisfies BOTH the provider `probe` (CGHC-011 test connection) and the session
 * {@link import("../session/index.js").StreamCanceller} `cancel` (S3) over the ONE child.
 *
 * - `probe` is a BOUNDED reachability check against the child health endpoint. It reports whether
 *   the local runtime is up; a deeper provider-auth round trip (which spends a token) is a Wave C
 *   bounded live concern, not this in-process reachability probe. The SSRF-validated `target` is
 *   passed by the port but not re-dialed here — the child owns the outbound vendor call.
 * - `cancel` POSTs the abort so streamed output stops at the runtime source. It is BEST-EFFORT:
 *   the run may already be terminal by the time the abort lands, so a non-2xx is swallowed (never
 *   strands a cancel), mirroring the CGHC-024 `abortSession` semantics.
 *
 * ROUTES (confirmed in-repo): health `GET /global/health`, cancel `POST /session/{id}/abort`.
 */

import type { ProviderError, ProviderId, TestResult } from "@cowork-ghc/contracts";
import type { ConnectTarget } from "../provider/index.js";
import type { ProviderConnector, StreamHandle } from "../provider/index.js";
import type { OpencodeHttp } from "./opencode-client.js";

export interface OpencodeConnectorOptions {
  readonly http: OpencodeHttp;
}

const UNAVAILABLE: ProviderError = {
  kind: "unavailable",
  message: "The local runtime is not reachable.",
  retryable: true,
  recovery: "Ensure the runtime is running, then retry the connection test.",
};

export function createOpencodeConnector(options: OpencodeConnectorOptions): ProviderConnector {
  return {
    async probe(_id: ProviderId, _target: ConnectTarget | null): Promise<TestResult> {
      const ok = await options.http.reachable({
        operation: "provider.probe",
        method: "GET",
        path: "/global/health",
      });
      return ok ? { ok: true } : { ok: false, error: UNAVAILABLE };
    },

    async cancel(handle: StreamHandle): Promise<void> {
      try {
        await options.http.send({
          operation: "session.abort",
          method: "POST",
          path: `/session/${encodeURIComponent(handle.id)}/abort`,
        });
      } catch {
        // Best-effort: the run may already be terminal; the stream frame is the source of truth.
      }
    },
  };
}
