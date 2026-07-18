import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDispatchBoard, type DispatchBoardClient } from "../src/dispatch-board.js";
import { createDefaultRegistry, type CommandContext } from "../src/commands/registry.js";
import type { DispatchRunView, DispatchTaskView } from "../src/service-client.js";

const TASK: DispatchTaskView = {
  id: "review-repo",
  name: "Review repository",
  source: "user_local",
  goal: "review the change",
  loop: { mode: "run_once" },
  branches: [{ agentId: "researcher" }, { agentId: "reviewer" }],
};

const RUN: DispatchRunView = {
  runId: "run-1-review-repo",
  taskId: "review-repo",
  taskName: "Review repository",
  loopMode: "run_once",
  startedAt: "2026-07-15T00:00:00Z",
  status: "running",
  attempts: 1,
  verified: false,
  branches: [
    { branchId: "b1", agentId: "researcher", agentName: "Researcher", status: "running" },
    { branchId: "b2", agentId: "reviewer", agentName: "Reviewer", status: "pending" },
  ],
};

function boardClient(over: any = {}): any {
  return {
    listDispatchTasks: async () => [TASK],
    listDispatchRuns: async () => [],
    runDispatchTask: async () => RUN,
    cancelDispatchRun: async () => undefined,
    remoteStatus: async () => ({ enabled: true, url: "http://127.0.0.1:7777", lanUrls: [], devices: [] }),
    remoteRevokeAll: async () => undefined,
    ...over,
  };
}

test("the board renders the task catalog with an honest built-in badge and a run button", async () => {
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(boardClient(), body);

  assert.match(body.textContent ?? "", /Review repository/);
  assert.match(body.textContent ?? "", /user/);
  assert.match(body.textContent ?? "", /fan-out 2 nhánh/);
  assert.ok(body.querySelector("button.dispatch-btn"), "each task needs a run button");
  assert.match(body.textContent ?? "", /Chưa có lượt chạy nào/);
  body.remove();
});

test("built-in placeholder templates are hidden from the board (replaced by 'tạo từ mô tả')", async () => {
  const builtIn: DispatchTaskView = {
    id: "tpl-investigate",
    name: "Điều tra một câu hỏi",
    source: "built_in",
    goal: "Điều tra câu hỏi sau: {mục tiêu}",
    loop: { mode: "run_once" },
    agentId: "researcher",
  };
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(boardClient({ listDispatchTasks: async () => [builtIn, TASK] }), body);
  assert.doesNotMatch(body.textContent ?? "", /Điều tra một câu hỏi/, "built-in template must be hidden");
  assert.match(body.textContent ?? "", /Review repository/, "user task still shows");
  body.remove();
});

test("a run renders its live status and branches exactly as the service reported them", async () => {
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(boardClient({ listDispatchRuns: async () => [RUN] }), body);

  assert.match(body.textContent ?? "", /Đang chạy/);
  assert.match(body.textContent ?? "", /Researcher/);
  assert.match(body.textContent ?? "", /đang chạy/);
  assert.ok(body.querySelector(".dispatch-btn--danger"), "a running run must offer cancel");
  // Never a fabricated verified flag.
  assert.doesNotMatch(body.textContent ?? "", /đã xác minh/);
  body.remove();
});

test("clicking run starts the task through the client", async () => {
  let ranTask: string | null = null;
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(
    boardClient({
      runDispatchTask: async (taskId) => {
        ranTask = taskId;
        return RUN;
      },
    }),
    body,
  );
  body.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ranTask, "review-repo");
  body.remove();
});

test("run buttons are disabled with a reason when the readiness gate blocks (F3)", async () => {
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(boardClient(), body, {
    canRun: false,
    reason: "Cấu hình provider trong Cài đặt trước khi chạy task dispatch.",
  });
  const runBtn = body.querySelector<HTMLButtonElement>("button.dispatch-btn");
  assert.ok(runBtn, "the task still renders");
  assert.equal(runBtn!.disabled, true, "the run action is disabled while not ready");
  assert.match(body.textContent ?? "", /Cấu hình provider/);
  body.remove();
});

