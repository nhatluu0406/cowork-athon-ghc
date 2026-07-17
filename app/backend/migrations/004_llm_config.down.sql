-- Rollback Migration 004: Drop LLM Configuration Table

DROP INDEX IF EXISTS idx_llm_config_updated_at;
DROP TABLE IF EXISTS llm_config;
