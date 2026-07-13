-- embedding_jobs was missing the chunk_ids payload column and updated_at
-- tracking column that internal/embedding/batch.go has always queried/written
-- against — without this, ProcessJob's SELECT/UPDATE statements fail at
-- runtime regardless of parseChunkIDs correctness.
ALTER TABLE embedding_jobs
    ADD COLUMN IF NOT EXISTS chunk_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
