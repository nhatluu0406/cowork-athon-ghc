/**
 * SiteScopeService: lists the SharePoint sites the user follows (Graph /me/followedSites)
 * and merges each with the SiteScopeStore's enabled flag. Reuses Ms365Connector.graph()
 * exactly like SharePointService — no direct Graph/token/keyring access. New sites are
 * seeded ENABLED (opt-out model) via store.seenSite.
 */
import type { Ms365Connector } from "./ms365-connector.js";
import type { SiteScopeStore } from "./site-scope-store.js";

const DEFAULT_MAX_SITES = 100;

export interface JoinedSite {
  id: string;
  displayName: string;
  webUrl: string;
  enabled: boolean;
}

export interface SiteScopeService {
  listJoinedSites(): Promise<JoinedSite[]>;
  setSiteEnabled(siteId: string, enabled: boolean): Promise<void>;
  enabledSiteIds(): string[];
  isEnabled(siteId: string): boolean;
}

interface FollowedSite {
  id?: unknown;
  displayName?: unknown;
  webUrl?: unknown;
}
interface FollowedSitesResponse {
  value?: FollowedSite[];
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function createSiteScopeService(deps: {
  connector: Ms365Connector;
  store: SiteScopeStore;
  maxSites?: number;
}): SiteScopeService {
  const maxSites = deps.maxSites ?? DEFAULT_MAX_SITES;

  return {
    async listJoinedSites(): Promise<JoinedSite[]> {
      const graph = deps.connector.graph();
      const response = await graph.json<FollowedSitesResponse>({
        method: "GET",
        path: "/me/followedSites",
      });
      const out: JoinedSite[] = [];
      for (const raw of asArray(response.value)) {
        if (
          typeof raw?.id !== "string" ||
          typeof raw?.displayName !== "string" ||
          typeof raw?.webUrl !== "string"
        ) {
          continue;
        }
        const enabled = await deps.store.seenSite(raw.id);
        out.push({ id: raw.id, displayName: raw.displayName, webUrl: raw.webUrl, enabled });
        if (out.length >= maxSites) break;
      }
      return out;
    },
    async setSiteEnabled(siteId: string, enabled: boolean): Promise<void> {
      await deps.store.setEnabled(siteId, enabled);
    },
    enabledSiteIds(): string[] {
      return deps.store.enabledSiteIds();
    },
    isEnabled(siteId: string): boolean {
      return deps.store.isEnabled(siteId);
    },
  };
}
