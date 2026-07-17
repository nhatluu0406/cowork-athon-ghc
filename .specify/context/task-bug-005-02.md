<!-- task=TASK-BUG-005-02 tokens~11376 -->


---
## TASK

# Task: TASK-BUG-005-02


---
## ACCEPTANCE CRITERIA

- [ ] Determined where tool results are stored
- [ ] Identified Go struct type for tool results
- [ ] Identified query method
- [ ] Documented findings in `specs/BUG-005/data-source-findings.md`

---
## CODE SCOPE

<!-- 3 files -->

### src/Backend/internal/metadata/schema.go
```
package metadata

const schemaSQL = `
-- Table: repos
CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    product_id INTEGER,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'service' CHECK(role IN ('backend', 'frontend', 'infra', 'library', 'docs', 'other', 'service', 'integration')),
    search_weight REAL NOT NULL DEFAULT 1.0,
    active_epoch INTEGER NOT NULL DEFAULT 0,
    indexed_commit TEXT,
    pipeline_version TEXT NOT NULL,
    embed_model_id TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repos_active_epoch ON repos(active_epoch);
CREATE INDEX IF NOT EXISTS idx_repos_product_id ON repos(product_id);

-- Table: files
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('doc', 'code', 'ops')),
    language TEXT,
    blob_hash TEXT NOT NULL,
    loc INTEGER,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, path)
);

CREATE INDEX IF NOT EXISTS idx_files_repo_epoch ON files(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_files_repo_epoch_path ON files(repo_id, epoch, path);
CREATE INDEX IF NOT EXISTS idx_files_blob_hash ON files(blob_hash);

-- Table: symbols
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    symbol_key TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('function', 'class', 'interface', 'method', 'struct', 'enum', 'variable', 'constant')),
    signature TEXT,
    visibility TEXT CHECK(visibility IN ('public', 'private', 'internal', 'protected')),
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, symbol_key)
);

CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch ON symbols(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch_file ON symbols(repo_id, epoch, file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch_qname ON symbols(repo_id, epoch, qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_content_hash ON symbols(content_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name);

-- Table: relations
CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    from_symbol_key TEXT NOT NULL,
    to_symbol_key TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('imports', 'extends', 'implements', 'calls', 'references', 'instantiates')),
    evidence_file_id INTEGER,
    evidence_span TEXT,
    relation_hash TEXT NOT NULL,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_file_id) REFERENCES files(id) ON DELETE SET NULL,
    UNIQUE(repo_id, epoch, from_symbol_key, to_symbol_key, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_repo_epoch ON relations(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(repo_id, epoch, from_symbol_key);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(repo_id, epoch, to_symbol_key);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(repo_id, epoch, relation_type);
CREATE INDEX IF NOT EXISTS idx_relations_from_epoch ON relations(from_symbol_key, repo_id, epoch);

-- Table: documents
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    blob_hash TEXT NOT NULL,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, path)
);

CREATE INDEX IF NOT EXISTS idx_documents_repo_epoch ON documents(repo_id, epoch);

-- Table: uploads
CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id TEXT NOT NULL UNIQUE,
    repo_id INTEGER NOT NULL,
    user_id TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_type TEXT,
    target_path TEXT NOT NULL,
    git_commit_hash TEXT,
    git_commit_message TEXT,
    index_job_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'uploaded', 'committed', 'indexed', 'failed')),
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uploads_repo_id ON uploads(repo_id);
CREATE INDEX IF NOT EXISTS idx_uploads_upload_id ON uploads(upload_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at);

-- Table: upload_settings
CREATE TABLE IF NOT EXISTS upload_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    auto_commit INTEGER NOT NULL DEFAULT 1,
    auto_push INTEGER NOT NULL DEFAULT 0,
    auto_index INTEGER NOT NULL DEFAULT 1,
    max_file_size INTEGER NOT NULL DEFAULT 10485760,
    allowed_extensions TEXT, -- JSON array
    default_branch TEXT NOT NULL DEFAULT 'main',
    commit_message_template TEXT NOT NULL DEFAULT 'Upload: {{filename}}',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id)
);

CREATE INDEX IF NOT EXISTS idx_upload_settings_repo_id ON upload_settings(repo_id);
CREATE INDEX IF NOT EXISTS idx_documents_blob_hash ON documents(blob_hash);

