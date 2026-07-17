/**
 * WriteModeStore: one source of truth for the MS365 batch-write confirmation mode.
 * `manual` (default) = the batch tool refuses and the model falls back to per-item writes
 * (one permission card each); `auto` = one Allow covers the declared batch. This is a
 * user preference (never a secret) so it persists as a plain file, NOT in the keyring.
 */
export type Ms365WriteMode = "manual" | "auto";

export interface WriteModePersistence {
  load(): Promise<Ms365WriteMode | null>;
  save(mode: Ms365WriteMode): Promise<void>;
}

export interface WriteModeStore {
  mode(): Ms365WriteMode;
  setMode(mode: Ms365WriteMode): Promise<void>;
}

export async function createWriteModeStore(deps: {
  persistence: WriteModePersistence;
}): Promise<WriteModeStore> {
  let current: Ms365WriteMode = (await deps.persistence.load()) ?? "manual";
  return {
    mode: () => current,
    async setMode(mode: Ms365WriteMode): Promise<void> {
      current = mode;
      await deps.persistence.save(mode);
    },
  };
}
