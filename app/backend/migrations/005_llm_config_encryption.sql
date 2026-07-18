-- Migration 005: Enable pgcrypto and update llm_config for encrypted API keys
-- Adds encryption support using PostgreSQL's pgcrypto extension

-- Enable pgcrypto extension for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add encryption key column (stores randomly generated key per installation)
-- This is a simplified approach; production should use external key management (Vault, KMS, etc.)
CREATE TABLE IF NOT EXISTS llm_config_encryption_key (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton pattern
    encryption_key TEXT NOT NULL,          -- Base64-encoded 256-bit key
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Insert a random encryption key if none exists
-- NOTE: This key is stored in the database for simplicity.
-- Production should use external secrets management (HashiCorp Vault, AWS KMS, etc.)
INSERT INTO llm_config_encryption_key (id, encryption_key, created_at)
VALUES (1, encode(gen_random_bytes(32), 'base64'), NOW())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE llm_config_encryption_key IS 'Stores symmetric encryption key for llm_config.api_key. Production: use external KMS.';
COMMENT ON COLUMN llm_config_encryption_key.encryption_key IS 'Base64-encoded 256-bit AES key. CRITICAL: Back up securely before schema changes.';

-- Update llm_config table comment to reflect encryption
COMMENT ON COLUMN llm_config.api_key IS 'API key encrypted with AES-256 using key from llm_config_encryption_key (pgcrypto pgp_sym_encrypt)';