-- Table: chunks
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    doc_path TEXT NOT NULL,
    chunk_key TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    heading_path TEXT,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, chunk_key)
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo_epoch ON chunks(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_path ON chunks(repo_id, epoch, doc_path);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_path_epoch ON chunks(doc_path, repo_id, epoch);

-- Table: embedding_items
CREATE TABLE IF NOT EXISTS embedding_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('doc_chunk', 'symbol', 'relation')),
    stable_key TEXT NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embed_model_id TEXT NOT NULL,
    vector_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'failed')),
    error TEXT,
    quality_score REAL DEFAULT 0.0,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, item_type, stable_key, embed_model_id)
);

CREATE INDEX IF NOT EXISTS idx_embedding_items_repo_epoch ON embedding_items(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_embedding_items_status ON embedding_items(repo_id, epoch, status);
CREATE INDEX IF NOT EXISTS idx_embedding_items_vector_key ON embedding_items(vector_key);

-- Table: index_jobs (extended for REQ-007 v1.1 manual trigger)
CREATE TABLE IF NOT EXISTS index_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    finished_at DATETIME,
    old_commit TEXT,
    new_commit TEXT,
    target_epoch INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'validating', 'publishing', 'done', 'failed')),
    error TEXT,

    -- REQ-007 v1.1: Manual trigger support
    progress INTEGER DEFAULT 0,
    current_file TEXT,
    files_processed INTEGER DEFAULT 0,
    files_total INTEGER DEFAULT 0,
    symbols_found INTEGER DEFAULT 0,
    triggered_by TEXT DEFAULT 'auto',
    user_email TEXT,
    config_json TEXT,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_index_jobs_repo_status ON index_jobs(repo_id, status);
CREATE INDEX IF NOT EXISTS idx_index_jobs_created ON index_jobs(created_at DESC);

-- Table: settings
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('repository', 'indexing', 'embedding', 'vectordb', 'server')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK(value_type IN ('string', 'int', 'bool', 'json')),
    description TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(category, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

-- Table: job_logs
CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    context TEXT,

    FOREIGN KEY (job_id) REFERENCES index_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id, timestamp);

-- Table: token_stats (LLM token usage tracking)
CREATE TABLE IF NOT EXISTS token_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
    provider TEXT NOT NULL DEFAULT 'anthropic',
    total_tokens INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cached_tokens INTEGER DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_stats_created_at ON token_stats(created_at);
CREATE INDEX IF NOT EXISTS idx_token_stats_provider ON token_stats(provider);

-- Table: audit_log (API operation audit trail)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'partial')),
    status_code INTEGER,
    details TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_status ON audit_log(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource);

-- Table: audit_event (Detailed audit events)
CREATE TABLE IF NOT EXISTS audit_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_log_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (audit_log_id) REFERENCES audit_log(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_event_audit_log_id ON audit_event(audit_log_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_event(event_type);

-- Table: users (JWT authentication)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until DATETIME
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until);

-- Table: password_history (Track last 5 passwords per user)
CREATE TABLE IF NOT EXISTS password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id, created_at DESC);

-- Table: auth_tokens (JWT token blacklist for revocation)
CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_type TEXT NOT NULL CHECK(token_type IN ('access', 'refresh')),
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token_hash ON auth_tokens(token_hash);

-- Table: login_attempts (Rate limiting and brute force protection)
CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    success INTEGER NOT NULL CHECK(success IN (0, 1)),
    user_agent TEXT,
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_attempted_at ON login_attempts(email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_attempted_at ON login_attempts(ip_address, attempted_at DESC);

-- ============================================================================
-- REQ-011: Multi-Repository Product Management Tables
-- ============================================================================

-- Table: products (REQ-011)
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'maintenance')),
    tags TEXT, -- JSON array of tags
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- Table: product_index_jobs (REQ-011)
CREATE TABLE IF NOT EXISTS product_index_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'indexing', 'analyzing', 'completed', 'error')),
    total_repos INTEGER NOT NULL DEFAULT 0,
    completed_repos INTEGER NOT NULL DEFAULT 0,
    failed_repos INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER,
    triggered_by TEXT DEFAULT 'manual',
    user_email TEXT,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_index_jobs_product_id ON product_index_jobs(product_id);
