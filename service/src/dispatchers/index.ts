/**
 * @cowork-ghc/service dispatchers — fan-out orchestration (Task 5.2) + dispatch runs wiring.
 */

export {
  createFanOutOrchestrator,
  planBranches,
  aggregateStatus,
  FanOutPlanError,
  type BranchPlan,
  type BranchRunner,
  type BranchRunResult,
  type BranchStatus,
  type BranchView,
  type FanOutOrchestratorOptions,
  type FanOutOutcome,
  type FanOutRun,
  type FanOutStatus,
} from "./fanout.js";
export {
  createDispatchRunRegistry,
  type DispatchRunRegistry,
  type DispatchRunRegistryOptions,
  type DispatchRunStatus,
  type DispatchRunView,
} from "./run-registry.js";
export {
  createDispatchRouter,
  DISPATCH_RUNS_PATH,
  DISPATCH_RUN_ITEM_PATH,
  DISPATCH_RUN_CANCEL_PATH,
  DISPATCH_TASK_RUN_PATH,
  type DispatchRouterOptions,
} from "./router.js";
export {
  createLiveBranchRunner,
  composeBranchPrompt,
  type BranchTerminal,
  type LiveBranchRunnerSeams,
} from "./live-branch-runner.js";
