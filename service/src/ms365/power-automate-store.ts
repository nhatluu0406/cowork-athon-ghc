/**
 * PowerAutomateStore: named list of configured flow trigger URLs. A flow's HTTP-trigger URL
 * embeds a SAS `sig` — a bearer SECRET — so it must NEVER be persisted to plaintext (the vault
 * invariant); the composition root backs this store with an in-memory persistence today (no
 * flow-configuration UI wires `setFlows`). `trigger_flow` works by direct URL regardless of the
 * configured list. When a flow-config surface is built, persist URLs in the vault (the
 * `mcp:<id>:header` pattern), never as plain JSON on disk.
 */
export interface PowerAutomateFlow {
  readonly name: string;
  readonly url: string;
}

export interface PowerAutomatePersistence {
  load(): Promise<readonly PowerAutomateFlow[] | null>;
  save(flows: readonly PowerAutomateFlow[]): Promise<void>;
}

export interface PowerAutomateStore {
  list(): readonly PowerAutomateFlow[];
  setFlows(flows: readonly PowerAutomateFlow[]): Promise<void>;
}

function isFlow(value: unknown): value is PowerAutomateFlow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.url === "string";
}

export async function createPowerAutomateStore(deps: {
  persistence: PowerAutomatePersistence;
}): Promise<PowerAutomateStore> {
  let current: readonly PowerAutomateFlow[] = (await deps.persistence.load()) ?? [];
  return {
    list: () => current,
    async setFlows(flows: readonly PowerAutomateFlow[]): Promise<void> {
      current = flows.filter(isFlow);
      await deps.persistence.save(current);
    },
  };
}
