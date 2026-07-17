/**
 * Public surface of the M365KG stack module (ADR 0010), exposed to consumers outside
 * `@cowork-ghc/service` (namely `app/shell`, which owns the child-process lifecycle for the
 * Electron main process) via the `./knowledge/stack` package export — the same pattern already
 * used for `./knowledge/types` in `package.json`. Purely additive: no existing file in this
 * directory is modified to produce this barrel.
 */

export {
  M365KGStackSupervisor,
  type StackSupervisorSecrets,
  type StackSupervisorOptions,
  type StackIdentities,
} from "./stack-supervisor.js";

export {
  type StackPaths,
  type StackPorts,
  postgresRole,
  neo4jRole,
  llmSvcRole,
  backendRole,
} from "./stack-roles.js";

export {
  M365KGStackInitializer,
  StackInitError,
  nodeCommandRunner,
  type CommandRunner,
  type CommandResult,
  type SupervisorFactory,
  type StackInitializerOptions,
} from "./stack-initializer.js";

export {
  isAlreadyProvisioned,
  type DownloadArtifact,
  type FetchLike,
  ChecksumMismatchError,
  DownloadFailedError,
  ExtractionEscapeError,
} from "./provisioning.js";
