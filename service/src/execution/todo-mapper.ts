/**
 * Maps OpenCode `todo.updated` todos onto EV1 {@link PlanTodo}s.
 *
 * Reference todo shape (read-only): `{ sessionID, todos: Todo[] }`, where a todo carries
 * an `id`, a text/content field, and a `status` drawn from the OpenCode set
 * (`pending` | `in_progress` | `completed` | `cancelled`) — see
 * apps/app/src/react-app/domains/session/sync/session-sync.ts:675-681 and the
 * `todo.status === "in_progress"` usage at
 * apps/app/src/react-app/domains/session/surface/session-surface.tsx:283.
 *
 * Only real todos are forwarded; missing fields fall back to safe, non-terminal values.
 */

import type { PlanTodo, StepStatus } from "@cowork-ghc/contracts";
import { asRecord, readString } from "./opencode-events.js";

/** OpenCode todo status → EV {@link StepStatus}. Unknown values stay `pending`. */
function todoStatus(status: string | undefined): StepStatus {
  switch (status) {
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "error":
    case "errored":
      return "errored";
    case "pending":
    default:
      return "pending";
  }
}

/** Map a raw todos array (already read off `properties.todos`) to EV1 plan todos. */
export function mapTodos(todos: readonly unknown[]): readonly PlanTodo[] {
  const out: PlanTodo[] = [];
  todos.forEach((raw, index) => {
    const todo = asRecord(raw);
    const id = readString(todo, "id") ?? `todo-${index}`;
    const title =
      readString(todo, "content") ??
      readString(todo, "text") ??
      readString(todo, "title") ??
      id;
    out.push({ id, title, status: todoStatus(readString(todo, "status")) });
  });
  return out;
}
