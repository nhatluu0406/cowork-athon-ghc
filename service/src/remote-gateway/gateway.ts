/**
 * Remote gateway listener (agent-harness-plan.md Phase 2, MVP slice) — a SEPARATE HTTP server
 * that lets a paired phone read Cowork state. The main ADR 0003 service stays loopback-only
 * and untouched; this gateway holds the main service's per-launch client token SERVER-SIDE and
 * forwards an explicit ALLOWLIST of read-only routes. Remote devices authenticate with their
 * own per-device bearer token from the {@link PairingRegistry}; the main token is never sent
 * to, or visible from, a remote client.
 *
 * MVP transport honesty: binds loopback by default (pair over Tailscale/VPN — the `tunnel`
 * channel). `CGHC_REMOTE_LAN=1` binds all interfaces for a same-Wi-Fi demo WITHOUT TLS yet —
 * the `lan-qr` channel's TLS + cert pinning is a follow-up hardening slice, so LAN mode is a
 * dev/demo flag, not a shipped default. Both modes are OFF unless `CGHC_REMOTE_ENABLED` is on.
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { isLoopbackAddress } from "../server/loopback.js";
import { extractClientToken } from "../server/token.js";
import type { PairingRegistry } from "./pairing.js";
import { REMOTE_PWA_HTML, REMOTE_PWA_MANIFEST } from "./pwa.js";

const MAX_PAIR_BODY_BYTES = 4 * 1024;
/** Long-lived SSE pipes flow through the gateway; cut truly idle sockets after 5 minutes. */
const SOCKET_IDLE_TIMEOUT_MS = 300_000;

export interface RemoteGatewayOptions {
  /** Base URL of the main loopback service (e.g. `http://127.0.0.1:53211`). */
  readonly mainBaseUrl: string;
  /** The main service's per-launch client token. Held server-side only; never logged. */
  readonly mainClientToken: string;
  readonly pairing: PairingRegistry;
  /** Bind host. Default `127.0.0.1` (tunnel channel); `0.0.0.0` only for the LAN demo flag. */
  readonly host?: string;
  /** Bind port. Default `0` (ephemeral). */
  readonly port?: number;
  /** Secret-free diagnostic sink (bind address, request outcomes — never tokens). */
  readonly log?: (line: string) => void;
}

export interface RemoteGateway {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  /** Issue a fresh one-time pairing code (shown to the desktop user, never logged). */
  issuePairingCode(): { code: string; expiresAtMs: number };
  stop(): Promise<void>;
}

/** Flag guard: the whole remote feature is OFF unless this env var is set. */
export function isRemoteEnabled(env: Record<string, string | undefined>): boolean {
  return env["CGHC_REMOTE_ENABLED"] === "1" || env["CGHC_REMOTE_ENABLED"] === "true";
}

/** LAN demo bind (no TLS yet — see module doc). Loopback default otherwise. */
export function resolveRemoteBindHost(env: Record<string, string | undefined>): string {
  return env["CGHC_REMOTE_LAN"] === "1" || env["CGHC_REMOTE_LAN"] === "true"
    ? "0.0.0.0"
    : "127.0.0.1";
}

/** Phone-typable URLs for a LAN-bound gateway (non-internal IPv4 addresses). */
export function lanGatewayUrls(port: number): readonly string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) urls.push(`http://${addr.address}:${port}`);
    }
  }
  return urls;
}

/** Read a bounded request body (pairing only — proxied routes are GET). */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

/** Explicit remote-path → main-path allowlist. Anything else is 404, never forwarded. */
function resolveProxyTarget(pathname: string): string | undefined {
  if (pathname === "/api/conversations") return "/v1/conversations";
  if (pathname.startsWith("/api/conversations/")) {
    const rest = pathname.slice("/api/conversations/".length);
    // Exactly one extra segment (a conversation id) — no deeper paths are forwarded.
    if (rest.length > 0 && !rest.includes("/")) return `/v1/conversations/${rest}`;
    return undefined;
  }
  if (pathname === "/api/snapshot") return "/v1/session/stream/snapshot";
  if (pathname === "/api/stream") return "/v1/session/stream";
  return undefined;
}

