/**
 * @cowork-ghc/service agents — built-in + user AgentDefinition catalog (Task 5.1).
 */

export { BUILTIN_AGENTS } from "./builtins.js";
export {
  createAgentCatalog,
  AgentCatalogError,
  type AgentCatalog,
  type AgentCatalogOptions,
  type AgentDraft,
  type AgentStoreFs,
} from "./catalog.js";
export { createAgentRouter, AGENTS_PATH, AGENT_ITEM_PATH } from "./router.js";
