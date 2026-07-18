import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendWorkflowCreator, type WorkflowCreatorClient } from "../src/workflow-creator.js";
import type { WorkflowDraft } from "../src/service-client.js";

const DRAFT: WorkflowDraft = {
  task: {
    id: "wf-abc123",
    name: "Điều tra & rà soát X",
    goal: "Điều tra cách module X hoạt động rồi rà soát rủi ro bảo mật.",
    loop: { mode: "run_once", maxTurns: 8, maxDurationMs: 300_000 },
    branches: [
      { agentId: "researcher", focus: "luồng dữ liệu" },
      { agentId: "security-auditor", focus: "injection" },
    ],
  },
  newAgent: {
    id: "security-auditor",
    name: "Security Auditor",
    systemPrompt: "Bạn là chuyên gia bảo mật, chỉ đọc và báo cáo rủi ro.",
  },
};

function creatorClient(over: Partial<WorkflowCreatorClient> = {}): WorkflowCreatorClient & {
  drafted: string[];
  confirmed: WorkflowDraft[];
} {
  const drafted: string[] = [];
  const confirmed: WorkflowDraft[] = [];
  return {
    drafted,
    confirmed,
    draftWorkflow: async (prompt) => {
      drafted.push(prompt);
      return DRAFT;
    },
    confirmWorkflow: async (draft) => {
      confirmed.push(draft);
      return { taskId: draft.task.id };
    },
    ...over,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("creating: description -> draft preview renders the task, branches, and proposed agent", async () => {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const client = creatorClient();
  appendWorkflowCreator(mount, client, () => {});

  const input = mount.querySelector<HTMLTextAreaElement>(".workflow-creator__input")!;
  input.value = "Điều tra module X rồi rà soát bảo mật";
  mount.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await tick();

  assert.deepEqual(client.drafted, ["Điều tra module X rồi rà soát bảo mật"]);
  assert.match(mount.textContent ?? "", /Điều tra & rà soát X/);
  assert.match(mount.textContent ?? "", /security-auditor/);
  assert.match(mount.textContent ?? "", /Agent mới: Security Auditor/);
  mount.remove();
});

test("empty description does not call the service", async () => {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const client = creatorClient();
  appendWorkflowCreator(mount, client, () => {});

  mount.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await tick();
  assert.equal(client.drafted.length, 0);
  assert.match(mount.textContent ?? "", /Nhập mô tả trước/);
  mount.remove();
});

test("saving: confirm posts the reviewed draft and fires onCreated", async () => {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const client = creatorClient();
  let created = 0;
  appendWorkflowCreator(mount, client, () => {
    created += 1;
  });

  mount.querySelector<HTMLTextAreaElement>(".workflow-creator__input")!.value = "làm X";
  mount.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await tick();

  // The save button is the one labelled "Lưu" inside the preview.
  const saveBtn = [...mount.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Lưu",
  )!;
  saveBtn.click();
  await tick();

  assert.equal(client.confirmed.length, 1);
  assert.equal(client.confirmed[0]!.task.id, "wf-abc123");
  assert.equal(created, 1);
  assert.match(mount.textContent ?? "", /Đã lưu workflow/);
  mount.remove();
});

test("a draft failure surfaces the error and never confirms", async () => {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const client = creatorClient({
    draftWorkflow: async () => {
      throw new Error("Chưa cấu hình provider.");
    },
  });
  appendWorkflowCreator(mount, client, () => {});

  mount.querySelector<HTMLTextAreaElement>(".workflow-creator__input")!.value = "làm X";
  mount.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await tick();

  assert.match(mount.textContent ?? "", /Chưa cấu hình provider/);
  assert.equal(client.confirmed.length, 0);
  mount.remove();
});
