-- Phase 2 Foundational: Enterprise Knowledge Graph schema

CREATE TABLE IF NOT EXISTS delta_state (
    source TEXT PRIMARY KEY,
    change_token TEXT NOT NULL,
    has_more BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS m365_files (
    id SERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    drive_id TEXT,
    file_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    content_hash TEXT,
    last_modified TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    permissions_json JSONB
);

CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    heading_path TEXT,
    UNIQUE(file_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS m365_connections (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    config_json JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permission_cache (
    user_id TEXT NOT NULL,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    permission TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, file_id)
);

CREATE TABLE IF NOT EXISTS embedding_models (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    dims INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id),
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    embedding BYTEA NOT NULL,
    embedding_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chunk_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_chunk ON chunk_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model_id);

CREATE TABLE IF NOT EXISTS embedding_jobs (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL,
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT
);

CREATE TABLE IF NOT EXISTS query_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    intent TEXT,
    results_count INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_events (
    id SERIAL PRIMARY KEY,
    query_id INTEGER NOT NULL REFERENCES query_logs(id),
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extraction_confidence (
    id SERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    feedback_score REAL,
    last_reevaluated TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
