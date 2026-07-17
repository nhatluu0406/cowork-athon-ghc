/**
 * `/v1/remote` control surface (agent-harness-plan.md Task 2.4) — the desktop-facing half of
 * the remote feature that the `/remote` composer command drives. Token-guarded by the main
 * service (no `publicUnauthenticated`), it lets the desktop:
 *   - read remote status (gateway URL, phone-typable LAN URLs, paired devices);
 *   - issue a fresh one-time pairing code + a scannable QR (SVG) that encodes the pairing URL;
 *   - revoke one device or revoke everything (`/remote off`).
 *
 * It records nothing and enforces nothing itself: it delegates to the SAME {@link PairingRegistry}
 * the gateway authenticates against, so a code issued here pairs a phone there.
 */

import QRCode from "qrcode";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { PairingRegistry, PairedDeviceView } from "./pairing.js";

export const REMOTE_STATUS_PATH = "/v1/remote/status";
export const REMOTE_PAIRING_CODE_PATH = "/v1/remote/pairing-code";
export const REMOTE_REVOKE_PATH = "/v1/remote/revoke";
export const REMOTE_REVOKE_ALL_PATH = "/v1/remote/revoke-all";

/** Live gateway coordinates the desktop displays; `null` until (and unless) the gateway is up. */
export interface RemoteGatewayInfo {
  readonly url: string;
  readonly lanUrls: readonly string[];
}

/** Read-only holder the composition updates once the gateway binds (or on teardown). */
export interface RemoteControlState {
  /** Whether the flag is on and a gateway is currently listening. */
  enabled(): boolean;
  /** Current gateway coordinates, or `null` when not listening. */
  gateway(): RemoteGatewayInfo | null;
}

export interface RemoteStatusView {
  readonly enabled: boolean;
  readonly url: string | null;
  readonly lanUrls: readonly string[];
  readonly devices: readonly PairedDeviceView[];
  readonly activeCode: boolean;
}

export class RemoteRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "RemoteRequestError";
  }
}

/** Build the QR payload URL: the pairing page with the code prefilled (PWA reads `?code=`). */
function pairingUrl(base: string, code: string): string {
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}/?code=${encodeURIComponent(code)}`;
}

function readDeviceId(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new RemoteRequestError("Request body must be a JSON object.");
  }
  const id = (body as Record<string, unknown>)["deviceId"];
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new RemoteRequestError("deviceId is required.");
  }
  return id;
}

export interface RemoteRouterOptions {
  readonly pairing: PairingRegistry;
  readonly state: RemoteControlState;
}

export function createRemoteRouter(options: RemoteRouterOptions): BoundaryRouter {
  const { pairing, state } = options;

  function statusView(): RemoteStatusView {
    const gw = state.gateway();
    return {
      enabled: state.enabled(),
      url: gw?.url ?? null,
      lanUrls: gw?.lanUrls ?? [],
      devices: pairing.listDevices(),
      activeCode: pairing.activeCodeInfo().active,
    };
  }

  return {
    name: "remote-control",
    routes: [
      {
        method: "GET",
        path: REMOTE_STATUS_PATH,
        handler: (): RouteResult<RemoteStatusView> => ({ status: 200, data: statusView() }),
      },
      {
        method: "POST",
        path: REMOTE_PAIRING_CODE_PATH,
        handler: async (): Promise<
          RouteResult<{ code: string; expiresAtMs: number; qrSvg: string | null; pairingUrl: string | null }>
        > => {
          const gw = state.gateway();
          const { code, expiresAtMs } = pairing.issueCode();
          // QR encodes the phone-typable URL when the gateway is LAN-reachable; otherwise the
          // loopback URL (tunnel users open it through their VPN). QR generation never throws
          // for a short URL, but stay honest: on any failure return null, not a broken image.
          let qrSvg: string | null = null;
          let url: string | null = null;
          if (gw !== null) {
            const base = gw.lanUrls[0] ?? gw.url;
            url = pairingUrl(base, code);
            try {
              qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220 });
            } catch {
              qrSvg = null;
            }
          }
          return { status: 200, data: { code, expiresAtMs, qrSvg, pairingUrl: url } };
        },
      },
      {
        method: "POST",
        path: REMOTE_REVOKE_PATH,
        handler: (ctx: RouteContext): RouteResult<{ revoked: boolean }> => ({
          status: 200,
          data: { revoked: pairing.revoke(readDeviceId(ctx.body)) },
        }),
      },
      {
        method: "POST",
        path: REMOTE_REVOKE_ALL_PATH,
        handler: (): RouteResult<{ ok: true }> => {
          pairing.revokeAll();
          return { status: 200, data: { ok: true } };
        },
      },
    ],
  };
}
