-- Phase 9: Fine-tuning Schema
-- Add tables for model versioning, A/B testing, and fine-tuning jobs

CREATE TABLE model_versions (
    id SERIAL PRIMARY KEY,
    model_type TEXT NOT NULL,  -- 'answer_generator', 'reranker', 'entity_extractor'
    base_model TEXT NOT NULL,  -- 'claude-opus-4-8', 'custom-lora-v1'
    version_tag TEXT NOT NULL UNIQUE,  -- 'v1.0.0-20260711'
    fine_tuning_job_id TEXT,  -- Anthropic API job ID
    training_pairs_count INTEGER,
    validation_accuracy FLOAT,
    is_active BOOLEAN DEFAULT FALSE,
    promoted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(model_type, version_tag)
);

CREATE INDEX idx_model_versions_active ON model_versions(model_type, is_active);
CREATE INDEX idx_model_versions_created ON model_versions(created_at DESC);

CREATE TABLE ab_test_cohorts (
    id SERIAL PRIMARY KEY,
    model_version_id INTEGER NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
    cohort_name TEXT NOT NULL,  -- 'canary', 'control', 'treatment'
    traffic_percentage FLOAT NOT NULL CHECK (traffic_percentage > 0 AND traffic_percentage <= 100),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(model_version_id, cohort_name)
);

CREATE INDEX idx_ab_cohorts_active ON ab_test_cohorts(end_at) WHERE end_at IS NULL;

CREATE TABLE ab_test_results (
    id SERIAL PRIMARY KEY,
    cohort_id INTEGER NOT NULL REFERENCES ab_test_cohorts(id) ON DELETE CASCADE,
    query_id INTEGER NOT NULL REFERENCES query_logs(id) ON DELETE CASCADE,
    model_version_id INTEGER NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
    accuracy_score FLOAT,  -- 0.0-1.0 (derived from feedback)
    latency_ms INTEGER,
    token_usage INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ab_results_cohort ON ab_test_results(cohort_id, created_at DESC);
CREATE INDEX idx_ab_results_model ON ab_test_results(model_version_id, created_at DESC);

CREATE TABLE fine_tuning_jobs (
    id SERIAL PRIMARY KEY,
    model_type TEXT NOT NULL,
    base_model TEXT NOT NULL,
    training_pairs_count INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',  -- 'queued', 'running', 'completed', 'failed'
    anthropic_job_id TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_finetuning_status ON fine_tuning_jobs(status) WHERE status != 'completed';
CREATE INDEX idx_finetuning_created ON fine_tuning_jobs(created_at DESC);
