/**
 * Dispatch board (agent-harness-plan.md Task 5.3, desktop) — the Dispatch surface's real content:
 * the stored task catalog with 1-touch run, and live run views (loop status + per-branch status).
 *
 * A THIN client of `/v1/tasks` + `/v1/dispatch`: it renders exactly what the service reports and
 * fabricates nothing — a branch is "completed" only because the service said so. While at least
 * one run is live the board re-polls every 3s and stops as soon as its element leaves the DOM.
 */

import type { DispatchRunView, DispatchTaskView } from "./service-client.js";
import { el } from "./ui-shell/dom-utils.js";

/** The minimal client surface the board needs (a subset of the full ServiceClient). */
export interface DispatchBoardClient {
  listDispatchTasks(): Promise<readonly DispatchTaskView[]>;
  runDispatchTask(taskId: string): Promise<DispatchRunView>;
  listDispatchRuns(): Promise<readonly DispatchRunView[]>;
  cancelDispatchRun(runId: string): Promise<void>;
}

/**
 * Whether a dispatch task may be started, and if not, the honest reason. A fan-out run drives real
 * LLM agents in the active workspace, so it needs the same prerequisites as a Cowork send (service +
 * workspace + provider). Gating the "Chạy" button here avoids the run-then-fail UX (ui-ux-audit F3).
 */
export interface DispatchRunGate {
  readonly canRun: boolean;
  readonly reason: string;
}

const DISPATCH_RUN_READY: DispatchRunGate = { canRun: true, reason: "" };

const POLL_MS = 3_000;

const RUN_STATUS_LABEL: Record<DispatchRunView["status"], string> = {
  running: "Đang chạy",
  completed: "Hoàn thành",
  partial: "Một phần",
  errored: "Lỗi",
  cancelled: "Đã hủy",
  exhausted: "Hết giới hạn",
};

const BRANCH_STATUS_LABEL: Record<DispatchRunView["branches"][number]["status"], string> = {
  pending: "chờ",
  running: "đang chạy",
  completed: "hoàn thành",
  errored: "lỗi",
  cancelled: "đã hủy",
};

const LOOP_MODE_LABEL: Record<DispatchTaskView["loop"]["mode"], string> = {
  run_once: "chạy một lần",
  retry_until_verified: "lặp tới khi xác minh",
  scheduled: "theo lịch",
};

function describeAgents(task: DispatchTaskView): string {
  if (task.branches !== undefined && task.branches.length > 0) {
    return `fan-out ${task.branches.length} nhánh: ${task.branches.map((b) => b.agentId).join(", ")}`;
  }
  return task.agentId !== undefined ? `agent: ${task.agentId}` : "";
}

function renderTasks(
  tasks: readonly DispatchTaskView[],
  gate: DispatchRunGate,
  onRun: (taskId: string, note: HTMLElement) => void,
): HTMLElement {
  const section = el("div", "dispatch-section");
  section.appendChild(el("div", "dispatch-section__label", "Task có sẵn"));
  if (tasks.length === 0) {
    section.appendChild(el("p", "dispatch-note", "Chưa có task nào."));
    return section;
  }
  if (!gate.canRun) {
    const blocked = el("p", "dispatch-note dispatch-note--blocked", gate.reason);
    section.appendChild(blocked);
  }
  for (const task of tasks) {
    const row = el("div", "dispatch-task");
    const head = el("div", "dispatch-task__head");
    head.appendChild(el("span", "dispatch-task__name", task.name));
    head.appendChild(
      el("span", "dispatch-task__badge", task.source === "built_in" ? "built-in" : "user"),
    );
    const meta = el(
      "div",
      "dispatch-task__meta",
      `${task.id} · ${LOOP_MODE_LABEL[task.loop.mode]} · ${describeAgents(task)}`,
    );
    const note = el("span", "dispatch-task__note", "");
    const runBtn = el("button", "dispatch-btn", "Chạy") as HTMLButtonElement;
    if (!gate.canRun) {
      runBtn.disabled = true;
      runBtn.dataset["tooltip"] = gate.reason;
      runBtn.setAttribute("aria-disabled", "true");
    }
    runBtn.addEventListener("click", () => {
      if (!gate.canRun) return;
      runBtn.disabled = true;
      note.textContent = "";
      onRun(task.id, note);
      // Re-enabled on next board refresh; keep the button dead until then to avoid double-runs.
    });
    const actions = el("div", "dispatch-task__actions");
    actions.appendChild(runBtn);
    actions.appendChild(note);
    row.appendChild(head);
    row.appendChild(meta);
    row.appendChild(actions);
    section.appendChild(row);
  }
  return section;
}

