-- Migration 004: LLM Configuration Table
-- Stores runtime LLM provider configuration submitted via POST /api/llm/config
-- Single-row table (id=1) for singleton config pattern

CREATE TABLE IF NOT EXISTS llm_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton pattern: only one row allowed
    provider VARCHAR(50) NOT NULL,          -- "openai", "anthropic", "azure", "custom", "fptcloud"
    base_url TEXT NOT NULL DEFAULT '',      -- Provider API base URL (SSRF validated in handlers_llm.go)
    api_key TEXT NOT NULL DEFAULT '',       -- API key (encrypted in migration 005 via pgcrypto)
    model VARCHAR(100) NOT NULL,            -- Model identifier (e.g., "gpt-4o-mini", "claude-3-5-sonnet-20241022")
    nlp_mode INTEGER NOT NULL DEFAULT 1 CHECK (nlp_mode BETWEEN 1 AND 3), -- 1=cloud_only, 2=cloud+local, 3=local_only
    updated_at TIMESTAMP NOT NULL,          -- Last update timestamp
    updated_by VARCHAR(255) NOT NULL        -- User ID from JWT who last updated config
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_llm_config_updated_at ON llm_config(updated_at DESC);

COMMENT ON TABLE llm_config IS 'Singleton LLM provider configuration (id=1 enforced). Config changes require server restart.';
COMMENT ON COLUMN llm_config.id IS 'Always 1 (singleton pattern via CHECK constraint)';
COMMENT ON COLUMN llm_config.provider IS 'LLM provider: openai|anthropic|azure|custom|fptcloud';
COMMENT ON COLUMN llm_config.base_url IS 'Provider API base URL (empty for default provider URLs)';
COMMENT ON COLUMN llm_config.api_key IS 'API key (encrypted via pgcrypto in migration 005 - see llm_config_encryption_key table)';
COMMENT ON COLUMN llm_config.model IS 'Model identifier specific to the provider';
COMMENT ON COLUMN llm_config.nlp_mode IS 'NLP processing mode: 1=cloud_only (keyword fallback), 2=cloud+local (hybrid), 3=local_only (LLM-based)';
COMMENT ON COLUMN llm_config.updated_by IS 'JWT user_id/email of user who last updated config';
