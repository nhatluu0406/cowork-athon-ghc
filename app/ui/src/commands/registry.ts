import type { ServiceClient } from "../service-client.js";
import type { ConversationManager } from "../conversation-controller.js";
import { openRemotePanel } from "../remote-panel.js";
import { getShellBridge } from "../bridge.js";

export interface CommandContext {
  readonly client: ServiceClient;
  readonly conv: ConversationManager;
  readonly activeSessionId: string | null;
  readonly arguments: readonly string[];
  readonly dom: any;
  readonly state: any;
  readonly handlers: any;
  readonly appendAssistantMessage: (text: string) => void;
  readonly clearChatUI: () => void;
  readonly refreshUI: () => void;
}

export type CommandType = "client_side" | "prompt_template";

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly type: CommandType;
  readonly handler: (ctx: CommandContext) => Promise<string | void> | string | void;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(cmd: CommandDefinition): void {
    this.commands.set(cmd.name.toLowerCase(), cmd);
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase());
  }

  list(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }

  async dispatch(text: string, ctx: CommandContext): Promise<{ handled: boolean; result?: string }> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return { handled: false };

    const parts = trimmed.split(/\s+/u);
    const cmdName = parts[0]!.slice(1).toLowerCase();
    const cmd = this.get(cmdName);

    if (cmd === undefined) {
      ctx.appendAssistantMessage(`⛔ Lệnh không hợp lệ: /${cmdName}. Gõ /help để xem danh sách lệnh.`);
      return { handled: true };
    }

    const cmdCtx: CommandContext = {
      ...ctx,
      arguments: parts.slice(1),
    };

    try {
      const outcome = await cmd.handler(cmdCtx);
      if (cmd.type === "prompt_template" && typeof outcome === "string") {
        return { handled: true, result: outcome };
      }
      return { handled: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Đã xảy ra lỗi khi chạy lệnh.";
      ctx.appendAssistantMessage(`❌ Lỗi thực thi lệnh /${cmdName}: ${msg}`);
      return { handled: true };
    }
  }
}

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  // /help
  registry.register({
    name: "help",
    description: "Hiển thị danh sách các lệnh slash command hỗ trợ.",
    type: "client_side",
    handler: (ctx) => {
      const lines = registry
        .list()
        .map((c) => `• \`/${c.name}\` — ${c.description}`)
        .join("\n");
      ctx.appendAssistantMessage(`Các lệnh slash command được hỗ trợ:\n${lines}`);
    },
  });

  // /remote
  registry.register({
    name: "remote",
    description: "Mở bảng điều khiển cổng kết nối từ xa (Remote Gateway).",
    type: "client_side",
    handler: async (ctx) => {
      const args = ctx.arguments;
      if (args[0]?.toLowerCase() === "off") {
        await ctx.client.remoteRevokeAll();
        ctx.appendAssistantMessage("✅ Đã tắt toàn bộ kênh remote và thu hồi tất cả các token thiết bị.");
      } else {
        openRemotePanel(ctx.client);
      }
      ctx.refreshUI();
    },
  });

  // /clear
  registry.register({
    name: "clear",
    description: "Xóa màn hình chat và gọi LLM nén lịch sử cuộc trò chuyện.",
    type: "client_side",
    handler: async (ctx) => {
      const activeId = ctx.state.conv.state.activeConversationId;
      if (!activeId) {
        ctx.appendAssistantMessage("Không có cuộc trò chuyện nào đang hoạt động.");
        return;
      }
      ctx.clearChatUI();
      ctx.appendAssistantMessage("🧹 Đang dọn dẹp giao diện và nén lịch sử cuộc trò chuyện...");
      try {
        const res = await ctx.client.compactConversation(activeId);
        // Refresh conversation manager record so it loads the compacted messages
        await ctx.conv.select(activeId);
        ctx.clearChatUI();
        ctx.appendAssistantMessage(`✨ Đã nén cuộc trò chuyện thành công.\n\n[Tóm tắt ngữ cảnh trước đó]: ${res.summary}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Không thể nén cuộc trò chuyện.";
        ctx.appendAssistantMessage(`⚠️ Giao diện đã được dọn dẹp, nhưng gặp lỗi khi gọi API nén: ${msg}`);
      }
      ctx.refreshUI();
    },
  });

  // /compact
  registry.register({
    name: "compact",
    description: "Gọi LLM nén lịch sử cuộc trò chuyện (giữ nguyên giao diện UI).",
    type: "client_side",
    handler: async (ctx) => {
      const activeId = ctx.state.conv.state.activeConversationId;
      if (!activeId) {
        ctx.appendAssistantMessage("Không có cuộc trò chuyện nào đang hoạt động.");
        return;
      }
      ctx.appendAssistantMessage("⚡ Đang gọi LLM nén lịch sử cuộc trò chuyện...");
      try {
        const res = await ctx.client.compactConversation(activeId);
        await ctx.conv.select(activeId);
        ctx.appendAssistantMessage(`✨ Đã nén cuộc trò chuyện thành công.\n\n[Tóm tắt ngữ cảnh trước đó]: ${res.summary}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Không thể nén cuộc trò chuyện.";
        ctx.appendAssistantMessage(`❌ Lỗi nén cuộc trò chuyện: ${msg}`);
      }
      ctx.refreshUI();
    },
  });

  // /bug
  registry.register({
    name: "bug",
    description: "Thu thập và kết xuất gói chẩn đoán (diagnostics) cục bộ.",
    type: "client_side",
    handler: async (ctx) => {
      ctx.appendAssistantMessage("🔍 Đang thu thập thông tin chẩn đoán hệ thống...");
      try {
        const bridge = getShellBridge();
        const info = await bridge.gatherDiagnostics?.();
        ctx.appendAssistantMessage(`✅ Đã kết xuất thông tin chẩn đoán thành công.\n\n${JSON.stringify(info ?? {}, null, 2)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Lỗi không xác định.";
        ctx.appendAssistantMessage(`❌ Lỗi khi thu thập chẩn đoán: ${msg}`);
      }
    },
  });

  // /review (Nhóm B - Prompt Template)
  registry.register({
    name: "review",
    description: "Tạo Prompt đánh giá mã nguồn dựa trên các tệp đang hoạt động.",
    type: "prompt_template",
    handler: (ctx) => {
      const files = ctx.state.codeOpenFiles ?? [];
      const activeFile = ctx.state.codeActiveKey;
      if (files.length === 0) {
        return "Hãy thực hiện review mã nguồn của thư mục hiện tại.";
      }
      const filesList = files.map((f: any) => `• \`${f.relativePath}\``).join("\n");
      const activeMsg = activeFile ? `Tệp đang active: \`${activeFile}\`.\n` : "";
      return `Hãy thực hiện đánh giá (code review) các tệp tin sau trong dự án của tôi:\n${filesList}\n${activeMsg}Tìm kiếm lỗi bảo mật, tối ưu hóa hiệu năng, trùng lặp code và đưa ra khuyến nghị cải tiến cụ thể.`;
    },
  });

  return registry;
}
