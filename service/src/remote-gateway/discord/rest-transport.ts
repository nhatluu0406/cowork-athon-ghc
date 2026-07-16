/**
 * Discord REST-polling transport (agent-harness-plan.md Task 2.3, MVP) — a dependency-free
 * {@link DiscordTransport} over the Discord HTTP API. It polls one channel for new messages and
 * posts replies, connecting OUTBOUND only (no gateway websocket, no inbound port). This keeps
 * the MVP simple and firewall-friendly; a websocket gateway transport is a later upgrade.
 *
 * The bot token is held ONLY in this closure and sent solely in the `Authorization` header —
 * never logged, never returned. Bot messages the bot itself posted are skipped so it never
 * answers its own notifications.
 */

import type { DiscordInbound, DiscordTransport } from "./adapter.js";

const DISCORD_API = "https://discord.com/api/v10";

export interface DiscordRestTransportOptions {
  readonly botToken: string;
  readonly channelId: string;
  /** Injectable fetch (default global) so tests never hit the network. */
  readonly fetch?: typeof fetch;
  /** Secret-free diagnostic sink (never receives the token). */
  readonly log?: (line: string) => void;
}

interface DiscordApiMessage {
  readonly id: string;
  readonly content: string;
  readonly author?: { readonly id?: string; readonly bot?: boolean };
}

export function createDiscordRestTransport(options: DiscordRestTransportOptions): DiscordTransport {
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? (() => {});
  const authHeader = `Bot ${options.botToken}`;
  const base = `${DISCORD_API}/channels/${encodeURIComponent(options.channelId)}/messages`;
  let afterId: string | undefined;

  return {
    async send(text: string): Promise<void> {
      try {
        const res = await doFetch(base, {
          method: "POST",
          headers: { authorization: authHeader, "content-type": "application/json" },
          // Discord hard-caps a message at 2000 chars; stay well under.
          body: JSON.stringify({ content: text.slice(0, 1900) }),
        });
        if (!res.ok) log(`discord: send failed (${res.status})`);
      } catch {
        log("discord: send error (network)");
      }
    },

    async poll(): Promise<readonly DiscordInbound[]> {
      const url = afterId ? `${base}?after=${afterId}&limit=20` : `${base}?limit=1`;
      let messages: DiscordApiMessage[];
      try {
        const res = await doFetch(url, { headers: { authorization: authHeader } });
        if (!res.ok) {
          log(`discord: poll failed (${res.status})`);
          return [];
        }
        messages = (await res.json()) as DiscordApiMessage[];
      } catch {
        log("discord: poll error (network)");
        return [];
      }
      if (!Array.isArray(messages) || messages.length === 0) return [];
      // Discord returns newest-first; advance the cursor to the newest id and process oldest-first.
      const ordered = [...messages].reverse();
      afterId = ordered[ordered.length - 1]?.id ?? afterId;
      const inbound: DiscordInbound[] = [];
      for (const msg of ordered) {
        if (msg.author?.bot === true) continue; // never react to our own posts
        const userId = msg.author?.id;
        if (typeof userId !== "string") continue;
        inbound.push({ userId, text: msg.content ?? "" });
      }
      return inbound;
    },
  };
}
