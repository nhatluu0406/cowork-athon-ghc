-- Local folder import schema
-- Enables indexing of local filesystem documents (PDF, DOCX, XLSX, TXT, MD)
-- alongside existing M365 content in the knowledge graph

-- Table: local_sources
-- Stores configured local folder sources as document sources
CREATE TABLE IF NOT EXISTS local_sources (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    folder_path     TEXT        NOT NULL,
    recursive       BOOLEAN     NOT NULL DEFAULT true,
    include_ext     TEXT[],
    exclude_ext     TEXT[],
    hidden_files    BOOLEAN     NOT NULL DEFAULT false,
    follow_symlinks BOOLEAN     NOT NULL DEFAULT false,
    max_depth       INT         NOT NULL DEFAULT 100,
    enabled         BOOLEAN     NOT NULL DEFAULT true,
    status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unavailable')),
    last_sync_at    TIMESTAMPTZ,
    file_count      INT         NOT NULL DEFAULT 0,
    total_size      BIGINT      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_folder_path UNIQUE (folder_path)
);

CREATE INDEX IF NOT EXISTS idx_local_sources_enabled ON local_sources(enabled);

-- Table: import_jobs
-- Tracks execution of import operations for each source
CREATE TABLE IF NOT EXISTS import_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID        NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
    status          TEXT        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stale')),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    files_total     INT         NOT NULL DEFAULT 0,
    files_added     INT         NOT NULL DEFAULT 0,
    files_modified  INT         NOT NULL DEFAULT 0,
    files_deleted   INT         NOT NULL DEFAULT 0,
    files_skipped   INT         NOT NULL DEFAULT 0,
    files_binary    INT         NOT NULL DEFAULT 0,
    error_messages  TEXT[],
    progress_pct    INT         NOT NULL DEFAULT 0
                    CHECK (progress_pct >= 0 AND progress_pct <= 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_source_id ON import_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status    ON import_jobs(status) WHERE status IN ('queued', 'running');

-- At most one ACTIVE (queued or running) job per source. This is the authoritative guard against
-- concurrent imports of the same source: the HasRunning pre-check is racy (TOCTOU), so the DB
-- enforces it and ImportJobStore.Create maps the unique_violation to ErrJobAlreadyActive (HTTP 409).
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_active
    ON import_jobs(source_id) WHERE status IN ('queued', 'running');

-- Table: local_files
-- Per-file tracking for delta sync and source attribution
CREATE TABLE IF NOT EXISTS local_files (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID        NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
    rel_path        TEXT        NOT NULL,
    file_name       TEXT        NOT NULL,
    file_size       BIGINT      NOT NULL,
    mtime           TIMESTAMPTZ NOT NULL,
    mime_type       TEXT        NOT NULL DEFAULT 'application/octet-stream',
    encoding        TEXT,
    is_binary       BOOLEAN     NOT NULL DEFAULT false,
    content_hash    TEXT        NOT NULL DEFAULT '',
    chunk_count     INT         NOT NULL DEFAULT 0,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT local_files_source_path UNIQUE (source_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_local_files_source_id    ON local_files(source_id);
CREATE INDEX IF NOT EXISTS idx_local_files_content_hash ON local_files(content_hash);

-- Alter existing chunks table to support both M365 and local files
-- Add nullable local_file_id column
ALTER TABLE chunks ADD COLUMN local_file_id UUID REFERENCES local_files(id) ON DELETE CASCADE;

-- Drop NOT NULL constraint on file_id to allow local-only chunks
ALTER TABLE chunks ALTER COLUMN file_id DROP NOT NULL;

-- Add constraint to ensure each chunk belongs to exactly one source
ALTER TABLE chunks ADD CONSTRAINT chunks_source_xor
    CHECK (
        (file_id IS NOT NULL AND local_file_id IS NULL) OR
        (file_id IS NULL AND local_file_id IS NOT NULL)
    );

-- Create index for local file lookups
CREATE INDEX IF NOT EXISTS idx_chunks_local_file_id ON chunks(local_file_id) WHERE local_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_source_type   ON chunks(CASE WHEN local_file_id IS NOT NULL THEN 'local' ELSE 'm365' END);
