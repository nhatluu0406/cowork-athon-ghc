-- Rollback Migration 005: Remove encryption infrastructure

DROP TABLE IF EXISTS llm_config_encryption_key;
-- pgcrypto extension left in place (safe to keep, other features might use it)
-- If you need to drop it: DROP EXTENSION IF EXISTS pgcrypto;