test("a blocked gate prevents the task from being started even if clicked", async () => {
  let ranTask: string | null = null;
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(
    boardClient({
      runDispatchTask: async (taskId) => {
        ranTask = taskId;
        return RUN;
      },
    }),
    body,
    { canRun: false, reason: "Chọn workspace trước khi chạy task dispatch." },
  );
  body.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ranTask, null, "a blocked run must not reach the service");
  body.remove();
});

test("an unreachable service renders an honest note, not a broken board", async () => {
  const body = document.createElement("div");
  await renderDispatchBoard(
    boardClient({
      listDispatchTasks: async () => {
        throw new Error("connection refused");
      },
    }),
    body,
  );
  assert.match(body.textContent ?? "", /Không đọc được danh sách dispatch/);
  assert.equal(body.querySelector("button"), null);
});

// ---- /dispatch slash command --------------------------------------------------------

function commandCtx(over: Partial<DispatchBoardClient> = {}): { ctx: CommandContext; messages: string[] } {
  const messages: string[] = [];
  const ctx = {
    client: boardClient(over) as unknown as CommandContext["client"],
    conv: {} as CommandContext["conv"],
    activeSessionId: null,
    arguments: [],
    dom: {},
    state: {},
    handlers: {},
    appendAssistantMessage: (text: string) => {
      messages.push(text);
    },
    clearChatUI: () => undefined,
    refreshUI: () => undefined,
  } as CommandContext;
  return { ctx, messages };
}

test("/dispatch lists the stored tasks with their ids", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/dispatch", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /review-repo/);
  assert.match(messages[0] ?? "", /\/dispatch run <task-id>/);
});

test("/dispatch run without an id explains the syntax instead of guessing", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  await registry.dispatch("/dispatch run", ctx);
  assert.match(messages[0] ?? "", /Thiếu task id/);
});

test("/dispatch run <id> starts the run and reports honest branch states", async () => {
  let ranTask: string | null = null;
  const { ctx, messages } = commandCtx({
    runDispatchTask: async (taskId) => {
      ranTask = taskId;
      return RUN;
    },
  });
  const registry = createDefaultRegistry();
  await registry.dispatch("/dispatch run review-repo", ctx);
  assert.equal(ranTask, "review-repo");
  assert.match(messages[0] ?? "", /run-1-review-repo/);
  assert.match(messages[0] ?? "", /Researcher: running/);
});

test("/dispatch with an unknown subcommand is refused with the syntax", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  await registry.dispatch("/dispatch explode", ctx);
  assert.match(messages[0] ?? "", /Không hiểu/);
});

test("a service error surfaces as an honest command error, not silence", async () => {
  const { ctx, messages } = commandCtx({
    listDispatchTasks: async () => {
      throw new Error("boom");
    },
  });
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/dispatch", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /Lỗi thực thi lệnh \/dispatch/);
});

test("an unknown slash command still reports the invalid-command message", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/nonsense", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /Lệnh không hợp lệ/);
});

test("/remote reports remote is not enabled when service returns enabled=false", async () => {
  const { ctx, messages } = commandCtx({
    remoteStatus: async () => ({ enabled: false, url: null, lanUrls: [], devices: [] }),
  });
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/remote", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /Điều phối từ xa chưa bật/);
});

test("/remote reports remote is not enabled when service status throws error", async () => {
  const { ctx, messages } = commandCtx({
    remoteStatus: async () => {
      throw new Error("connection failed");
    },
  });
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/remote", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /Điều phối từ xa chưa bật/);
});

test("/remote off calls remoteRevokeAll when remote is enabled", async () => {
  let revoked = false;
  const { ctx, messages } = commandCtx({
    remoteStatus: async () => ({ enabled: true, url: "http://127.0.0.1:7777", lanUrls: [], devices: [] }),
    remoteRevokeAll: async () => {
      revoked = true;
    },
  });
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/remote off", ctx);
  assert.equal(res.handled, true);
  assert.equal(revoked, true);
  assert.match(messages[0] ?? "", /Đã tắt toàn bộ kênh remote/);
});
