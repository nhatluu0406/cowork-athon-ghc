/**
 * Local Knowledge Base + Knowledge Graph (MVP) barrel.
 *
 * The LOCAL, offline knowledge subsystem built on the embedded SQLite database (FTS5 keyword search +
 * deterministic node/edge graph). Distinct from `service/src/knowledge/` (the dormant external M365
 * Knowledge Graph REST client). The composition root wires the router + service onto the boundary.
 */

export { createKnowledgeLocalRepository, buildFtsMatch, type KnowledgeLocalRepository } from "./repository.js";
export { createKnowledgeLocalService, type KnowledgeLocalService } from "./service.js";
export type {
  KnowledgeIndexView,
  KnowledgeGraphApiResult,
  KnowledgeGraphApiNode,
  KnowledgeGraphApiEdge,
} from "./types.js";
export {
  createKnowledgeLocalRouter,
  KNOWLEDGE_LOCAL_STATUS_PATH,
  KNOWLEDGE_LOCAL_SYNC_PATH,
  KNOWLEDGE_LOCAL_CANCEL_PATH,
  KNOWLEDGE_LOCAL_CLEAR_PATH,
  KNOWLEDGE_LOCAL_SEARCH_PATH,
  KNOWLEDGE_LOCAL_GRAPH_PATH,
} from "./router.js";
export { indexWorkspace, type IndexOptions, type IndexResult } from "./indexer.js";
export type {
  KnowledgeIndexStatus,
  KnowledgeSearchHit,
  KnowledgeDocumentKind,
} from "./types.js";
