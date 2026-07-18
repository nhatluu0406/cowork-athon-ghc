/**
 * ListsService: Microsoft Lists CRUD over Graph. Lists live inside SharePoint sites, so the
 * P0.5 site allowlist gates EVERY method (read and write) fail-closed BEFORE any Graph call.
 * Model text: $filter only as a query-param value; item fields only in the JSON body.
 */
import type { Ms365Connector } from "./ms365-connector.js";
import { Ms365Error } from "./ms365-errors.js";

const DEFAULT_MAX_RESULTS = 50;

export interface ListInfo { id: string; displayName: string }
export interface ListItem { id: string; fields: Record<string, unknown> }
export interface ListsService {
  getLists(siteId: string): Promise<ListInfo[]>;
  getItems(siteId: string, listId: string, filter?: string): Promise<ListItem[]>;
  addItem(input: { siteId: string; listId: string; fields: Record<string, unknown> }): Promise<ListItem>;
  editItem(input: { siteId: string; listId: string; itemId: string; fields: Record<string, unknown> }): Promise<void>;
  deleteItem(input: { siteId: string; listId: string; itemId: string }): Promise<void>;
}

interface RawList { id?: unknown; displayName?: unknown }
interface RawItem { id?: unknown; fields?: unknown }
interface ListResponse<T> { value?: T[] }

function asArray<T>(v: T[] | undefined): T[] { return Array.isArray(v) ? v : []; }
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function toItem(raw: RawItem): ListItem | null {
  if (typeof raw?.id !== "string") return null;
  return { id: raw.id, fields: isPlainObject(raw.fields) ? raw.fields : {} };
}

export function createListsService(deps: {
  connector: Ms365Connector;
  siteFilter?: { isEnabled(siteId: string): boolean };
  maxResults?: number;
}): ListsService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const graph = () => deps.connector.graph();

  /** Fail-closed site gate: throws BEFORE any Graph call when the site is disabled. */
  function assertSiteEnabled(siteId: string): void {
    if (deps.siteFilter !== undefined && !deps.siteFilter.isEnabled(siteId)) {
      throw new Ms365Error(
        "endpoint_blocked",
        "Site này đã bị tắt tìm kiếm trong cài đặt.",
        "Bật lại site trong cài đặt Microsoft 365 nếu muốn thao tác trên site này.",
        false,
      );
    }
  }
  const base = (siteId: string, listId: string) =>
    `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}`;

  return {
    async getLists(siteId) {
      assertSiteEnabled(siteId);
      const res = await graph().json<ListResponse<RawList>>({
        method: "GET", path: `/sites/${encodeURIComponent(siteId)}/lists`,
      });
      const out: ListInfo[] = [];
      for (const raw of asArray(res.value)) {
        if (typeof raw?.id !== "string" || typeof raw?.displayName !== "string") continue;
        out.push({ id: raw.id, displayName: raw.displayName });
        if (out.length >= cap) break;
      }
      return out;
    },
    async getItems(siteId, listId, filter) {
      assertSiteEnabled(siteId);
      const query: Record<string, string> = { "$expand": "fields", $top: String(cap) };
      if (filter !== undefined) query.$filter = filter;
      const res = await graph().json<ListResponse<RawItem>>({
        method: "GET", path: `${base(siteId, listId)}/items`, query,
        ...(filter !== undefined ? { prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" } : {}),
      });
      const out: ListItem[] = [];
      for (const raw of asArray(res.value)) {
        const it = toItem(raw);
        if (it !== null) out.push(it);
        if (out.length >= cap) break;
      }
      return out;
    },
    async addItem(input) {
      assertSiteEnabled(input.siteId);
      const raw = await graph().json<RawItem>({
        method: "POST", path: `${base(input.siteId, input.listId)}/items`,
        body: { fields: input.fields },
      });
      const it = toItem(raw);
      if (it === null) {
        throw new Ms365Error("graph_error", "Lists create response missing id.",
          "Thử lại; nếu tiếp diễn hãy kết nối lại Microsoft 365.", false);
      }
      return it;
    },
    async editItem(input) {
      assertSiteEnabled(input.siteId);
      await graph().noContent({
        method: "PATCH", path: `${base(input.siteId, input.listId)}/items/${encodeURIComponent(input.itemId)}/fields`,
        body: input.fields,
      });
    },
    async deleteItem(input) {
      assertSiteEnabled(input.siteId);
      await graph().noContent({
        method: "DELETE", path: `${base(input.siteId, input.listId)}/items/${encodeURIComponent(input.itemId)}`,
      });
    },
  };
}
