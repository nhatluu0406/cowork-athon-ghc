/**
 * Discord channel adapter (agent-harness-plan.md Task 2.3, MVP) — the third remote channel.
 *
 * It connects OUTBOUND only (no inbound port opened on the machine) through an injectable
 * {@link DiscordTransport}, so the default test suite drives a fake transport with no network.
 * The adapter:
 *   - pushes a REDACTED notification when the agent asks for a permission or a run ends;
 *   - accepts commands only from an ALLOWLIST of Discord user ids;
 *   - routes `deny <id>` to the ONE permission gate and a plain message to the active session;
 *   - REFUSES `approve` of a write from Discord (Q5, PO-approved): approving a file write must
 *     come from the PWA/desktop, so a hijacked Discord account can block work but never authorize it.
 *
 * It NEVER sends file content, diffs, or secrets to Discord — only a short redacted summary plus
 * a deep link back to the app. The bot token lives only in the transport, never in a log line.
 */

export interface DiscordInbound {
  /** Discord user id (snowflake) of the message author. */
  readonly userId: string;
  /** Raw message text. */
  readonly text: string;
}

/** Minimal outbound/inbound seam. A real REST-polling implementation lives alongside this. */
export interface DiscordTransport {
  /** Post a message to the bound channel/thread. */
  send(text: string): Promise<void>;
  /** Fetch inbound messages received since the last poll (may be empty). */
  poll(): Promise<readonly DiscordInbound[]>;
}

/** A pending permission the adapter can surface / act on (secret-free projection). */
export interface DiscordPendingPermission {
  readonly requestId: string;
  readonly description: string;
  readonly targetPath?: string;
}

/** Hooks into the ONE gate + session send-prompt (no business logic lives in the adapter). */
export interface DiscordAdapterHooks {
  /** Still-pending permission requests (secret-free). */
  listPending(): readonly DiscordPendingPermission[];
  /** Record a decision on the ONE gate. Only `deny` is reachable from Discord. */
  denyPermission(requestId: string): Promise<{ readonly status: "resolved" | "already_resolved" | "unknown" }>;
  /** The session a plain-text prompt targets, or null when none is active. */
  activeSessionId(): string | null;
  /** Dispatch a prompt to a session (fire-and-forget; reply streams in the app). */
  sendPrompt(sessionId: string, text: string): Promise<{ readonly accepted: boolean; readonly reason?: string }>;
}

export interface DiscordAdapterOptions {
  readonly transport: DiscordTransport;
  readonly hooks: DiscordAdapterHooks;
  /** Allowlisted Discord user ids permitted to command the bot. Empty ⇒ nobody. */
  readonly allowedUserIds: readonly string[];
  /** Deep link shown in notifications so the user opens the app to approve. */
  readonly appDeepLink?: string;
  /** Secret-free diagnostic sink (never receives the bot token or file content). */
  readonly log?: (line: string) => void;
}

/** Truncate a summary to a safe, bounded length for a Discord line. */
function clip(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/gu, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export interface DiscordAdapter {
  /** Push a redacted "permission asked" notification. */
  notifyPermissionAsked(p: DiscordPendingPermission): Promise<void>;
  /** Push a redacted terminal-state notification for a run. */
  notifyRunTerminal(sessionId: string, state: string): Promise<void>;
  /** Process one inbound message; returns the reply text sent (for tests), or null if ignored. */
  handleInbound(msg: DiscordInbound): Promise<string | null>;
  /** Poll once and process every inbound message. Returns how many were acted on. */
  pump(): Promise<number>;
}

export function createDiscordAdapter(options: DiscordAdapterOptions): DiscordAdapter {
  const { transport, hooks } = options;
  const allowed = new Set(options.allowedUserIds);
  const log = options.log ?? (() => {});
  const link = options.appDeepLink;

  async function reply(text: string): Promise<string> {
    await transport.send(text);
    return text;
  }

  async function handleInbound(msg: DiscordInbound): Promise<string | null> {
    // Fail closed: only allowlisted users can command the bot; others are audited + ignored.
    if (!allowed.has(msg.userId)) {
      log(`discord: ignored command from non-allowlisted user ${msg.userId}`);
      return null;
    }
    const text = msg.text.trim();
    if (text.length === 0) return null;
    const lower = text.toLowerCase();

    // `approve ...` is refused from Discord by policy (Q5).
    if (lower === "approve" || lower.startsWith("approve ") || lower.startsWith("/approve")) {
      return reply(
        "⛔ Không thể phê duyệt ghi tệp từ Discord (chính sách bảo mật). Mở app hoặc PWA để Cho phép.",
      );
    }

    // `pending` — list the requests awaiting a decision.
    if (lower === "pending" || lower === "/pending") {
      const pending = hooks.listPending();
      if (pending.length === 0) return reply("Không có yêu cầu quyền nào đang chờ.");
      const lines = pending
        .map((p) => `• \`${p.requestId}\` — ${clip(p.description, 100)}`)
        .join("\n");
      return reply(`Đang chờ quyết định:\n${lines}\n(Trả lời \`deny <id>\` để từ chối.)`);
    }

    // `deny <id>` — the only decision reachable from Discord.
    const denyMatch = /^\/?deny\s+(\S+)$/iu.exec(text);
    if (denyMatch) {
      const requestId = denyMatch[1] as string;
      const outcome = await hooks.denyPermission(requestId);
      if (outcome.status === "unknown") return reply(`Không tìm thấy yêu cầu \`${requestId}\`.`);
      if (outcome.status === "already_resolved") {
        return reply(`Yêu cầu \`${requestId}\` đã được quyết định trước đó.`);
      }
      return reply(`⛔ Đã từ chối \`${requestId}\`.`);
    }

    // Anything else is a prompt to the active session.
    const sessionId = hooks.activeSessionId();
    if (sessionId === null) {
      return reply("Chưa có phiên đang chạy để nhận prompt. Mở một hội thoại trong app trước.");
    }
    const sent = await hooks.sendPrompt(sessionId, text);
    if (sent.accepted) return reply("✅ Đã gửi prompt — phản hồi hiển thị trong app.");
    return reply(`Không gửi được prompt${sent.reason ? ` (${sent.reason})` : ""}.`);
  }

  return {
    async notifyPermissionAsked(p) {
      const linkLine = link ? `\n${link}` : "";
      await transport.send(
        `🔐 Agent xin quyền: ${clip(p.description)}` +
          (p.targetPath ? `\n\`${clip(p.targetPath, 80)}\`` : "") +
          `\nTrả lời \`deny ${p.requestId}\` để từ chối; Cho phép phải làm trong app.${linkLine}`,
      );
    },
    async notifyRunTerminal(sessionId, state) {
      await transport.send(`ℹ️ Phiên \`${clip(sessionId, 40)}\` kết thúc: ${clip(state, 40)}.`);
    },
    handleInbound,
    async pump() {
      const inbound = await transport.poll();
      let acted = 0;
      for (const msg of inbound) {
        const result = await handleInbound(msg);
        if (result !== null) acted += 1;
      }
      return acted;
    },
  };
}
