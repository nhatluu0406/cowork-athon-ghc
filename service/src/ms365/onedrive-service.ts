/**
 * OneDriveService: READ-ONLY personal-drive search + folder listing over Microsoft Graph
 * (/me/drive). Distinct from SharePointService, which operates on site drives. No write tool
 * is registered for OneDrive — the read-only constraint is enforced at the design level (no
 * write method exists here), not just in the prompt.
 */
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 50;

export interface OneDriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  webUrl: string;
}

export interface OneDriveService {
  searchMyFiles(query: string): Promise<OneDriveItem[]>;
  listMyFolder(itemId?: string): Promise<OneDriveItem[]>;
}

interface RawItem {
  id?: unknown;
  name?: unknown;
  webUrl?: unknown;
  folder?: unknown;
}
interface ItemsResponse {
  value?: RawItem[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function toItem(raw: RawItem): OneDriveItem | null {
  if (typeof raw?.id !== "string" || typeof raw?.name !== "string") return null;
  return { id: raw.id, name: raw.name, isFolder: raw.folder !== undefined, webUrl: str(raw.webUrl) };
}

/** Escape a string for use inside a Graph search(q='...') literal (single quote → doubled). */
function odataEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function createOneDriveService(deps: { connector: Ms365Connector; maxResults?: number }): OneDriveService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const graph = () => deps.connector.graph();

  return {
    async searchMyFiles(query: string) {
      const q = odataEscape(query);
      const response = await graph().json<ItemsResponse>({
        method: "GET",
        path: `/me/drive/root/search(q='${q}')`,
        query: { $top: String(cap) },
      });
      const out: OneDriveItem[] = [];
      for (const raw of asArray(response.value)) {
        const item = toItem(raw);
        if (item !== null) out.push(item);
        if (out.length >= cap) break;
      }
      return out;
    },

    async listMyFolder(itemId?: string) {
      const path =
        itemId !== undefined && itemId.length > 0
          ? `/me/drive/items/${encodeURIComponent(itemId)}/children`
          : "/me/drive/root/children";
      const response = await graph().json<ItemsResponse>({ method: "GET", path, query: { $top: String(cap) } });
      const out: OneDriveItem[] = [];
      for (const raw of asArray(response.value)) {
        const item = toItem(raw);
        if (item !== null) out.push(item);
        if (out.length >= cap) break;
      }
      return out;
    },
  };
}
