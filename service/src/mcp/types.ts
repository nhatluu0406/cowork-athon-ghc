/**
 * MCP Phase 1 wire types + id validation (Wave 2B).
 *
 * `McpServerWireView` is the ONLY shape the HTTP boundary ever returns for an MCP server — it
 * never carries a header-secret value, only {@link McpServerWireView.hasHeaderSecret}.
 */

import type { ExtensionStatus } from "../extensions/index.js";
import type { McpConnection } from "../extensions/index.js";

/** Same account-name charset the credential layer accepts (`credentialAccountFor`'s `ACCOUNT_RE`). */
const MCP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export class InvalidMcpIdError extends Error {
  constructor(id: string) {
    super(`Invalid MCP server id: ${JSON.stringify(id)}.`);
    this.name = "InvalidMcpIdError";
  }
}

/** Validate a caller-supplied or generated MCP server id (lowercase, bounded, account-safe). */
export function assertValidMcpId(id: string): string {
  const trimmed = id.trim();
  if (!MCP_ID_PATTERN.test(trimmed)) throw new InvalidMcpIdError(id);
  return trimmed;
}

/** The ONE vault account an MCP server's header secret is stored under (never persisted in SQL). */
export function mcpHeaderSecretAccount(id: string): string {
  return `mcp:${id}:header`;
}

/** The secret-free view of one MCP server returned by every router route. */
export interface McpServerWireView {
  readonly id: string;
  readonly name: string;
  readonly command?: string;
  readonly url?: string;
  readonly enabled: boolean;
  readonly status: ExtensionStatus;
  readonly connection: McpConnection;
  /** True when a header secret is bound (vault account ref only — never the value). */
  readonly hasHeaderSecret: boolean;
  /**
   * Phase 1 always reports 0: there is no live MCP protocol client yet (see
   * `createProcessMcpAdapter`), only a command/URL reachability probe.
   */
  readonly toolCount: number;
  readonly updatedAt: string;
}
