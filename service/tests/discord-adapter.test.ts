import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDiscordAdapter,
  type DiscordInbound,
  type DiscordPendingPermission,
  type DiscordTransport,
} from "../src/remote-gateway/discord/adapter.js";

const ALLOWED = "111111111111111111";
const OUTSIDER = "999999999999999999";

function fakeTransport(inbound: DiscordInbound[] = []): DiscordTransport & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: async (text: string) => {
      sent.push(text);
    },
    poll: async () => inbound.splice(0, inbound.length),
  };
}

interface Hooks {
  pending: DiscordPendingPermission[];
  denied: string[];
  prompts: { sessionId: string; text: string }[];
  activeSession: string | null;
}

function makeHooks(overrides: Partial<Hooks> = {}) {
  const state: Hooks = {
    pending: overrides.pending ?? [],
    denied: [],
    prompts: [],
    activeSession: "activeSession" in overrides ? (overrides.activeSession ?? null) : "sess-1",
  };
  return {
    state,
    hooks: {
      listPending: () => state.pending,
      denyPermission: async (requestId: string) => {
        const exists = state.pending.some((p) => p.requestId === requestId);
        if (!exists) return { status: "unknown" as const };
        state.denied.push(requestId);
        state.pending = state.pending.filter((p) => p.requestId !== requestId);
        return { status: "resolved" as const };
      },
      activeSessionId: () => state.activeSession,
      sendPrompt: async (sessionId: string, text: string) => {
        state.prompts.push({ sessionId, text });
        return { accepted: true };
      },
    },
  };
}

test("commands from a non-allowlisted user are ignored (fail closed)", async () => {
  const transport = fakeTransport();
  const { state, hooks } = makeHooks({ pending: [{ requestId: "r1", description: "Tạo file" }] });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });

  const result = await adapter.handleInbound({ userId: OUTSIDER, text: "deny r1" });
  assert.equal(result, null);
  assert.equal(state.denied.length, 0);
  assert.equal(transport.sent.length, 0);
});

test("deny <id> routes to the gate and confirms", async () => {
  const transport = fakeTransport();
  const { state, hooks } = makeHooks({ pending: [{ requestId: "req-9", description: "Xoá file" }] });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });

  const reply = await adapter.handleInbound({ userId: ALLOWED, text: "deny req-9" });
  assert.match(reply ?? "", /Đã từ chối/);
  assert.deepEqual(state.denied, ["req-9"]);
});

test("approve is refused from Discord per Q5 and never authorizes anything", async () => {
  const transport = fakeTransport();
  const { state, hooks } = makeHooks({ pending: [{ requestId: "r1", description: "Ghi file" }] });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });

  for (const text of ["approve r1", "/approve r1", "APPROVE"]) {
    const reply = await adapter.handleInbound({ userId: ALLOWED, text });
    assert.match(reply ?? "", /Không thể phê duyệt/);
  }
  assert.equal(state.denied.length, 0);
  assert.equal(state.prompts.length, 0);
});

test("a plain message is dispatched as a prompt to the active session", async () => {
  const transport = fakeTransport();
  const { state, hooks } = makeHooks({ activeSession: "sess-42" });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });

  const reply = await adapter.handleInbound({ userId: ALLOWED, text: "chạy test giúp tôi" });
  assert.match(reply ?? "", /Đã gửi prompt/);
  assert.deepEqual(state.prompts, [{ sessionId: "sess-42", text: "chạy test giúp tôi" }]);
});

test("a prompt with no active session is honestly refused", async () => {
  const transport = fakeTransport();
  const { hooks } = makeHooks({ activeSession: null });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });
  const reply = await adapter.handleInbound({ userId: ALLOWED, text: "làm gì đó" });
  assert.match(reply ?? "", /Chưa có phiên/);
});

test("pending lists awaiting requests; deny of an unknown id is reported", async () => {
  const transport = fakeTransport();
  const { hooks } = makeHooks({ pending: [{ requestId: "a1", description: "Sửa file X" }] });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });

  const list = await adapter.handleInbound({ userId: ALLOWED, text: "pending" });
  assert.match(list ?? "", /a1/);
  const unknown = await adapter.handleInbound({ userId: ALLOWED, text: "deny nope" });
  assert.match(unknown ?? "", /Không tìm thấy/);
});

test("notifications carry only a redacted summary + deep link, never file content", async () => {
  const transport = fakeTransport();
  const { hooks } = makeHooks();
  const adapter = createDiscordAdapter({
    transport,
    hooks,
    allowedUserIds: [ALLOWED],
    appDeepLink: "cowork://open",
  });
  await adapter.notifyPermissionAsked({
    requestId: "r5",
    description: "Tạo file báo cáo",
    targetPath: "reports/summary.md",
  });
  const sent = transport.sent[0] ?? "";
  assert.match(sent, /Agent xin quyền/);
  assert.match(sent, /deny r5/);
  assert.match(sent, /cowork:\/\/open/);
  // Only the path label crosses — never file bytes/secrets (none were passed in).
  assert.doesNotMatch(sent, /BEGIN|sk-|password|token/i);
});

test("pump processes only actionable inbound and counts them", async () => {
  const inbound: DiscordInbound[] = [
    { userId: OUTSIDER, text: "deny r1" }, // ignored (not allowlisted)
    { userId: ALLOWED, text: "" }, // ignored (empty)
    { userId: ALLOWED, text: "xin chào" }, // prompt → acted
  ];
  const transport = fakeTransport(inbound);
  const { state, hooks } = makeHooks({ activeSession: "s1" });
  const adapter = createDiscordAdapter({ transport, hooks, allowedUserIds: [ALLOWED] });
  const acted = await adapter.pump();
  assert.equal(acted, 1);
  assert.equal(state.prompts.length, 1);
});
