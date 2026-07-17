/**
 * CommonService: cross-cutting Graph reads shared by every MS365 tool group —
 * resolve a person by name/email to a user-id (needed before mention/assign/invite), and read
 * the connected account's own identity. Both read-only; reuses Ms365Connector.graph() exactly
 * like every other MS365 service.
 */
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 10;

export interface ResolvedUser {
  id: string;
  displayName: string;
  mail: string;
}

export interface Me {
  displayName: string;
  mail: string;
  timeZone: string;
}

export interface CommonService {
  resolveUser(query: string): Promise<ResolvedUser[]>;
  getMe(): Promise<Me>;
}

interface RawUser {
  id?: unknown;
  displayName?: unknown;
  mail?: unknown;
}
interface UsersResponse {
  value?: RawUser[];
}
interface RawMe {
  displayName?: unknown;
  mail?: unknown;
  userPrincipalName?: unknown;
}
interface RawMailboxSettings {
  timeZone?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Escape a string for use inside an OData literal (single quote → doubled). */
function odataEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function createCommonService(deps: { connector: Ms365Connector; maxResults?: number }): CommonService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;

  return {
    async resolveUser(query: string): Promise<ResolvedUser[]> {
      const graph = deps.connector.graph();
      const q = odataEscape(query);
      const response = await graph.json<UsersResponse>({
        method: "GET",
        path: "/users",
        query: {
          $filter: `startswith(displayName,'${q}') or startswith(mail,'${q}')`,
          $select: "id,displayName,mail",
          $top: String(cap),
        },
      });
      const out: ResolvedUser[] = [];
      for (const raw of asArray(response.value)) {
        if (typeof raw?.id !== "string" || typeof raw?.displayName !== "string") continue;
        out.push({ id: raw.id, displayName: raw.displayName, mail: str(raw.mail) });
        if (out.length >= cap) break;
      }
      return out;
    },

    async getMe(): Promise<Me> {
      const graph = deps.connector.graph();
      const me = await graph.json<RawMe>({ method: "GET", path: "/me" });
      let timeZone = "";
      try {
        const settings = await graph.json<RawMailboxSettings>({ method: "GET", path: "/me/mailboxSettings" });
        timeZone = str(settings.timeZone);
      } catch {
        timeZone = ""; // best-effort; never fail getMe over mailbox settings
      }
      return {
        displayName: str(me.displayName),
        mail: str(me.mail) || str(me.userPrincipalName),
        timeZone,
      };
    },
  };
}
