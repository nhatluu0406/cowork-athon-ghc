-- Rollback Phase 9 Fine-tuning Schema

DROP TABLE IF EXISTS fine_tuning_jobs CASCADE;
DROP TABLE IF EXISTS ab_test_results CASCADE;
DROP INDEX IF EXISTS idx_ab_results_cohort;
DROP INDEX IF EXISTS idx_ab_results_model;
DROP TABLE IF EXISTS ab_test_cohorts CASCADE;
DROP INDEX IF EXISTS idx_ab_cohorts_active;
DROP TABLE IF EXISTS model_versions CASCADE;
DROP INDEX IF EXISTS idx_model_versions_active;
DROP INDEX IF EXISTS idx_model_versions_created;
DROP TABLE IF EXISTS ipa_metrics CASCADE;
