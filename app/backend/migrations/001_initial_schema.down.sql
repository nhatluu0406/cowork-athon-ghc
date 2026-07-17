-- Rollback Phase 2 Foundational schema

DROP TABLE IF EXISTS feedback_events CASCADE;
DROP TABLE IF EXISTS query_logs CASCADE;
DROP TABLE IF EXISTS embedding_jobs CASCADE;
DROP TABLE IF EXISTS chunk_embeddings CASCADE;
DROP INDEX IF EXISTS idx_chunk_embeddings_chunk;
DROP INDEX IF EXISTS idx_chunk_embeddings_model;
DROP TABLE IF EXISTS embedding_models CASCADE;
DROP TABLE IF EXISTS permission_cache CASCADE;
DROP TABLE IF EXISTS m365_connections CASCADE;
DROP TABLE IF EXISTS chunks CASCADE;
DROP TABLE IF EXISTS m365_files CASCADE;
DROP TABLE IF EXISTS delta_state CASCADE;
DROP TABLE IF EXISTS extraction_confidence CASCADE;
