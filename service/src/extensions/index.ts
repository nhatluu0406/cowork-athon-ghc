/**
 * `@cowork-ghc/service` extensions module (CGHC-026) — a seam-based runtime-extension layer:
 * skill registry (RE1), MCP server lifecycle (RE2), workflow templates (RE4), and failure
 * isolation (RE5).
 *
 * Local barrel. All LIVE boundaries (skill execution, a live MCP process) are injectable seams
 * with HONEST not-attached defaults; the live implementations are Tier 2 (CGHC-028). {@link
 * createExtensionRegistry} wires all three registries onto ONE shared {@link ExtensionState}
 * (the single source of truth for status + diagnostics) so the composition root can expose them
 * without a router mount.
 */

import { createExtensionState, type ExtensionState } from "./extension-state.js";
import { createSkillRegistry, type SkillRegistry, type SkillRunner } from "./skill-registry.js";
import { createMcpRegistry, type McpAdapter, type McpRegistry } from "./mcp-registry.js";
import { createTemplateRegistry, type TemplateRegistry } from "./template-registry.js";
import type { TemplateStore } from "./template-store.js";
import type { ExtRedactor } from "./isolation.js";
import type { SsrfPolicy } from "../provider/index.js";
import type { ExtensionDiagnostic } from "./types.js";

export {
  createExtensionState,
  type ExtensionState,
  type ExtensionRecord,
  type ExtensionStateOptions,
} from "./extension-state.js";

export { runIsolated, runIsolatedSync, type ExtRedactor, type IsolateContext } from "./isolation.js";

// @deprecated Exploratory RE1 skill-execution seam. The ONE product Skill system is
// `service/src/skills/catalog.ts` (`SkillCatalog`) — see `skill-registry.ts` module docblock.
export {
  createSkillRegistry,
  type SkillRegistry,
  type SkillRegistryOptions,
  type SkillDefinition,
  type SkillRunner,
  type SkillRunOutcome,
  type SkillView,
} from "./skill-registry.js";
export { BUILTIN_SKILLS, notAttachedSkillRunner } from "./skills-builtin.js";

export {
  createMcpRegistry,
  type McpRegistry,
  type McpRegistryOptions,
  type McpAdapter,
  type McpServerConfig,
  type McpServerEntry,
  type McpConnection,
  type McpConnectionResult,
} from "./mcp-registry.js";
export { notAttachedMcpAdapter } from "./mcp-adapter.js";

export {
  createTemplateRegistry,
  type TemplateRegistry,
  type TemplateRegistryOptions,
  type WorkflowTemplate,
  type TemplateInputSpec,
  type TemplateStepSpec,
  type RunStep,
} from "./template-registry.js";
export { createInMemoryTemplateStore, type TemplateStore } from "./template-store.js";

export {
  type ExtensionKind,
  type ExtensionStatus,
  type ExtensionDiagnostic,
  type ExtensionError,
  type ExtensionErrorCode,
  type ExtOutcome,
  ok,
  err,
} from "./types.js";

/** The three wired registries over ONE shared extension state. */
export interface ExtensionRegistry {
  readonly state: ExtensionState;
  readonly skills: SkillRegistry;
  readonly mcp: McpRegistry;
  readonly templates: TemplateRegistry;
  /** All RE5 diagnostics across every extension kind (one source of truth). */
  diagnostics(): readonly ExtensionDiagnostic[];
}

export interface ExtensionRegistryOptions {
  readonly now?: () => string;
  /** Skill execution seam. Default: honest not-attached (reports `unavailable`). */
  readonly skillRunner?: SkillRunner;
  /** MCP host seam. Default: honest not-attached (reports `unavailable`). */
  readonly mcpAdapter?: McpAdapter;
  /** SSRF policy for URL MCP endpoints (mirrors the provider port). */
  readonly ssrf?: SsrfPolicy;
  /** Persistent template store. Default: in-memory. */
  readonly templateStore?: TemplateStore;
  /** RE5 redactor (composition injects the composed value-scrub-then-shape redactor). */
  readonly redact?: ExtRedactor;
}

/**
 * Wire the skill / MCP / template registries onto ONE {@link ExtensionState}. Every seam
 * defaults to its honest not-attached implementation, so this is safe to construct at Tier 1
 * without any live runtime, process, or network.
 *
 * NOTE: `.skills` here is the DEPRECATED exploratory RE1 registry (kept mounted only so this
 * type stays stable for existing callers/tests) — it is NOT the product Skills system. Product
 * Skill composition (discovery, enable/disable, OpenCode native-Skills launch wiring) goes
 * exclusively through `service/src/skills/catalog.ts` (`CoworkServiceDeps.skillCatalog`).
 */
export function createExtensionRegistry(
  options: ExtensionRegistryOptions = {},
): ExtensionRegistry {
  const state = createExtensionState(options.now ? { now: options.now } : {});
  const redact = options.redact;
  const common = redact ? { state, redact } : { state };

  const skills = createSkillRegistry({
    ...common,
    ...(options.skillRunner ? { runner: options.skillRunner } : {}),
  });
  const mcp = createMcpRegistry({
    ...common,
    ...(options.mcpAdapter ? { adapter: options.mcpAdapter } : {}),
    ...(options.ssrf ? { ssrf: options.ssrf } : {}),
  });
  const templates = createTemplateRegistry({
    ...common,
    ...(options.templateStore ? { store: options.templateStore } : {}),
  });

  return { state, skills, mcp, templates, diagnostics: () => state.diagnostics() };
}
