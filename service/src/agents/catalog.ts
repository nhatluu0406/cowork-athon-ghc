/**
 * Agent catalog (agent-harness-plan.md Task 5.1) — built-in read-only agents + user CRUD.
 *
 * Mirrors the Skills model: built-ins are always present and cannot be edited/deleted; user
 * agents persist as a single JSON document through an injectable {@link AgentStoreFs} seam (no
 * disk in tests). Every write is validated against the LIVE session policy so a stored agent can
 * only ever NARROW tool permissions, never loosen them. Definitions are secret-free by shape.
 */

import {
  validateAgentDefinition,
  type AgentDefinition,
} from "@cowork-ghc/contracts";
import { BUILTIN_AGENTS } from "./builtins.js";

/** Injectable persistence seam for the user-agents JSON document. */
export interface AgentStoreFs {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export interface AgentCatalogOptions {
  readonly fs: AgentStoreFs;
  /** The live session tool policy user agents must not loosen. */
  readonly basePolicy: Readonly<Record<string, string>>;
}

/** A draft the CRUD router hands in (id optional on create; derived from name if absent). */
export interface AgentDraft {
  readonly id?: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly skillIds?: readonly string[];
  readonly permissionPreset?: Readonly<Record<string, string>>;
  readonly model?: { readonly providerID: string; readonly modelID: string };
}

export interface AgentCatalog {
  /** Every agent (built-ins first, then user agents), read-only view. */
  list(): readonly AgentDefinition[];
  get(id: string): AgentDefinition | undefined;
  /** The set of all known agent ids (for TaskDefinition reference validation). */
  knownIds(): ReadonlySet<string>;
  createUserAgent(draft: AgentDraft): Promise<AgentDefinition>;
  updateUserAgent(id: string, draft: AgentDraft): Promise<AgentDefinition>;
  deleteUserAgent(id: string): Promise<void>;
}

export class AgentCatalogError extends Error {
  readonly code = "agent_invalid";
  constructor(message: string) {
    super(message);
    this.name = "AgentCatalogError";
  }
}

interface StoredDoc {
  readonly version: 1;
  readonly agents: readonly AgentDefinition[];
}

function suggestId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return slug.length >= 2 ? slug : "agent";
}

const BUILTIN_IDS = new Set(BUILTIN_AGENTS.map((a) => a.id));

export async function createAgentCatalog(options: AgentCatalogOptions): Promise<AgentCatalog> {
  const { fs, basePolicy } = options;
  // Validate built-ins once at boot so a shipped preset that accidentally loosens the policy
  // fails loudly here rather than silently granting extra permission at dispatch.
  for (const agent of BUILTIN_AGENTS) {
    const check = validateAgentDefinition(agent, basePolicy);
    if (!check.ok) throw new AgentCatalogError(`built-in agent "${agent.id}" invalid: ${check.error}`);
  }

  const userAgents = new Map<string, AgentDefinition>();
  await load();

  async function load(): Promise<void> {
    const raw = await fs.read();
    if (raw === undefined || raw.trim().length === 0) return;
    let doc: StoredDoc;
    try {
      doc = JSON.parse(raw) as StoredDoc;
    } catch {
      // A corrupt store is treated as empty rather than crashing the service; user re-creates.
      return;
    }
    if (!Array.isArray(doc.agents)) return;
    for (const candidate of doc.agents) {
      const check = validateAgentDefinition({ ...candidate, source: "user_local" }, basePolicy);
      if (check.ok && !BUILTIN_IDS.has(check.value.id)) userAgents.set(check.value.id, check.value);
    }
  }

  async function persist(): Promise<void> {
    const doc: StoredDoc = { version: 1, agents: [...userAgents.values()] };
    await fs.write(`${JSON.stringify(doc, null, 2)}\n`);
  }

  function all(): readonly AgentDefinition[] {
    return [...BUILTIN_AGENTS, ...userAgents.values()];
  }

  function validate(draft: AgentDraft, id: string): AgentDefinition {
    const check = validateAgentDefinition(
      {
        id,
        name: draft.name,
        source: "user_local",
        systemPrompt: draft.systemPrompt,
        skillIds: draft.skillIds ?? [],
        permissionPreset: draft.permissionPreset ?? {},
        ...(draft.model !== undefined ? { model: draft.model } : {}),
      },
      basePolicy,
    );
    if (!check.ok) throw new AgentCatalogError(check.error);
    return check.value;
  }

  return {
    list: all,
    get: (id) => all().find((a) => a.id === id),
    knownIds: () => new Set(all().map((a) => a.id)),

    async createUserAgent(draft) {
      const id = draft.id?.trim() || suggestId(draft.name);
      if (BUILTIN_IDS.has(id)) throw new AgentCatalogError(`"${id}" is a built-in agent id.`);
      if (userAgents.has(id)) throw new AgentCatalogError(`agent "${id}" already exists.`);
      const agent = validate(draft, id);
      userAgents.set(id, agent);
      await persist();
      return agent;
    },

    async updateUserAgent(id, draft) {
      if (BUILTIN_IDS.has(id)) throw new AgentCatalogError("built-in agents are read-only.");
      if (!userAgents.has(id)) throw new AgentCatalogError(`agent "${id}" not found.`);
      const agent = validate(draft, id);
      userAgents.set(id, agent);
      await persist();
      return agent;
    },

    async deleteUserAgent(id) {
      if (BUILTIN_IDS.has(id)) throw new AgentCatalogError("built-in agents are read-only.");
      if (!userAgents.delete(id)) throw new AgentCatalogError(`agent "${id}" not found.`);
      await persist();
    },
  };
}
