/**
 * Discord channel (agent-harness-plan.md Task 2.3) — barrel + flag/config helpers.
 * OFF unless `CGHC_DISCORD_ENABLED` and the required env config are present.
 */

export {
  createDiscordAdapter,
  type DiscordAdapter,
  type DiscordAdapterOptions,
  type DiscordAdapterHooks,
  type DiscordTransport,
  type DiscordInbound,
  type DiscordPendingPermission,
} from "./adapter.js";

export {
  createDiscordRestTransport,
  type DiscordRestTransportOptions,
} from "./rest-transport.js";

/** Resolved Discord config (secret-free except the token, which stays in the transport). */
export interface DiscordConfig {
  readonly botToken: string;
  readonly channelId: string;
  readonly allowedUserIds: readonly string[];
}

/**
 * Read Discord config from the environment. Returns `null` (feature off) unless the flag is on
 * AND all required fields are present — a partial config never silently half-enables the channel.
 */
export function readDiscordConfig(env: Record<string, string | undefined>): DiscordConfig | null {
  const enabled = env["CGHC_DISCORD_ENABLED"] === "1" || env["CGHC_DISCORD_ENABLED"] === "true";
  if (!enabled) return null;
  const botToken = env["CGHC_DISCORD_BOT_TOKEN"]?.trim();
  const channelId = env["CGHC_DISCORD_CHANNEL_ID"]?.trim();
  const allowedUserIds = (env["CGHC_DISCORD_ALLOWED_USER_IDS"] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (!botToken || !channelId || allowedUserIds.length === 0) return null;
  return { botToken, channelId, allowedUserIds };
}