CREATE INDEX IF NOT EXISTS idx_product_index_jobs_status ON product_index_jobs(status);
CREATE INDEX IF NOT EXISTS idx_product_index_jobs_created_at ON product_index_jobs(created_at DESC);

-- Table: product_cross_edges (REQ-011)
CREATE TABLE IF NOT EXISTS product_cross_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    from_repo_id INTEGER NOT NULL,
    from_symbol_key TEXT NOT NULL,
    to_repo_id INTEGER NOT NULL,
    to_symbol_key TEXT NOT NULL,
    edge_type TEXT NOT NULL CHECK(edge_type IN ('lib_import', 'api_call', 'type_ref', 'config_ref')),
    confidence REAL NOT NULL DEFAULT 1.0,
    epoch_snapshot TEXT, -- JSON with from_epoch and to_epoch
    detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (from_repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (to_repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(product_id, from_repo_id, from_symbol_key, to_repo_id, to_symbol_key, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_product_cross_edges_product_id ON product_cross_edges(product_id);
CREATE INDEX IF NOT EXISTS idx_product_cross_edges_from_repo ON product_cross_edges(from_repo_id);
CREATE INDEX IF NOT EXISTS idx_product_cross_edges_to_repo ON product_cross_edges(to_repo_id);
CREATE INDEX IF NOT EXISTS idx_product_cross_edges_edge_type ON product_cross_edges(edge_type);

-- Table: product_conflicts (REQ-011)
CREATE TABLE IF NOT EXISTS product_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    from_repo_id INTEGER NOT NULL,
    to_repo_id INTEGER NOT NULL,
    conflict_type TEXT NOT NULL CHECK(conflict_type IN (
        'circular_dependency',
        'api_contract_mismatch',
        'shared_lib_version_conflict',
        'config_value_conflict',
        'type_definition_conflict'
    )),
    severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'ignored', 'wontfix')),
    from_claim TEXT,
    to_claim TEXT,
    description TEXT,
    resolution_note TEXT,
    detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by TEXT,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (from_repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (to_repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_conflicts_product_id ON product_conflicts(product_id);
CREATE INDEX IF NOT EXISTS idx_product_conflicts_type ON product_conflicts(conflict_type);
CREATE INDEX IF NOT EXISTS idx_product_conflicts_severity ON product_conflicts(severity);
CREATE INDEX IF NOT EXISTS idx_product_conflicts_status ON product_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_product_conflicts_detected_at ON product_conflicts(detected_at DESC);

-- Table: product_knowledge_docs (REQ-011)
CREATE TABLE IF NOT EXISTS product_knowledge_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL CHECK(doc_type IN (
        'product_index',
        'api_contracts',
        'shared_lib_usage',
        'cross_analysis'
    )),
    file_path TEXT NOT NULL,
    content_hash TEXT,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'generated', 'error')),
    error_message TEXT,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, doc_type, file_path)
);

CREATE INDEX IF NOT EXISTS idx_product_knowledge_docs_product_id ON product_knowledge_docs(product_id);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_docs_type ON product_knowledge_docs(doc_type);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_docs_status ON product_knowledge_docs(status);