function renderRun(run: DispatchRunView, onCancel: (runId: string) => void): HTMLElement {
  const row = el("div", `dispatch-run dispatch-run--${run.status}`);
  const head = el("div", "dispatch-run__head");
  head.appendChild(el("span", "dispatch-run__name", run.taskName));
  head.appendChild(el("span", `dispatch-run__status dispatch-run__status--${run.status}`, RUN_STATUS_LABEL[run.status]));
  if (run.verified) head.appendChild(el("span", "dispatch-run__verified", "đã xác minh"));
  row.appendChild(head);

  const meta = el(
    "div",
    "dispatch-run__meta",
    `${run.runId} · ${LOOP_MODE_LABEL[run.loopMode]} · lượt ${run.attempts}${run.reason !== undefined ? ` · ${run.reason}` : ""}`,
  );
  row.appendChild(meta);

  for (const branch of run.branches) {
    const branchRow = el("div", `dispatch-branch dispatch-branch--${branch.status}`);
    branchRow.appendChild(el("span", "dispatch-branch__agent", branch.agentName));
    branchRow.appendChild(el("span", "dispatch-branch__status", BRANCH_STATUS_LABEL[branch.status]));
    if (branch.summary !== undefined) {
      branchRow.appendChild(el("span", "dispatch-branch__summary", branch.summary));
    }
    row.appendChild(branchRow);
  }

  if (run.status === "running") {
    const cancelBtn = el("button", "dispatch-btn dispatch-btn--danger", "Hủy");
    cancelBtn.addEventListener("click", () => {
      cancelBtn.disabled = true;
      onCancel(run.runId);
    });
    row.appendChild(cancelBtn);
  }
  return row;
}

/**
 * Replace `body` with the current dispatch catalog + runs. Never throws: an unreachable service
 * renders an honest note. Re-polls while a run is live and `body` stays connected to the DOM.
 */
export async function renderDispatchBoard(
  client: DispatchBoardClient,
  body: HTMLElement,
  gate: DispatchRunGate = DISPATCH_RUN_READY,
): Promise<void> {
  let tasks: readonly DispatchTaskView[];
  let runs: readonly DispatchRunView[];
  try {
    [tasks, runs] = await Promise.all([client.listDispatchTasks(), client.listDispatchRuns()]);
  } catch {
    body.replaceChildren(el("p", "dispatch-note", "Không đọc được danh sách dispatch từ service."));
    return;
  }

  const refresh = (): void => {
    if (!body.isConnected) return;
    void renderDispatchBoard(client, body, gate);
  };

  const tasksSection = renderTasks(tasks, gate, (taskId, note) => {
    void client
      .runDispatchTask(taskId)
      .then(() => refresh())
      .catch((err: unknown) => {
        note.textContent = err instanceof Error ? err.message : "Không chạy được task.";
      });
  });

  const runsSection = el("div", "dispatch-section");
  runsSection.appendChild(el("div", "dispatch-section__label", "Lượt chạy"));
  if (runs.length === 0) {
    runsSection.appendChild(el("p", "dispatch-note", "Chưa có lượt chạy nào."));
  }
  for (const run of runs) {
    runsSection.appendChild(
      renderRun(run, (runId) => {
        void client.cancelDispatchRun(runId).then(refresh, refresh);
      }),
    );
  }

  body.replaceChildren(tasksSection, runsSection);

  // Live refresh only while something is actually running — no idle polling forever.
  if (runs.some((r) => r.status === "running")) {
    setTimeout(refresh, POLL_MS);
  }
}
