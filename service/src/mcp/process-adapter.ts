/**
 * Phase 1 MCP adapter (Wave 2B, CGHC-028 follow-on) — an HONEST reachability probe, not a full
 * MCP protocol client.
 *
 * `connect`/`health` never fabricate a live session: a local `command` is reported `connected`
 * only when it resolves on `PATH` (or is an existing absolute path); a remote `url` is reported
 * `connected` only after it passes the SAME {@link SsrfPolicy} the provider port uses AND answers
 * a `HEAD` request without a server error. Neither path performs an MCP handshake or lists tools
 * yet — {@link McpServerWireView.toolCount} stays `0` until a real protocol client lands.
 */

import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import type { SsrfPolicy } from "../provider/index.js";
import type { McpAdapter, McpConnectionResult, McpServerConfig } from "../extensions/index.js";

const DEFAULT_PATHEXT = [".EXE", ".CMD", ".BAT", ".COM"];

/** Hard bound on the reachability HEAD probe so an unresponsive endpoint cannot hang it. */
const PROBE_TIMEOUT_MS = 5_000;

/** Best-effort local command lookup: absolute path existence, else a `PATH`/`PATHEXT` scan. */
function defaultCommandExists(command: string): boolean {
  const head = command.trim().split(/\s+/u)[0] ?? "";
  if (head.length === 0) return false;
  if (isAbsolute(head)) return existsSync(head);

  const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
  const pathExt = (process.env["PATHEXT"] ?? DEFAULT_PATHEXT.join(";"))
    .split(";")
    .filter((ext) => ext.length > 0);
  const candidates = extname(head).length > 0 ? [head] : [head, ...pathExt.map((ext) => `${head}${ext}`)];

  for (const dir of pathEnv.split(delimiter)) {
    if (dir.trim().length === 0) continue;
    for (const candidate of candidates) {
      if (existsSync(join(dir, candidate))) return true;
    }
  }
  return false;
}

export interface ProcessMcpAdapterOptions {
  /** SAME SSRF policy the provider port uses — a URL server is never probed unvalidated. */
  readonly ssrf: SsrfPolicy;
  /** Injectable fetch (default: global `fetch`). Tests inject a fake to avoid a real network call. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable command-existence probe (default: PATH/PATHEXT scan). Tests inject a fake. */
  readonly commandExists?: (command: string) => boolean;
}

/** Build the Phase 1 reachability-probe {@link McpAdapter}. */
export function createProcessMcpAdapter(options: ProcessMcpAdapterOptions): McpAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const commandExists = options.commandExists ?? defaultCommandExists;
  // health(id) is not handed the config by the registry contract, so this adapter tracks the
  // last-connected config per id itself (cleared on disconnect) to re-probe on a health call.
  const configs = new Map<string, McpServerConfig>();

  async function probe(config: McpServerConfig): Promise<McpConnectionResult> {
    if (config.command !== undefined) {
      return commandExists(config.command)
        ? {
            status: "connected",
            detail: "Command resolved (spawn/MCP handshake not yet verified — Phase 1 probe only).",
          }
        : { status: "unavailable", detail: "Command not found on PATH or as an absolute path." };
    }
    if (config.url !== undefined) {
      try {
        await options.ssrf.assertAllowed(config.url);
      } catch {
        return { status: "unavailable", detail: "Endpoint refused by the SSRF policy." };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetchImpl(config.url, { method: "HEAD", signal: controller.signal });
        return res.status < 500
          ? {
              status: "connected",
              detail: `HTTP ${res.status} on HEAD (MCP handshake not yet verified — Phase 1 probe only).`,
            }
          : { status: "unavailable", detail: `Endpoint responded HTTP ${res.status}.` };
      } catch {
        return { status: "unavailable", detail: "HEAD request to the endpoint failed or timed out." };
      } finally {
        clearTimeout(timer);
      }
    }
    return { status: "unavailable", detail: "No transport configured." };
  }

  return {
    async connect(config) {
      configs.set(config.id, config);
      return probe(config);
    },
    async disconnect(id) {
      configs.delete(id);
    },
    async health(id) {
      const config = configs.get(id);
      if (config === undefined) {
        return { status: "unavailable", detail: "Not connected; enable the server before checking health." };
      }
      return probe(config);
    },
  };
}