export function startRemoteGateway(options: RemoteGatewayOptions): Promise<RemoteGateway> {
  const bindHost = options.host ?? "127.0.0.1";
  const bindPort = options.port ?? 0;
  const loopbackOnly = isLoopbackAddress(bindHost) || bindHost === "localhost";
  const log = options.log ?? (() => {});
  const main = new URL(options.mainBaseUrl);
  const pairing = options.pairing;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://gateway.invalid");
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // Static PWA shell (no data, safe unauthenticated).
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(REMOTE_PWA_HTML);
      return;
    }
    if (method === "GET" && pathname === "/manifest.webmanifest") {
      res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8" });
      res.end(REMOTE_PWA_MANIFEST);
      return;
    }

    // Pairing: one-time code → per-device token. Registry enforces TTL/lockout/limits.
    if (method === "POST" && pathname === "/pair") {
      let parsed: Record<string, unknown>;
      try {
        const raw = await readBody(req, MAX_PAIR_BODY_BYTES);
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        sendError(res, 400, "bad_request", "Body must be a small JSON object.");
        return;
      }
      const code = typeof parsed["code"] === "string" ? parsed["code"] : "";
      const deviceName = typeof parsed["deviceName"] === "string" ? parsed["deviceName"] : undefined;
      const result = pairing.exchange(code, deviceName);
      if (!result.ok) {
        log(`remote-gateway: pairing refused (${result.reason})`);
        sendError(res, 401, "pairing_failed", result.reason);
        return;
      }
      log(`remote-gateway: device paired (${result.deviceId})`);
      sendJson(res, 200, { ok: true, data: { token: result.token, deviceId: result.deviceId } });
      return;
    }

    // Everything below requires a valid device token (fail closed).
    const presented = extractClientToken({
      authorization: req.headers.authorization,
      xCoworkToken: firstHeader(req.headers["x-cowork-token"]),
    });
    const device = pairing.verifyToken(presented);
    if (device === undefined) {
      sendError(res, presented === undefined ? 401 : 403, "unauthorized", "Valid device token required.");
      return;
    }

    if (method === "GET" && pathname === "/api/me") {
      sendJson(res, 200, { ok: true, data: { device } });
      return;
    }

    const target = method === "GET" ? resolveProxyTarget(pathname) : undefined;
    if (target === undefined) {
      sendError(res, 404, "not_found", "No such remote route.");
      return;
    }

    // Forward to the main loopback service with ITS token; pipe the response through
    // unchanged (works for JSON and for the long-lived SSE stream alike).
    const upstream = httpRequest(
      {
        host: main.hostname,
        port: main.port,
        method: "GET",
        path: target + url.search,
        headers: {
          authorization: `Bearer ${options.mainClientToken}`,
          accept: firstHeader(req.headers.accept) ?? "application/json",
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, {
          "content-type": proxyRes.headers["content-type"] ?? "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        proxyRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) sendError(res, 502, "upstream_unreachable", "Cowork service unreachable.");
      else res.end();
    });
    // A phone that disconnects mid-stream must tear down the upstream SSE subscription too.
    res.on("close", () => upstream.destroy());
    upstream.end();
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, "internal", "Gateway error.");
      else res.end();
    });
  });
  server.on("connection", (socket) => {
    // Loopback bind keeps the main-service peer guard; the LAN demo flag admits LAN peers.
    if (loopbackOnly && !isLoopbackAddress(socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: bindHost, port: bindPort }, () => {
      const info = server.address() as AddressInfo;
      const gateway: RemoteGateway = {
        host: bindHost,
        port: info.port,
        url: `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${info.port}`,
        issuePairingCode: () => pairing.issueCode(),
        stop: () =>
          new Promise<void>((resolveStop, rejectStop) => {
            server.close((err) => (err ? rejectStop(err) : resolveStop()));
            server.closeAllConnections?.();
          }),
      };
      log(`remote-gateway: listening on ${bindHost}:${info.port} (loopbackOnly=${loopbackOnly})`);
      resolve(gateway);
    });
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
