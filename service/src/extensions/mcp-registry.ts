/**
 * MCP server lifecycle (CGHC-026 RE2) — add / enable / disable / remove an MCP server entry
 * CLEANLY, tracked in ONE state map. Every transition goes through the injectable {@link
 * McpAdapter} seam (connect/disconnect/health); the honest default reports `unavailable` and
 * never fabricates a live connection.
 *
 * Lifecycle rules:
 *  - add: register a new entry (`disabled`, `disconnected`). Re-adding an existing id is an
 *    honest `duplicate_extension` error (never clobbers a live entry).
 *  - enable: connect through the adapter (isolated). Success → `enabled` + the adapter's honest
 *    connection state (`connected` or `unavailable`). A connect REJECTION → diagnostic +
 *    quarantine (RE5), the registry stays alive.
 *  - disable: disconnect through the adapter, `disabled` + `disconnected`.
 *  - remove: disconnect FIRST (if live), then drop the entry from the one source of truth.
 *
 * A URL endpoint is SSRF-validated (mirrors the provider port discipline) before it is
 * persisted — an unvalidated remote endpoint is refused, never stored.
 */

import type { SsrfPolicy } from "../provider/index.js";
import { SsrfBlockedError } from "../provider/index.js";
import { createExtensionState, type ExtensionState } from "./extension-state.js";
import { notAttachedMcpAdapter } from "./mcp-adapter.js";
import { runIsolated, type ExtRedactor } from "./isolation.js";
import type { ExtensionDiagnostic, ExtensionError, ExtensionStatus, ExtOutcome } from "./types.js";
import { err, ok } from "./types.js";

/** Live connection state of an MCP entry (distinct from the enable/disable/failed status). */
export type McpConnection = "connected" | "unavailable" | "disconnected";

/** The result an {@link McpAdapter} returns from a connect/health call. */
export type McpConnectionResult =
  | { readonly status: "connected"; readonly detail?: string }
  | { readonly status: "unavailable"; readonly detail: string };

/**
 * A Cowork-GHC MCP server config. Exactly one transport: a local `command` OR a remote `url`.
 * A `url` is SSRF-validated before persistence (no unvalidated remote endpoint).
 */
export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  /** Local stdio server command (no network). Mutually exclusive with {@link url}. */
  readonly command?: string;
  /** Remote endpoint URL. SSRF-validated at add time. Mutually exclusive with {@link command}. */
  readonly url?: string;
}

/** The public view of one MCP entry: its config + status (one source of truth) + connection. */
export interface McpServerEntry {
  readonly config: McpServerConfig;
  readonly status: ExtensionStatus;
  readonly connection: McpConnection;
}

/**
 * The injectable MCP host seam. A real implementation drives a live MCP process via OpenCode
 * (Tier 2 / CGHC-028); tests inject a fake. `connect`/`health` may resolve `unavailable`
 * (honest) or REJECT (a genuine failure — captured by RE5 isolation).
 */
export interface McpAdapter {
  connect(config: McpServerConfig): Promise<McpConnectionResult>;
  disconnect(id: string): Promise<void>;
  health(id: string): Promise<McpConnectionResult>;
}

export interface McpRegistryOptions {
  readonly state?: ExtensionState;
  /** MCP host seam. Default: the honest not-attached adapter. */
  readonly adapter?: McpAdapter;
  /** SSRF policy for URL endpoints (mirrors the provider port). Required to add a URL server. */
  readonly ssrf?: SsrfPolicy;
  readonly redact?: ExtRedactor;
}

export interface McpRegistry {
  list(): readonly McpServerEntry[];
  get(id: string): McpServerEntry | undefined;
  add(config: McpServerConfig): Promise<ExtOutcome<McpServerEntry>>;
  enable(id: string): Promise<ExtOutcome<McpServerEntry>>;
  disable(id: string): Promise<ExtOutcome<McpServerEntry>>;
  remove(id: string): Promise<ExtOutcome<true>>;
  health(id: string): Promise<ExtOutcome<McpConnection>>;
  diagnostics(): readonly ExtensionDiagnostic[];
}

interface Entry {
  config: McpServerConfig;
  connection: McpConnection;
}

