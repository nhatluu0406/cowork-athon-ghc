-- Rollback: local folder import schema

DROP INDEX IF EXISTS idx_chunks_source_type;
DROP INDEX IF EXISTS idx_chunks_local_file_id;

ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_source_xor;

-- Local-only chunks have file_id NULL; they cannot survive the restored NOT NULL, and their
-- source (local import) is being removed, so delete them before dropping the column.
DELETE FROM chunks WHERE file_id IS NULL;

ALTER TABLE chunks DROP COLUMN IF EXISTS local_file_id;

ALTER TABLE chunks ALTER COLUMN file_id SET NOT NULL;

DROP INDEX IF EXISTS idx_local_files_content_hash;
DROP INDEX IF EXISTS idx_local_files_source_id;

DROP TABLE IF EXISTS local_files;

DROP INDEX IF EXISTS uq_import_jobs_active;
DROP INDEX IF EXISTS idx_import_jobs_status;
DROP INDEX IF EXISTS idx_import_jobs_source_id;

DROP TABLE IF EXISTS import_jobs;

DROP INDEX IF EXISTS idx_local_sources_enabled;

DROP TABLE IF EXISTS local_sources;
