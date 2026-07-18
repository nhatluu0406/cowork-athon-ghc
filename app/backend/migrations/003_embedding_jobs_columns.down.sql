ALTER TABLE embedding_jobs
    DROP COLUMN IF EXISTS chunk_ids,
    DROP COLUMN IF EXISTS updated_at;
