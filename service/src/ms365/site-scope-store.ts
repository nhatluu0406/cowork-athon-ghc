/**
 * SiteScopeStore: one-source-of-truth for which SharePoint sites the AI may search.
 * A newly-seen site defaults to ENABLED (user opts OUT of sensitive sites). This holds
 * only site id + enabled bool — never a token — so it persists as a plain preference,
 * NOT in the keyring.
 */
export interface SiteEnabledRecord {
  siteId: string;
  enabled: boolean;
}

export interface SiteScopePersistence {
  load(): Promise<SiteEnabledRecord[]>;
  save(records: SiteEnabledRecord[]): Promise<void>;
}

export interface SiteScopeStore {
  /** Returns the enabled value, seeding an unknown site as ENABLED and persisting it. */
  seenSite(siteId: string): Promise<boolean>;
  setEnabled(siteId: string, enabled: boolean): Promise<void>;
  /** True for a disabled site only; an unknown site is treated as enabled (default). */
  isEnabled(siteId: string): boolean;
  enabledSiteIds(): string[];
}

export async function createSiteScopeStore(deps: {
  persistence: SiteScopePersistence;
}): Promise<SiteScopeStore> {
  const map = new Map<string, boolean>();
  for (const rec of await deps.persistence.load()) {
    map.set(rec.siteId, rec.enabled);
  }

  async function persist(): Promise<void> {
    const records: SiteEnabledRecord[] = Array.from(map.entries()).map(([siteId, enabled]) => ({
      siteId,
      enabled,
    }));
    await deps.persistence.save(records);
  }

  return {
    async seenSite(siteId: string): Promise<boolean> {
      if (!map.has(siteId)) {
        map.set(siteId, true);
        await persist();
      }
      return map.get(siteId) ?? true;
    },
    async setEnabled(siteId: string, enabled: boolean): Promise<void> {
      map.set(siteId, enabled);
      await persist();
    },
    isEnabled(siteId: string): boolean {
      return map.get(siteId) ?? true;
    },
    enabledSiteIds(): string[] {
      return Array.from(map.entries())
        .filter(([, enabled]) => enabled)
        .map(([siteId]) => siteId);
    },
  };
}
