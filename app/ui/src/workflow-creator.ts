/**
 * Workflow creator (right of the Dispatch surface): describe a workflow in natural language, the
 * provider LLM drafts a validated TaskDefinition (optionally proposing a new agent), you review it,
 * and one tap saves it. NEVER auto-runs — saving a task is separate from running it (the board's
 * "Chạy" button runs it). The draft is produced + validated by the service (`/v1/tasks/draft`); this
 * component only renders it and posts the confirm.
 */

import type { WorkflowDraft } from "./service-client.js";
import { el } from "./ui-shell/dom-utils.js";

/** The minimal client surface the creator needs (a subset of the full ServiceClient). */
export interface WorkflowCreatorClient {
  draftWorkflow(prompt: string): Promise<WorkflowDraft>;
  confirmWorkflow(draft: WorkflowDraft): Promise<{ readonly taskId: string }>;
}

const LOOP_MODE_LABEL: Record<WorkflowDraft["task"]["loop"]["mode"], string> = {
  run_once: "chạy một lần",
  retry_until_verified: "lặp tới khi xác minh",
  scheduled: "theo lịch",
};

function describeAgents(task: WorkflowDraft["task"]): string {
  if (task.branches !== undefined && task.branches.length > 0) {
    return `fan-out ${task.branches.length} nhánh: ${task.branches.map((b) => b.agentId).join(", ")}`;
  }
  return task.agentId !== undefined ? `agent: ${task.agentId}` : "";
}

/** Render the read-only draft review (task + optional proposed agent). */
function renderDraftPreview(draft: WorkflowDraft): HTMLElement {
  const wrap = el("div", "workflow-draft");
  const task = draft.task;
  wrap.append(el("div", "workflow-draft__name", task.name));
  wrap.append(el("p", "workflow-draft__goal", task.goal));
  wrap.append(
    el("div", "workflow-draft__meta", `${LOOP_MODE_LABEL[task.loop.mode]} · ${describeAgents(task)}`),
  );
  if (task.branches !== undefined) {
    for (const branch of task.branches) {
      const focus = branch.focus !== undefined ? ` — ${branch.focus}` : "";
      wrap.append(el("div", "workflow-draft__branch", `• ${branch.agentId}${focus}`));
    }
  }
  if (draft.newAgent !== undefined) {
    const agent = el("div", "workflow-draft__agent");
    agent.append(el("div", "workflow-draft__agent-name", `Agent mới: ${draft.newAgent.name}`));
    agent.append(el("p", "workflow-draft__agent-prompt", draft.newAgent.systemPrompt));
    wrap.append(agent);
  }
  return wrap;
}

/**
 * Mount the "create workflow from a description" panel into `mount`. Calls `onCreated()` after a
 * draft is saved so the caller can refresh the dispatch board (the new task then appears there).
 */
export function appendWorkflowCreator(
  mount: HTMLElement,
  client: WorkflowCreatorClient,
  onCreated: () => void,
): void {
  const section = el("section", "workflow-creator");
  section.append(el("h2", "workflow-creator__title", "Tạo workflow từ mô tả"));
  section.append(
    el(
      "p",
      "workflow-creator__hint",
      "Mô tả việc cần làm; LLM sẽ soạn workflow (task + agent) để bạn xem lại rồi lưu. Không tự chạy.",
    ),
  );

  const input = el("textarea", "workflow-creator__input") as HTMLTextAreaElement;
  input.rows = 3;
  input.placeholder = "VD: Điều tra cách module X hoạt động rồi rà soát rủi ro bảo mật.";
  input.setAttribute("aria-label", "Mô tả workflow");
  section.append(input);

  const note = el("p", "workflow-creator__note");
  const preview = el("div", "workflow-creator__preview");
  const actions = el("div", "workflow-creator__actions");

  const createBtn = el("button", "dispatch-btn", "Tạo workflow") as HTMLButtonElement;
  createBtn.type = "button";
  actions.append(createBtn);
  section.append(actions, note, preview);
  mount.append(section);

  let pendingDraft: WorkflowDraft | null = null;

  const resetPreview = (): void => {
    pendingDraft = null;
    preview.replaceChildren();
  };

  createBtn.addEventListener("click", () => {
    const prompt = input.value.trim();
    if (prompt.length === 0) {
      note.textContent = "Nhập mô tả trước.";
      return;
    }
    createBtn.disabled = true;
    note.textContent = "Đang tạo workflow…";
    resetPreview();
    void client
      .draftWorkflow(prompt)
      .then((draft) => {
        pendingDraft = draft;
        note.textContent = "Xem lại rồi bấm Lưu để dùng được (kể cả 1-touch trên điện thoại).";
        const saveBtn = el("button", "dispatch-btn", "Lưu") as HTMLButtonElement;
        saveBtn.type = "button";
        const discardBtn = el("button", "dispatch-btn dispatch-btn--danger", "Bỏ") as HTMLButtonElement;
        discardBtn.type = "button";
        saveBtn.addEventListener("click", () => {
          if (pendingDraft === null) return;
          saveBtn.disabled = true;
          discardBtn.disabled = true;
          note.textContent = "Đang lưu…";
          void client
            .confirmWorkflow(pendingDraft)
            .then(() => {
              note.textContent = "✅ Đã lưu workflow.";
              input.value = "";
              resetPreview();
              onCreated();
            })
            .catch((err: unknown) => {
              note.textContent = err instanceof Error ? err.message : "Không lưu được workflow.";
              saveBtn.disabled = false;
              discardBtn.disabled = false;
            });
        });
        discardBtn.addEventListener("click", () => {
          note.textContent = "";
          resetPreview();
        });
        const saveRow = el("div", "workflow-creator__actions");
        saveRow.append(saveBtn, discardBtn);
        preview.replaceChildren(renderDraftPreview(draft), saveRow);
      })
      .catch((err: unknown) => {
        note.textContent = err instanceof Error ? err.message : "Không tạo được workflow.";
      })
      .finally(() => {
        createBtn.disabled = false;
      });
  });
}