export function createMcpRegistry(options: McpRegistryOptions = {}): McpRegistry {
  const state = options.state ?? createExtensionState();
  const adapter = options.adapter ?? notAttachedMcpAdapter();
  const redact = options.redact;
  const entries = new Map<string, Entry>();

  function ctx(id: string, name: string) {
    return { state, kind: "mcp" as const, id, name, ...(redact ? { redact } : {}) };
  }

  function viewOf(id: string): McpServerEntry | undefined {
    const entry = entries.get(id);
    if (entry === undefined) return undefined;
    return {
      config: entry.config,
      status: state.status("mcp", id) ?? "disabled",
      connection: entry.connection,
    };
  }

  /** Validate a config: exactly one transport; a URL passes the SSRF policy before persistence. */
  async function validate(config: McpServerConfig): Promise<ExtensionError | undefined> {
    const hasCommand = typeof config.command === "string" && config.command.length > 0;
    const hasUrl = typeof config.url === "string" && config.url.length > 0;
    if (hasCommand === hasUrl) {
      return { code: "invalid_input", message: "An MCP server needs exactly one of command | url." };
    }
    if (hasUrl) {
      if (options.ssrf === undefined) {
        return {
          code: "endpoint_blocked",
          message: "A URL MCP endpoint requires an SSRF policy; refusing to persist it unvalidated.",
        };
      }
      try {
        await options.ssrf.assertAllowed(config.url as string);
      } catch (error) {
        const detail = error instanceof SsrfBlockedError ? error.reason : "refused";
        return { code: "endpoint_blocked", message: `MCP endpoint refused by SSRF policy (${detail}).` };
      }
    }
    return undefined;
  }

  return {
    list: () => [...entries.keys()].map((id) => viewOf(id) as McpServerEntry),
    get: (id) => viewOf(id),

    async add(config) {
      if (entries.has(config.id)) {
        return err("duplicate_extension", `MCP server "${config.id}" already exists.`);
      }
      const invalid = await validate(config);
      if (invalid !== undefined) return { ok: false, error: invalid };
      entries.set(config.id, { config, connection: "disconnected" });
      state.register("mcp", config.id, config.name, "disabled");
      return ok(viewOf(config.id) as McpServerEntry);
    },

    async enable(id) {
      const entry = entries.get(id);
      if (entry === undefined) return err("unknown_extension", `Unknown MCP server "${id}".`);
      if (state.isQuarantined("mcp", id)) {
        return err("quarantined", `MCP server "${id}" is quarantined after a failure; not re-enabling.`);
      }
      const outcome = await runIsolated<McpConnectionResult>(
        ctx(id, entry.config.name),
        () => adapter.connect(entry.config),
      );
      if (!outcome.ok) {
        entry.connection = "disconnected";
        return outcome; // RE5: connect threw → quarantined + typed error, registry stays alive.
      }
      // Honest: intent is enabled; the connection reflects the adapter's real answer (never faked).
      entry.connection = outcome.value.status === "connected" ? "connected" : "unavailable";
      state.setStatus("mcp", id, "enabled");
      return ok(viewOf(id) as McpServerEntry);
    },

    async disable(id) {
      const entry = entries.get(id);
      if (entry === undefined) return err("unknown_extension", `Unknown MCP server "${id}".`);
      if (state.isQuarantined("mcp", id)) {
        // Sticky quarantine: refuse to overwrite `failed` with `disabled` (RE5). The ONLY
        // intended un-quarantine route for an MCP entry is remove() + re-add().
        return err(
          "quarantined",
          `MCP server "${id}" is quarantined after a failure; refusing to disable. Remove and re-add it to un-quarantine.`,
        );
      }
      const outcome = await runIsolated<void>(ctx(id, entry.config.name), () => adapter.disconnect(id));
      if (!outcome.ok) return outcome;
      entry.connection = "disconnected";
      state.setStatus("mcp", id, "disabled");
      return ok(viewOf(id) as McpServerEntry);
    },

    async remove(id) {
      const entry = entries.get(id);
      if (entry === undefined) return err("unknown_extension", `Unknown MCP server "${id}".`);
      // Best-effort disconnect of a live host FIRST (isolated → a rejecting disconnect becomes a
      // recorded diagnostic, never a throw). Then ALWAYS drop the entry from BOTH the entry map
      // and the one source of truth, so a permanently-rejecting disconnect can never orphan a
      // stuck, untrackable entry (FIX-2). Removal is the honest outcome even if disconnect failed.
      if (entry.connection === "connected") {
        await runIsolated<void>(ctx(id, entry.config.name), () => adapter.disconnect(id));
      }
      entries.delete(id);
      state.remove("mcp", id);
      return ok(true as const);
    },

    async health(id) {
      const entry = entries.get(id);
      if (entry === undefined) return err("unknown_extension", `Unknown MCP server "${id}".`);
      const outcome = await runIsolated<McpConnectionResult>(
        ctx(id, entry.config.name),
        () => adapter.health(id),
      );
      if (!outcome.ok) return outcome;
      return ok(outcome.value.status === "connected" ? "connected" : "unavailable");
    },

    diagnostics: () => state.diagnostics().filter((d) => d.kind === "mcp"),
  };
}
