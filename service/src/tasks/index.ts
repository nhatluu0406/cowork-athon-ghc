/**
 * @cowork-ghc/service tasks — built-in templates + user TaskDefinition store (Task 4.1).
 */

export { BUILTIN_TASK_TEMPLATES } from "./builtins.js";
export {
  createTaskStore,
  TaskStoreError,
  type TaskStore,
  type TaskStoreOptions,
  type TaskStoreFs,
  type TaskDraft,
} from "./store.js";
export {
  createTaskRouter,
  TASKS_PATH,
  TASK_ITEM_PATH,
  TASK_INSTANTIATE_PATH,
} from "./router.js";
export {
  startLoopRun,
  type AttemptExecutor,
  type AttemptResult,
  type AttemptStatus,
  type LoopOutcome,
  type LoopRun,
  type LoopRunnerOptions,
  type LoopTerminal,
  type VerificationHook,
} from "./loop-runner.js";
