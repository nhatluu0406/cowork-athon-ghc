/**
 * PowerAutomateStore: named list of configured flow trigger URLs (Settings-managed, not a
 * secret vault — a flow's HTTP-trigger URL is itself an unguessable bearer of authorization,
 * same trust class as a webhook URL, stored as plain JSON via the file persistence, never in
 * the vault). Each flow carries an enable toggle and a per-flow trigger timeout. Empty by
 * default; `trigger_flow` still works by direct URL with no configured entries.
 */
export interface PowerAutomateFlow {
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly description: string;
  readonly payloadSchema: string;
}

export const DEFAULT_FLOW_TIMEOUT_MS = 120_000;
export const MIN_FLOW_TIMEOUT_MS = 1_000;
export const MAX_FLOW_TIMEOUT_MS = 600_000;

export interface PowerAutomatePersistence {
  load(): Promise<readonly PowerAutomateFlow[] | null>;
  save(flows: readonly PowerAutomateFlow[]): Promise<void>;
}

export interface PowerAutomateStore {
  list(): readonly PowerAutomateFlow[];
  resolve(name: string): PowerAutomateFlow | null;
  add(flow: { name: string; url: string; description: string; timeoutMs: number; payloadSchema: string }): Promise<void>;
  update(name: string, fields: { description: string; timeoutMs: number; payloadSchema: string; url?: string }): Promise<void>;
  remove(name: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setTimeout(name: string, timeoutMs: number): Promise<void>;
  setFlows(flows: readonly PowerAutomateFlow[]): Promise<void>;
}

export function clampTimeout(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_FLOW_TIMEOUT_MS;
  if (n < MIN_FLOW_TIMEOUT_MS) return MIN_FLOW_TIMEOUT_MS;
  if (n > MAX_FLOW_TIMEOUT_MS) return MAX_FLOW_TIMEOUT_MS;
  return n;
}

function isFlow(value: unknown): value is { name: string; url: string; enabled?: unknown; timeoutMs?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.url === "string";
}

/** Fill defaults for legacy entries (missing enabled/timeoutMs) and clamp timeout. */
function normalize(raw: readonly PowerAutomateFlow[]): PowerAutomateFlow[] {
  return raw.filter(isFlow).map((f) => ({
    name: f.name,
    url: f.url,
    enabled: typeof (f as { enabled?: unknown }).enabled === "boolean" ? (f as { enabled: boolean }).enabled : true,
    timeoutMs: clampTimeout((f as { timeoutMs?: unknown }).timeoutMs),
    description: typeof (f as { description?: unknown }).description === "string" ? (f as { description: string }).description : "",
    payloadSchema: typeof (f as { payloadSchema?: unknown }).payloadSchema === "string" ? (f as { payloadSchema: string }).payloadSchema : "",
  }));
}

export async function createPowerAutomateStore(deps: {
  persistence: PowerAutomatePersistence;
}): Promise<PowerAutomateStore> {
  let current: PowerAutomateFlow[] = normalize((await deps.persistence.load()) ?? []);

  async function commit(next: PowerAutomateFlow[]): Promise<void> {
    current = next;
    await deps.persistence.save(current);
  }

  return {
    list: () => current,
    resolve: (name) => current.find((f) => f.name === name) ?? null,
    async add(flow) {
      if (current.some((f) => f.name === flow.name)) {
        throw new Error(`A flow named "${flow.name}" already exists.`);
      }
      await commit([...current, { name: flow.name, url: flow.url, enabled: true, timeoutMs: clampTimeout(flow.timeoutMs), description: flow.description, payloadSchema: flow.payloadSchema }]);
    },
    async update(name, fields) {
      if (!current.some((f) => f.name === name)) {
        throw new Error(`No flow named "${name}".`);
      }
      await commit(current.map((f) =>
        f.name === name
          ? { ...f, description: fields.description, timeoutMs: clampTimeout(fields.timeoutMs), payloadSchema: fields.payloadSchema, url: fields.url !== undefined && fields.url.length > 0 ? fields.url : f.url }
          : f,
      ));
    },
    async remove(name) {
      await commit(current.filter((f) => f.name !== name));
    },
    async setEnabled(name, enabled) {
      await commit(current.map((f) => (f.name === name ? { ...f, enabled } : f)));
    },
    async setTimeout(name, timeoutMs) {
      await commit(current.map((f) => (f.name === name ? { ...f, timeoutMs: clampTimeout(timeoutMs) } : f)));
    },
    async setFlows(flows) {
      await commit(normalize(flows));
    },
  };
}
