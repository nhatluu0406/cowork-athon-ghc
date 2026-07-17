/**
 * `@cowork-ghc/service` knowledge module barrel (REQ-205 Phase 1).
 *
 * M365 Knowledge Graph integration: the REST client to the external, unmodified M365KG
 * backend, `.runtime/knowledge-source.json` persistence, the `/v1/knowledge/*` router, and the
 * permission-gated `m365_knowledge_search` tool. Local barrel; the composition root wires this
 * module's router + tool onto the boundary alongside every other domain router.
 */

export {
  createM365KgClient,
  M365_KNOWLEDGE_QUERY_TIMEOUT_MS,
  type KnowledgeSourceClient,
  type KnowledgeSourceClientOptions,
} from "./m365kg-client.js";

export {
  createKnowledgeSourceConfigStore,
  type KnowledgeSourceConfigStore,
  type KnowledgeSourceConfigStoreOptions,
} from "./store.js";

export {
  createKnowledgeService,
  KnowledgeConfigError,
  type KnowledgeService,
  type KnowledgeServiceOptions,
} from "./knowledge-service.js";

export {
  createKnowledgeRouter,
  KnowledgeRequestError,
  KNOWLEDGE_STATUS_PATH,
  KNOWLEDGE_CONFIGURE_PATH,
  KNOWLEDGE_TEST_CONNECTION_PATH,
  KNOWLEDGE_CONNECTION_PATH,
  KNOWLEDGE_QUERY_PATH,
  KNOWLEDGE_GRAPH_PATH,
  type ApiQueryResult,
} from "./router.js";

export {
  createKnowledgeTool,
  M365_KNOWLEDGE_TOOL_NAME,
  M365_KNOWLEDGE_ACTION_KIND,
  type KnowledgeTool,
  type KnowledgeToolOptions,
  type KnowledgeToolInput,
  type KnowledgeQueryPort,
} from "./tool.js";

export type {
  KnowledgeCitation,
  KnowledgeEntityType,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResult,
  KnowledgeHealthStatus,
  KnowledgeQueryOutcome,
  KnowledgeSourceConfig,
  KnowledgeSourceStatus,
  KnowledgeStatusView,
  KnowledgeToolOutcome,
  KnowledgeToolResult,
} from "./types.js";
export { KNOWLEDGE_PANEL_MAX_NODES, DEFAULT_KNOWLEDGE_SOURCE_CONFIG } from "./types.js";
