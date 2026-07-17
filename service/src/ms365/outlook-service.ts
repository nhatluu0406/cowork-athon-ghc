/**
 * OutlookService: read-only mail over Microsoft Graph /me/messages. Reuses
 * Ms365Connector.graph() exactly like SharePointService — no direct Graph/token/keyring
 * access. Model-supplied query goes ONLY into the $search value, never the URL path.
 */
import type { Ms365Connector } from "./ms365-connector.js";
import { Ms365Error } from "./ms365-errors.js";

const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_SUMMARY_BYTES = 65536; // 64 KiB, matching SharePoint summary.

export interface OutlookMessageHit {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  bodyPreview: string;
}

export interface OutlookService {
  searchMessages(query: string, limit?: number): Promise<OutlookMessageHit[]>;
  getMessage(id: string): Promise<OutlookMessageHit & { body: string }>;
  getMessageSummaryText(id: string): Promise<string>;
}

interface RawMessage {
  id?: unknown;
  subject?: unknown;
  from?: { emailAddress?: { address?: unknown } };
  receivedDateTime?: unknown;
  bodyPreview?: unknown;
  body?: { content?: unknown };
}
interface MessagesResponse {
  value?: RawMessage[];
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Maps a raw Graph message to a hit, or null when the required id/subject are missing. */
function toHit(raw: RawMessage): OutlookMessageHit | null {
  if (typeof raw?.id !== "string" || typeof raw?.subject !== "string") return null;
  return {
    id: raw.id,
    subject: raw.subject,
    from: str(raw.from?.emailAddress?.address),
    receivedDateTime: str(raw.receivedDateTime),
    bodyPreview: str(raw.bodyPreview),
  };
}

export function createOutlookService(deps: {
  connector: Ms365Connector;
  maxResults?: number;
  maxSummaryBytes?: number;
}): OutlookService {
  const maxResults = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxSummaryBytes = deps.maxSummaryBytes ?? DEFAULT_MAX_SUMMARY_BYTES;

  async function fetchMessage(id: string): Promise<RawMessage> {
    const graph = deps.connector.graph();
    return graph.json<RawMessage>({ method: "GET", path: `/me/messages/${encodeURIComponent(id)}` });
  }

  return {
    async searchMessages(query: string, limit?: number): Promise<OutlookMessageHit[]> {
      const cap = limit ?? maxResults;
      const graph = deps.connector.graph();
      const response = await graph.json<MessagesResponse>({
        method: "GET",
        path: "/me/messages",
        // Model query is the $search VALUE only (never the path). Escape any embedded double
        // quote so it cannot prematurely close the KQL quoted phrase and alter search semantics.
        query: { $search: `"${query.replace(/"/g, '\\"')}"`, $top: String(cap) },
      });
      const hits: OutlookMessageHit[] = [];
      for (const raw of asArray(response.value)) {
        const hit = toHit(raw);
        if (hit !== null) hits.push(hit);
        if (hits.length >= cap) break;
      }
      return hits;
    },

    async getMessage(id: string): Promise<OutlookMessageHit & { body: string }> {
      const raw = await fetchMessage(id);
      const hit = toHit(raw);
      if (hit === null) {
        // Throw the typed Ms365Error so handleToolCall maps it to a structured ok:false result
        // with a recovery action (a bare Error would surface as a generic boundary 500 instead).
        throw new Ms365Error(
          "graph_error",
          "Microsoft Graph message response missing id/subject.",
          "Thử lại; nếu tiếp diễn hãy kết nối lại Microsoft 365.",
          false,
        );
      }
      return { ...hit, body: str(raw.body?.content) };
    },

    async getMessageSummaryText(id: string): Promise<string> {
      const raw = await fetchMessage(id);
      const content = str(raw.body?.content);
      return content.length > maxSummaryBytes ? content.slice(0, maxSummaryBytes) : content;
    },
  };
}
