/**
 * PowerAutomateStore: named list of configured flow trigger URLs (Settings-managed, not a
 * secret — a flow's HTTP-trigger URL is itself an unguessable bearer of authorization, same
 * trust class as a webhook URL, so it is stored as plain JSON like WriteModeStore/SiteScopeStore,
 * never in the vault). Empty by default; `trigger_flow` still works by direct URL with no
 * configured entries.
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
