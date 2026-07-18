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
      try {
        const status = await ctx.client.remoteStatus();
        if (!status.enabled) {
          ctx.appendAssistantMessage("Điều phối từ xa chưa bật trong phiên này. Hãy mở lại ứng dụng bằng lối tắt Cowork GHC để bật cổng kết nối từ xa.");
          ctx.refreshUI();
          return;
        }
      } catch (err) {
        ctx.appendAssistantMessage("Điều phối từ xa chưa bật trong phiên này. Hãy mở lại ứng dụng bằng lối tắt Cowork GHC để bật cổng kết nối từ xa.");
        ctx.refreshUI();
        return;
      }

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
      // Do not clear before the service confirms. A failed call used to leave the view
      // empty while the backend still held the full transcript, so the next prompt ran
      // against a context the user could no longer see.
      ctx.appendAssistantMessage("🧹 Đang nén lịch sử cuộc trò chuyện...");
      try {
        await ctx.client.compactConversation(activeId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Không thể nén cuộc trò chuyện.";
        ctx.appendAssistantMessage(`❌ Lỗi nén cuộc trò chuyện: ${msg}\n\nLịch sử được giữ nguyên.`);
        ctx.refreshUI();
        return;
      }
      // The service is the source of truth for the compacted transcript: reload it and
      // render that, rather than clearing and appending a locally-invented summary.
      ctx.clearChatUI();
      await ctx.conv.select(activeId);
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
    description: "Thu thập và hiển thị thông tin chẩn đoán (diagnostics) của ứng dụng.",
    type: "client_side",
    handler: (ctx) => {
      const info = {
        activeConversationId: ctx.state.conv.state.activeConversationId,
        runtimeSessionId: ctx.state.conv.state.runtimeSessionId,
        runtimePhase: ctx.state.conv.state.runtimePhase,
        activeWorkspace: ctx.state.activeWorkspace?.rootPath ?? null,
        localServiceReady: ctx.state.localServiceReady,
        connectionTestState: ctx.state.connectionTestState,
        permissionMode: ctx.state.permissionMode,
        openFilesCount: ctx.state.codeOpenFiles?.length ?? 0,
        userAgent: navigator.userAgent,
      };
      ctx.appendAssistantMessage(`✅ Đã thu thập thông tin chẩn đoán:\n\n\`\`\`json\n${JSON.stringify(info, null, 2)}\n\`\`\``);
    },
  });

  // /dispatch — task catalog + fan-out runs from the composer (agent-harness-plan.md Task 5.3)
  registry.register({
    name: "dispatch",
    description:
      "Điều phối task cho built-in agents. Cú pháp: /dispatch · /dispatch run <task-id> · /dispatch runs · /dispatch cancel <run-id>.",
    type: "client_side",
    handler: async (ctx) => {
      const [sub, arg] = ctx.arguments;
      const client = ctx.client;

      if (sub === undefined) {
        const tasks = await client.listDispatchTasks();
        if (tasks.length === 0) {
          ctx.appendAssistantMessage("Chưa có task nào. Tạo task qua API `/v1/tasks` hoặc dùng template built-in.");
          return;
        }
        const lines = tasks
          .map((t) => `• \`${t.id}\` — ${t.name} (${t.source === "built_in" ? "built-in" : "user"})`)
          .join("\n");
        ctx.appendAssistantMessage(
          `Task có thể chạy:\n${lines}\n\nChạy bằng \`/dispatch run <task-id>\`; theo dõi trên bề mặt Dispatch.`,
        );
        return;
      }

      const verb = sub.toLowerCase();
      if (verb === "run") {
        if (arg === undefined || arg.trim().length === 0) {
          ctx.appendAssistantMessage("⛔ Thiếu task id. Cú pháp: `/dispatch run <task-id>` (xem id bằng `/dispatch`).");
          return;
        }
        const run = await client.runDispatchTask(arg.trim());
        const branches = run.branches.map((b) => `• ${b.agentName}: ${b.status}`).join("\n");
        ctx.appendAssistantMessage(
          `🚀 Đã bắt đầu run \`${run.runId}\` cho task **${run.taskName}** (${run.status}).\n${branches}\n\nTheo dõi trên bề mặt Dispatch; hủy bằng \`/dispatch cancel ${run.runId}\`.`,
        );
        return;
      }

      if (verb === "runs") {
        const runs = await client.listDispatchRuns();
        if (runs.length === 0) {
          ctx.appendAssistantMessage("Chưa có lượt chạy dispatch nào.");
          return;
        }
        const lines = runs
          .map((r) => `• \`${r.runId}\` — ${r.taskName}: ${r.status} (lượt ${r.attempts})${r.verified ? " · đã xác minh" : ""}`)
          .join("\n");
        ctx.appendAssistantMessage(`Lượt chạy dispatch:\n${lines}`);
        return;
      }

      if (verb === "cancel") {
        if (arg === undefined || arg.trim().length === 0) {
          ctx.appendAssistantMessage("⛔ Thiếu run id. Cú pháp: `/dispatch cancel <run-id>` (xem id bằng `/dispatch runs`).");
          return;
        }
        await client.cancelDispatchRun(arg.trim());
        ctx.appendAssistantMessage(`🛑 Đã yêu cầu hủy run \`${arg.trim()}\`.`);
        return;
      }

      ctx.appendAssistantMessage(
        `⛔ Không hiểu \`/dispatch ${sub}\`. Cú pháp: /dispatch · /dispatch run <task-id> · /dispatch runs · /dispatch cancel <run-id>.`,
      );
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
