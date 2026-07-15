/**
 * TeamsService: Teams chats/channels messaging over Graph. Reads are recent-N (Graph v1.0 has
 * NO $search on chat/channel messages — the model filters client-side; honest, not faked).
 * postMessage builds the html body itself: model text is FULLY HTML-escaped, then @{i}
 * placeholders become <at id="i"> tags — the model never writes raw HTML into Teams.
 */
import type { Ms365Connector } from "./ms365-connector.js";
import { Ms365Error } from "./ms365-errors.js";

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_TEXT_CHARS = 4096;

export interface TeamsChat { id: string; topic: string; memberNames: string[] }
export interface TeamsTeam { id: string; displayName: string }
export interface TeamsChannel { id: string; displayName: string }
export interface TeamsMember { userId: string; displayName: string }
export interface TeamsMessage { id: string; from: string; createdDateTime: string; text: string }
export type MessageTarget = { chatId: string } | { teamId: string; channelId: string };

export interface TeamsService {
  listChats(): Promise<TeamsChat[]>;
  listTeams(): Promise<TeamsTeam[]>;
  listChannels(teamId: string): Promise<TeamsChannel[]>;
  listMembers(target: { chatId: string } | { teamId: string }): Promise<TeamsMember[]>;
  getMessages(target: MessageTarget): Promise<TeamsMessage[]>;
  postMessage(input: {
    target: MessageTarget;
    content: string;
    mentions?: Array<{ userId: string; displayName: string }>;
  }): Promise<{ id: string }>;
}

interface RawChat { id?: unknown; topic?: unknown; members?: unknown }
interface RawMember { displayName?: unknown; userId?: unknown }
interface RawTeam { id?: unknown; displayName?: unknown }
interface RawChannel { id?: unknown; displayName?: unknown }
interface RawMessageFrom { user?: { displayName?: unknown } }
interface RawMessage {
  id?: unknown; from?: RawMessageFrom; createdDateTime?: unknown; body?: { content?: unknown };
}
interface ListResponse<T> { value?: T[] }