-- Graph tables (FR-04: Graph Generation Integration)
-- Table: graph_nodes — stores code graph nodes per epoch
CREATE TABLE IF NOT EXISTS graph_nodes (
    node_id TEXT PRIMARY KEY,               -- format: "epoch:{epoch}:node:{qualified_name}"
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    qualified_name TEXT NOT NULL,           -- e.g., "pkg.service.UserService.Create"
    node_type TEXT NOT NULL,                -- function, method, class, interface, struct
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    domain TEXT,                            -- auth, payment, user, admin
    layer TEXT,                             -- api, service, repository, model
    quality_score REAL DEFAULT 0.0,
    metadata_json TEXT,                     -- JSON: {"complexity": 5, "lines": 100, ...}
    created_at INTEGER DEFAULT (strftime('%s', 'now')),

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,

    -- Ensure qualified_name is unique per epoch
    UNIQUE(repo_id, epoch, qualified_name)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_epoch ON graph_nodes(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_qualified ON graph_nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_domain ON graph_nodes(domain);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_quality ON graph_nodes(quality_score);

-- Table: graph_edges — stores code graph edges per epoch
CREATE TABLE IF NOT EXISTS graph_edges (
    edge_id TEXT PRIMARY KEY,               -- format: "epoch:{epoch}:edge:{from}:{to}:{type}"
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    from_node_id TEXT NOT NULL,             -- references graph_nodes.node_id
    to_node_id TEXT NOT NULL,               -- references graph_nodes.node_id
    edge_type TEXT NOT NULL,                -- calls, imports, inherits, implements, uses
    weight REAL DEFAULT 1.0,                -- call frequency or importance
    is_unresolved BOOLEAN DEFAULT 0,        -- true if to_node not found in codebase
    metadata_json TEXT,                     -- JSON: {"call_sites": [...], "line": 42, ...}
    created_at INTEGER DEFAULT (strftime('%s', 'now')),

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,

    -- Prevent duplicate edges between same nodes for same type
    UNIQUE(repo_id, epoch, from_node_id, to_node_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_epoch ON graph_edges(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_unresolved ON graph_edges(is_unresolved);

-- Table: graph_stats — stores aggregate stats per epoch
CREATE TABLE IF NOT EXISTS graph_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    cycle_count INTEGER NOT NULL,
    unresolved_edge_count INTEGER NOT NULL,
    avg_out_degree REAL,                    -- average outgoing edges per node
    avg_in_degree REAL,                     -- average incoming edges per node
    max_depth INTEGER,                      -- maximum call depth
    build_duration_ms INTEGER,              -- time to build graph in milliseconds
    created_at INTEGER DEFAULT (strftime('%s', 'now')),

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_graph_stats_epoch ON graph_stats(repo_id, epoch);

-- Table: graph_circular_deps — stores detected cycles
CREATE TABLE IF NOT EXISTS graph_circular_deps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    cycle_path TEXT NOT NULL,               -- JSON array: ["NodeA", "NodeB", "NodeC", "NodeA"]
    cycle_length INTEGER NOT NULL,          -- number of nodes in cycle
    severity TEXT DEFAULT 'medium',         -- low, medium, high, critical
    detected_at INTEGER DEFAULT (strftime('%s', 'now')),

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_circular_epoch ON graph_circular_deps(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_graph_circular_severity ON graph_circular_deps(severity);

-- Table: schema_migrations (REQ-011)
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    installed_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_time INTEGER, -- milliseconds
    success INTEGER NOT NULL DEFAULT 1
);

-- Triggers
CREATE TRIGGER IF NOT EXISTS update_repos_timestamp
AFTER UPDATE ON repos
BEGIN
    UPDATE repos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
AFTER UPDATE ON settings
BEGIN
    UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_token_stats_timestamp
AFTER UPDATE ON token_stats
BEGIN
    UPDATE token_stats SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Table: repo_exclusion_patterns (REQ-019)
-- Stores per-repository gitignore-style exclusion patterns.
CREATE TABLE IF NOT EXISTS repo_exclusion_patterns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id    INTEGER NOT NULL,
    pattern    TEXT    NOT NULL,
    created_by TEXT    NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, pattern)
);

CREATE INDEX IF NOT EXISTS idx_repo_excl_repo_id ON repo_exclusion_patterns(repo_id);

CREATE TRIGGER IF NOT EXISTS update_repo_excl_timestamp
AFTER UPDATE ON repo_exclusion_patterns
BEGIN
    UPDATE repo_exclusion_patterns SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
`

func (db *sqliteDB) initSchema() error {
	_, err := db.conn.Exec(schemaSQL)
	if err != nil {
		return err
	}

	// Ensure initial token_stats record exists
	_, err = db.conn.Exec(`
		INSERT OR IGNORE INTO token_stats (model_id, provider, total_tokens, input_tokens, output_tokens, cached_tokens)
		VALUES ('claude-3-5-sonnet-20241022', 'anthropic', 0, 0, 0, 0)
	`)

	return err
}
```

### src/Backend/internal/req3/websocket/build_stream_tools.go
```
package websocket

import (
	"context"
	"fmt"
)

// BuildStreamMCPTools provides MCP (Model Context Protocol) tool definitions for build streaming
type BuildStreamMCPTools struct {
	streamMgr *BuildStreamManager
}

// NewBuildStreamMCPTools creates a new MCP tools instance
func NewBuildStreamMCPTools(streamMgr *BuildStreamManager) *BuildStreamMCPTools {
	return &BuildStreamMCPTools{
		streamMgr: streamMgr,
	}
}

// MCPToolDefinition represents an MCP tool that can be called by AI models
type MCPToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// ToolResult represents the result of calling an MCP tool
type ToolResult struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// GetToolDefinitions returns all available build stream MCP tool definitions
func (bst *BuildStreamMCPTools) GetToolDefinitions() []MCPToolDefinition {
	return []MCPToolDefinition{
		{
			Name:        "subscribe_build_stream",
			Description: "Subscribe a client to a specific job's build output stream",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"client_id": map[string]interface{}{
						"type":        "string",
						"description": "Unique identifier for the client subscribing to the stream",
					},
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to subscribe to",
					},
				},
				"required": []string{"client_id", "job_id"},
			},
		},
		{
			Name:        "unsubscribe_build_stream",
			Description: "Unsubscribe a client from a job's build output stream",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"client_id": map[string]interface{}{
						"type":        "string",
						"description": "Unique identifier for the client unsubscribing",
					},
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to unsubscribe from",
					},
				},
				"required": []string{"client_id", "job_id"},
			},
		},
		{
			Name:        "publish_build_output",
			Description: "Publish a line of build output to all subscribers of a job",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to publish output for",
					},
					"line": map[string]interface{}{
						"type":        "string",
						"description": "Output line to publish",
					},
					"level": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"INFO", "WARN", "ERROR"},
						"description": "Log level (INFO, WARN, ERROR)",
					},
				},
				"required": []string{"job_id", "line"},
			},
		},
		{
			Name:        "publish_build_progress",
			Description: "Publish build progress to all subscribers (0-100%)",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to publish progress for",
					},
					"progress": map[string]interface{}{
						"type":        "integer",
						"minimum":     0,
						"maximum":     100,
						"description": "Progress percentage (0-100)",
					},
				},
				"required": []string{"job_id", "progress"},
			},
		},
		{
			Name:        "publish_build_event",
			Description: "Publish a structured build event (started, completed, error, etc)",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to publish event for",
					},
					"event_type": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"build.started", "build.completed", "build.error"},
						"description": "Type of event (started, completed, error)",
					},
					"message": map[string]interface{}{
						"type":        "string",
						"description": "Event message or description",
					},
					"exit_code": map[string]interface{}{
						"type":        "integer",
						"description": "Exit code (for build.completed events)",
					},
				},
				"required": []string{"job_id", "event_type"},
			},
		},
		{
			Name:        "get_stream_status",
			Description: "Get the current status of a build stream (active subscribers, event type)",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to get status for",
					},
				},
				"required": []string{"job_id"},
			},
		},
		{
			Name:        "get_active_streams",
			Description: "Get list of all currently active build streams",
			InputSchema: map[string]interface{}{
				"type": "object",
			},
		},
		{
			Name:        "cleanup_job_stream",
			Description: "Cleanup all subscribers and resources for a completed job",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to cleanup",
					},
				},
				"required": []string{"job_id"},
			},
		},
	}
}

// CallTool executes an MCP tool by name with the given arguments
func (bst *BuildStreamMCPTools) CallTool(ctx context.Context, toolName string, args map[string]interface{}) ToolResult {
	switch toolName {
	case "subscribe_build_stream":
		return bst.toolSubscribeBuildStream(ctx, args)
	case "unsubscribe_build_stream":
		return bst.toolUnsubscribeBuildStream(ctx, args)
	case "publish_build_output":
		return bst.toolPublishBuildOutput(ctx, args)
	case "publish_build_progress":
		return bst.toolPublishBuildProgress(ctx, args)
	case "publish_build_event":
		return bst.toolPublishBuildEvent(ctx, args)
	case "get_stream_status":
		return bst.toolGetStreamStatus(ctx, args)
	case "get_active_streams":
		return bst.toolGetActiveStreams(ctx, args)
	case "cleanup_job_stream":
		return bst.toolCleanupJobStream(ctx, args)
	default:
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("unknown tool: %s", toolName),
		}
	}
}

func (bst *BuildStreamMCPTools) toolSubscribeBuildStream(ctx context.Context, args map[string]interface{}) ToolResult {
	clientID, ok := args["client_id"].(string)
	if !ok {
		return ToolResult{Success: false, Error: "client_id must be a string"}
	}

	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	err := bst.streamMgr.SubscribeToJob(ctx, clientID, int64(jobID))
	if err != nil {
		return ToolResult{
			Success: false,
			Message: fmt.Sprintf("subscription initiated (may be delayed): %v", err),
		}
	}

	subscriberCount := bst.streamMgr.GetJobSubscriberCount(int64(jobID))

	return ToolResult{
		Success: true,
		Message: fmt.Sprintf("subscribed to job stream (subscribers: %d)", subscriberCount),
		Data: map[string]interface{}{
			"job_id":            int64(jobID),
			"subscriber_count": subscriberCount,
		},
	}
}

func (bst *BuildStreamMCPTools) toolUnsubscribeBuildStream(ctx context.Context, args map[string]interface{}) ToolResult {
	clientID, ok := args["client_id"].(string)
	if !ok {
		return ToolResult{Success: false, Error: "client_id must be a string"}
	}

	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	err := bst.streamMgr.UnsubscribeFromJob(ctx, clientID, int64(jobID))
	if err != nil {
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("unsubscribe failed: %v", err),
		}
	}

	subscriberCount := bst.streamMgr.GetJobSubscriberCount(int64(jobID))

	return ToolResult{
		Success: true,
		Message: fmt.Sprintf("unsubscribed from job stream (subscribers: %d)", subscriberCount),
		Data: map[string]interface{}{
			"job_id":            int64(jobID),
			"subscriber_count": subscriberCount,
		},
	}
}

func (bst *BuildStreamMCPTools) toolPublishBuildOutput(ctx context.Context, args map[string]interface{}) ToolResult {
	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	line, ok := args["line"].(string)
	if !ok {
		return ToolResult{Success: false, Error: "line must be a string"}
	}

	level := "INFO"
	if l, ok := args["level"].(string); ok {
		level = l
	}

	err := bst.streamMgr.PublishBuildOutput(ctx, int64(jobID), line, level)
	if err != nil {
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("publish failed: %v", err),
		}
	}

	return ToolResult{
		Success: true,
		Message: "build output published",
	}
}

func (bst *BuildStreamMCPTools) toolPublishBuildProgress(ctx context.Context, args map[string]interface{}) ToolResult {
	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	progress, ok := args["progress"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "progress must be a number"}
	}

	if progress < 0 || progress > 100 {
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("progress must be between 0 and 100, got %d", int(progress)),
		}
	}

	err := bst.streamMgr.PublishBuildProgress(ctx, int64(jobID), int(progress))
	if err != nil {
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("publish failed: %v", err),
		}
	}

	return ToolResult{
		Success: true,
		Message: fmt.Sprintf("progress published: %d%%", int(progress)),
	}
}

func (bst *BuildStreamMCPTools) toolPublishBuildEvent(ctx context.Context, args map[string]interface{}) ToolResult {
	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	eventType, ok := args["event_type"].(string)
	if !ok {
		return ToolResult{Success: false, Error: "event_type must be a string"}
	}

	message, _ := args["message"].(string)

	var err error
	switch eventType {
	case "build.started":
		err = bst.streamMgr.PublishBuildStarted(ctx, int64(jobID), nil)

	case "build.completed":
		exitCode := 0
		if ec, ok := args["exit_code"].(float64); ok {
			exitCode = int(ec)
		}
		err = bst.streamMgr.PublishBuildCompleted(ctx, int64(jobID), exitCode)

	case "build.error":
		if message == "" {
			message = "Build error occurred"
		}
		err = bst.streamMgr.PublishBuildError(ctx, int64(jobID), message)

	default:
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("unknown event type: %s", eventType),
		}
	}

	if err != nil {
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("publish failed: %v", err),
		}
	}

	return ToolResult{
		Success: true,
		Message: fmt.Sprintf("event published: %s", eventType),
	}
}

func (bst *BuildStreamMCPTools) toolGetStreamStatus(ctx context.Context, args map[string]interface{}) ToolResult {
	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	subscriberCount := bst.streamMgr.GetJobSubscriberCount(int64(jobID))

	return ToolResult{
		Success: true,
		Data: map[string]interface{}{
			"job_id":            int64(jobID),
			"is_active":         subscriberCount > 0,
			"subscriber_count": subscriberCount,
		},
	}
}

func (bst *BuildStreamMCPTools) toolGetActiveStreams(ctx context.Context, args map[string]interface{}) ToolResult {
	activeJobs := bst.streamMgr.GetActiveJobs()
	streams := make([]map[string]interface{}, 0, len(activeJobs))

	for _, jobID := range activeJobs {
		subscriberCount := bst.streamMgr.GetJobSubscriberCount(jobID)
		streams = append(streams, map[string]interface{}{
			"job_id":            jobID,
			"is_active":         subscriberCount > 0,
			"subscriber_count": subscriberCount,
		})
	}

	return ToolResult{
		Success: true,
		Data: map[string]interface{}{
			"active_jobs": streams,
			"total_count": len(streams),
		},
	}
}

func (bst *BuildStreamMCPTools) toolCleanupJobStream(ctx context.Context, args map[string]interface{}) ToolResult {
	jobID, ok := args["job_id"].(float64)
	if !ok {
		return ToolResult{Success: false, Error: "job_id must be a number"}
	}

	err := bst.streamMgr.CleanupJobSubscriptions(ctx, int64(jobID))
	if err != nil {
		return ToolResult{
			Success: false,
			Error:   fmt.Sprintf("cleanup failed: %v", err),
		}
	}

	return ToolResult{
		Success: true,
		Message: fmt.Sprintf("cleanup completed for job %d", int64(jobID)),
	}
}
```

### src/Backend/internal/req3/websocket/types.go
```
// Package websocket provides real-time job streaming with resilient reconnection.
package websocket

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

// Message represents a WebSocket message to be transmitted.
type Message struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // "job.started", "index.progress", etc.
	Payload   []byte    `json:"payload"`
	Timestamp time.Time `json:"timestamp"`
	Priority  int       `json:"priority"` // 0=lowest, 2=highest
}

// WebSocketMetrics tracks performance and connection statistics.
type WebSocketMetrics struct {
	ActiveConnections    int64
	TotalConnections     int64
	TotalMessages        int64
	TotalBytes           int64
	ReconnectionAttempts int64
	AverageBackoffDelay  time.Duration
	P95BackoffDelay      time.Duration
	P99BackoffDelay      time.Duration
}

// ConnectionStats tracks per-user statistics.
type ConnectionStats struct {
	UserID            string
	ClientID          string
	ConnectedSince    time.Time
	MessageCount      int64
	BytesSent         int64
	BytesReceived     int64
	LastMessageTime   time.Time
	ReconnectionCount int
}

// ReconnectBackoff implements exponential backoff with jitter per RFC 3164.
type ReconnectBackoff struct {
	initialDelay   time.Duration // 1s
	maxDelay       time.Duration // 60s
	multiplier     float64       // 1.5
	jitterFraction float64       // 0.1 (±10%)

	attempt   int
	lastDelay time.Duration
}

// NewReconnectBackoff creates a new backoff calculator.
func NewReconnectBackoff() *ReconnectBackoff {
	return &ReconnectBackoff{
		initialDelay:   1 * time.Second,
		maxDelay:       60 * time.Second,
		multiplier:     1.5,
		jitterFraction: 0.1,
		attempt:        0,
		lastDelay:      0,
	}
}

// NextDelay returns the next backoff delay and increments the attempt counter.
func (rb *ReconnectBackoff) NextDelay() time.Duration {
	if rb.attempt == 0 {
		rb.lastDelay = rb.initialDelay
	} else {
		// Exponential: delay * multiplier
		nextDelay := time.Duration(float64(rb.lastDelay) * rb.multiplier)
		if nextDelay > rb.maxDelay {
			nextDelay = rb.maxDelay
		}
		rb.lastDelay = nextDelay
	}

	// Add jitter: ±10%
	// For now, return base delay (jitter added at call site for testability)
	rb.attempt++
	return rb.lastDelay
}

// Reset resets the backoff to initial state.
func (rb *ReconnectBackoff) Reset() {
	rb.attempt = 0
	rb.lastDelay = 0
}

// GetAttempt returns the current attempt number.
func (rb *ReconnectBackoff) GetAttempt() int {
	return rb.attempt
}

// HeartbeatConfig configures heartbeat parameters.
type HeartbeatConfig struct {
	Interval           time.Duration // 30s (send ping)
	Timeout            time.Duration // 60s (expect pong)
	MissThreshold      int           // 2 (missed pongs → reconnect)
	MaxConcurrentPings int           // Prevent pileup
}

// DefaultHeartbeatConfig returns RFC 6455-compliant defaults.
func DefaultHeartbeatConfig() HeartbeatConfig {
	return HeartbeatConfig{
		Interval:           30 * time.Second,
		Timeout:            60 * time.Second,
		MissThreshold:      2,
		MaxConcurrentPings: 1,
	}
}

// ConnectionState represents the current connection state.
type ConnectionState string

const (
	StateConnecting   ConnectionState = "CONNECTING"
	StateConnected    ConnectionState = "CONNECTED"
	StateHeartbeat    ConnectionState = "HEARTBEAT"
	StateDisconnected ConnectionState = "DISCONNECTED"
	StateReconnecting ConnectionState = "RECONNECTING"
)

// HeartbeatMachine implements RFC 6455 heartbeat protocol.
type HeartbeatMachine struct {
	state            ConnectionState
	config           HeartbeatConfig
	lastPingSent     time.Time
	lastPongReceived time.Time
	missedPongs      int
	pongChan         chan struct{}
	ctx              context.Context
	cancel           context.CancelFunc
}

// NewHeartbeatMachine creates a new heartbeat state machine.
func NewHeartbeatMachine(config HeartbeatConfig) *HeartbeatMachine {
	ctx, cancel := context.WithCancel(context.Background())
	return &HeartbeatMachine{
		state:    StateConnecting,
		config:   config,
		pongChan: make(chan struct{}, config.MaxConcurrentPings),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// GetState returns the current connection state.
func (hm *HeartbeatMachine) GetState() ConnectionState {
	return hm.state
}

// UpdateState updates the connection state.
func (hm *HeartbeatMachine) UpdateState(state ConnectionState) error {
	hm.state = state
	return nil
}

// HandlePong records a pong response.
func (hm *HeartbeatMachine) HandlePong(appData []byte) {
	select {
	case hm.pongChan <- struct{}{}:
		hm.lastPongReceived = time.Now()
		hm.missedPongs = 0
	default:
		// Pong queue full; ignore (rare)
	}
}

// Close closes the heartbeat machine.
func (hm *HeartbeatMachine) Close() error {
	hm.cancel()
	return nil
}

// HybridMessageQueue provides in-memory + WAL spillover for message storage.
type HybridMessageQueue struct {
	memQueue  chan *Message // 10K capacity
	memBuffer []*Message    // Backup buffer
	walDB     *sql.DB       // Spillover storage
	maxMemory int           // 10,000 messages
	maxWAL    int           // 200,000 messages in WAL
	memCount  int64
	walCount  int64
	spillover int64
}

// NewHybridMessageQueue creates a new hybrid queue.
func NewHybridMessageQueue(db *sql.DB) *HybridMessageQueue {
	return &HybridMessageQueue{
		memQueue:  make(chan *Message, 10000),
		memBuffer: make([]*Message, 0, 10000),
		walDB:     db,
		maxMemory: 10000,
		maxWAL:    200000,
	}
}

// MessageQueueStats provides queue statistics.
type MessageQueueStats struct {
	MemCount  int64
	WALCount  int64
	Spillover int64
	MemUsage  float64 // Percentage
	WALUsage  float64 // Percentage
}

// GetStats returns current queue statistics.
func (q *HybridMessageQueue) GetStats() MessageQueueStats {
	return MessageQueueStats{
		MemCount:  q.memCount,
		WALCount:  q.walCount,
		Spillover: q.spillover,
		MemUsage:  float64(q.memCount) / float64(q.maxMemory) * 100,
		WALUsage:  float64(q.walCount) / float64(q.maxWAL) * 100,
	}
}
```