function asArray<T>(v: T[] | undefined): T[] { return Array.isArray(v) ? v : []; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Pure: escape + placeholder substitution + Graph mentions shape. Exported for direct tests. */
export function buildTeamsBody(
  content: string,
  mentions: Array<{ userId: string; displayName: string }>,
): {
  body: { contentType: "html"; content: string };
  mentions: Array<{ id: number; mentionText: string; mentioned: { user: { id: string; displayName: string } } }>;
} {
  const escaped = esc(content);
  const used = new Set<number>();
  const html = escaped.replace(/@\{(\d+)\}/g, (_m, idx: string) => {
    const i = Number(idx);
    const mention = mentions[i];
    if (mention === undefined) {
      throw new Ms365Error("graph_error", `Mention placeholder @{${idx}} has no matching mention.`,
        "Bổ sung mentions tương ứng với placeholder rồi thử lại.", false);
    }
    used.add(i);
    return `<at id="${i}">${esc(mention.displayName)}</at>`;
  });
  return {
    body: { contentType: "html" as const, content: html },
    mentions: mentions
      .map((m, i) => ({ id: i, mentionText: m.displayName, mentioned: { user: { id: m.userId, displayName: m.displayName } } }))
      .filter((m) => used.has(m.id)),
  };
}

function memberNamesOf(members: unknown): string[] {
  const out: string[] = [];
  for (const m of asArray(members as RawMember[] | undefined)) {
    if (typeof m?.displayName === "string") out.push(m.displayName);
  }
  return out;
}

function toChat(raw: RawChat): TeamsChat | null {
  if (typeof raw?.id !== "string") return null;
  return {
    id: raw.id,
    topic: typeof raw.topic === "string" ? raw.topic : "",
    memberNames: Array.isArray(raw.members) ? memberNamesOf(raw.members) : [],
  };
}

function toMember(raw: RawMember): TeamsMember | null {
  if (typeof raw?.userId !== "string" || typeof raw?.displayName !== "string") return null;
  return { userId: raw.userId, displayName: raw.displayName };
}

function toMessage(raw: RawMessage, maxTextChars: number): TeamsMessage | null {
  if (typeof raw?.id !== "string") return null;
  const from = typeof raw.from?.user?.displayName === "string" ? raw.from.user.displayName : "";
  const text = typeof raw.body?.content === "string" ? raw.body.content.slice(0, maxTextChars) : "";
  return { id: raw.id, from, createdDateTime: str(raw.createdDateTime), text };
}

function messagesPath(target: MessageTarget): string {
  if ("chatId" in target) {
    return `/chats/${encodeURIComponent(target.chatId)}/messages`;
  }
  return `/teams/${encodeURIComponent(target.teamId)}/channels/${encodeURIComponent(target.channelId)}/messages`;
}

export function createTeamsService(deps: {
  connector: Ms365Connector;
  maxResults?: number;
  maxTextChars?: number;
}): TeamsService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxTextChars = deps.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const graph = () => deps.connector.graph();

  return {
    async listChats() {
      const res = await graph().json<ListResponse<RawChat>>({
        method: "GET", path: "/me/chats", query: { "$expand": "members", "$top": String(cap) },
      });
      const out: TeamsChat[] = [];
      for (const raw of asArray(res.value)) {
        const c = toChat(raw);
        if (c !== null) out.push(c);
        if (out.length >= cap) break;
      }
      return out;
    },

    async listTeams() {
      const res = await graph().json<ListResponse<RawTeam>>({ method: "GET", path: "/me/joinedTeams" });
      const out: TeamsTeam[] = [];
      for (const raw of asArray(res.value)) {
        if (typeof raw?.id !== "string" || typeof raw?.displayName !== "string") continue;
        out.push({ id: raw.id, displayName: raw.displayName });
        if (out.length >= cap) break;
      }
      return out;
    },

    async listChannels(teamId: string) {
      const res = await graph().json<ListResponse<RawChannel>>({
        method: "GET", path: `/teams/${encodeURIComponent(teamId)}/channels`,
      });
      const out: TeamsChannel[] = [];
      for (const raw of asArray(res.value)) {
        if (typeof raw?.id !== "string" || typeof raw?.displayName !== "string") continue;
        out.push({ id: raw.id, displayName: raw.displayName });
        if (out.length >= cap) break;
      }
      return out;
    },

    async listMembers(target) {
      const path = "chatId" in target
        ? `/chats/${encodeURIComponent(target.chatId)}/members`
        : `/teams/${encodeURIComponent(target.teamId)}/members`;
      const res = await graph().json<ListResponse<RawMember>>({ method: "GET", path });
      const out: TeamsMember[] = [];
      for (const raw of asArray(res.value)) {
        const m = toMember(raw);
        if (m !== null) out.push(m);
        if (out.length >= cap) break;
      }
      return out;
    },

    async getMessages(target) {
      const res = await graph().json<ListResponse<RawMessage>>({
        method: "GET", path: messagesPath(target), query: { "$top": String(cap) },
      });
      const out: TeamsMessage[] = [];
      for (const raw of asArray(res.value)) {
        const m = toMessage(raw, maxTextChars);
        if (m !== null) out.push(m);
        if (out.length >= cap) break;
      }
      return out;
    },

    async postMessage(input) {
      const built = buildTeamsBody(input.content, input.mentions ?? []);
      const raw = await graph().json<{ id?: unknown }>({
        method: "POST", path: messagesPath(input.target),
        body: { body: built.body, mentions: built.mentions },
      });
      if (typeof raw?.id !== "string") {
        throw new Ms365Error("graph_error", "Teams post response missing id.",
          "Thử lại; nếu tiếp diễn hãy kết nối lại Microsoft 365.", false);
      }
      return { id: raw.id };
    },
  };
}
