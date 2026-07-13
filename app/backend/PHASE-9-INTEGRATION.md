# Phase 9: Fine-tuning Integration Guide

**Status**: Infrastructure complete, integration tasks (T123-T125) remaining  
**Location**: `src/m365-knowledge-graph/internal/finetuning/`

---

## Architecture Overview

```
User Feedback (like/dislike)
  ↓ [Feedback API] → feedback_events table
  ↓ [Weekly Export] → TrainingDataStore.ExportTrainingPairs()
  ↓
Anthropic Fine-tuning API
  ↓ [FineTuningOrchestrator.ScheduleFineTuningJob]
  ↓ Creates: model_versions record
  ↓ Creates: fine_tuning_jobs record (status=queued)
  ↓
[Hourly Polling] FineTuningOrchestrator.PollAndCompleteJobs()
  ↓ When complete: status=completed → model version activated
  ↓
A/B Test Deployment
  ↓ [Canary] 10% traffic → new model
  ↓ [Control] 90% traffic → baseline model
  ↓ [7-day evaluation] EvaluateCanary()
  ↓ If accuracy ↑2%: Promote to 100%
  ↓ Else: Rollback automatically
```

---

## Integration Checklist

### T123: Wire Orchestrator into Answer Generator ✅

**File**: `internal/retrieval/answer_gen_finetuned.go`  
**Status**: COMPLETE

The `AnswerGeneratorWithABTest` wrapper enables:
1. **Cohort Assignment**: User assigned to canary/control deterministically
2. **Model Selection**: Retrieves fine-tuned model for cohort
3. **Metrics Recording**: Tracks accuracy/latency per cohort

**Usage**:
```go
// In bootstrap (see T123 implementation below)
abTestGen := retrieval.NewAnswerGeneratorWithABTest(
  baseAnswerGen,
  abTestManager,
  versioningManager,
)

// In retriever.Query()
if enableFineTuning {
  answer, sources, modelVersionID, err := abTestGen.GenerateWithCohort(
    ctx, userID, query, packedContext,
  )
  // Record metrics for A/B test
  abTestGen.RecordQuery(ctx, userID, queryID, accuracy, latencyMs, tokenUsage)
}
```

---

### T124: Fine-tuning Status Endpoint ✅

**File**: `internal/api/handlers_finetuning.go`  
**Endpoint**: `GET /api/finetuning/status`

**Response**:
```json
{
  "active_model": {
    "id": 1,
    "version_tag": "v1.0.0-20260711",
    "training_pairs_count": 150,
    "validation_accuracy": 0.92,
    "promoted_at": "2026-07-11T10:00:00Z"
  },
  "pending_jobs": [],
  "recently_completed_jobs": [],
  "ab_test_status": {
    "canary_cohort_id": 1,
    "control_cohort_id": 2,
    "canary_accuracy": 0.94,
    "control_accuracy": 0.92,
    "days_running": 3,
    "ready_for_promotion": false
  }
}
```

**Status**: Partially implemented  
**TODO**: Query database for pending/completed jobs

---

### T125: Model Promotion Endpoint ✅

**File**: `internal/api/handlers_finetuning.go`  
**Endpoint**: `POST /api/finetuning/promote/:version_id`

**Request**:
```json
{
  "version_id": 2
}
```

**Response**:
```json
{
  "success": true,
  "message": "Model version promoted successfully",
  "version_id": 2
}
```

**Status**: Complete  
**Security**: TODO - add admin authorization check

---

### T122: Scheduler Integration ✅

**File**: `internal/scheduler/finetuning_job.go`  
**Status**: Complete

**Trigger Logic**:
```go
// Bootstrap code (see below)
ftScheduler := scheduler.NewFineTuningScheduler(30 * 24 * time.Hour) // monthly
ftRunner := scheduler.NewFineTuningJobRunner(orchestrator, improver, 100)
ftScheduler.Start(ctx, ftRunner)

// Monthly execution:
// 1. Check low-confidence hotspots
// 2. If >10 hotspots: force retrain
// 3. Export training pairs (1 month of feedback)
// 4. If ≥100 pairs: Schedule job
// 5. Hourly polling cycle checks job status

// Polling schedule (hourly):
// - Poll all 'queued'/'running' jobs
// - On completion: create model_versions record, set is_active=true
// - On failure: record error, mark as failed
```

---

## Bootstrap Code (Add to cmd/main.go)

```go
package main

import (
  "context"
  "database/sql"
  "log/slog"
  
  "github.com/rad-system/m365-knowledge-graph/internal/api"
  "github.com/rad-system/m365-knowledge-graph/internal/finetuning"
  "github.com/rad-system/m365-knowledge-graph/internal/retrieval"
  "github.com/rad-system/m365-knowledge-graph/internal/scheduler"
)

func setupFineTuning(ctx context.Context, db *sql.DB, router http.Handler, cfg *common.Config) error {
  // 1. Initialize fine-tuning components
  versioning := finetuning.NewVersioning(db)
  abTestManager := finetuning.NewABTestManager(db)
  trainingDataStore := finetuning.NewTrainingDataStore(db)
  anthropicClient := finetuning.NewAnthropicClient(cfg.LLMAPIBase) // Use Anthropic API key
  orchestrator := finetuning.NewFineTuningOrchestrator(
    db,
    versioning,
    anthropicClient,
    trainingDataStore,
  )

  // 2. Wire into retriever
  baseAnswerGen := retrieval.NewAnswerGenerator() // From Phase 5
  abTestAnswerGen := retrieval.NewAnswerGeneratorWithABTest(
    baseAnswerGen,
    abTestManager,
    versioning,
  )
  
  // Update retriever (enable fine-tuning)
  retriever := retrieval.NewRetriever(db, /* other stages */)
  retriever.enableFineTuning = true
  retriever.answerGeneratorABTest = abTestAnswerGen

  // 3. Register API endpoints
  // POST /api/finetuning/promote
  mux.HandleFunc("POST /api/finetuning/promote/{id}", api.HandlePromoteModel(versioning))
  // POST /api/finetuning/rollback
  mux.HandleFunc("POST /api/finetuning/rollback", api.HandleRollbackModel(versioning))
  // GET /api/finetuning/status
  mux.HandleFunc("GET /api/finetuning/status", api.HandleFineTuningStatus(versioning, abTestManager, db))
  // GET /api/finetuning/metrics
  mux.HandleFunc("GET /api/finetuning/metrics", api.HandleFineTuningMetrics(versioning, abTestManager))
  // GET /api/finetuning/models
  mux.HandleFunc("GET /api/finetuning/models", api.HandleModelList(versioning))

  // 4. Start schedulers
  improver := feedback.NewImprover(db) // From Phase 6
  ftScheduler := scheduler.NewFineTuningScheduler(30 * 24 * time.Hour)
  ftRunner := scheduler.NewFineTuningJobRunner(orchestrator, improver, 100)
  
  ftScheduler.Start(ctx, ftRunner)
  
  // Graceful shutdown
  defer ftScheduler.Stop()

  slog.InfoContext(ctx, "fine-tuning system initialized")
  return nil
}
```

---

## Database Setup

**Migration**: `migrations/002_finetuning_schema.sql`

Run to create 4 new tables:
```bash
psql -d ragmini -f migrations/002_finetuning_schema.sql
```

**Tables**:
- `model_versions` — 10-version retention, active tracking
- `ab_test_cohorts` — traffic split mgmt (canary 10%, control 90%)
- `ab_test_results` — per-query metrics (accuracy, latency, tokens)
- `fine_tuning_jobs` — job tracking (queued/running/completed/failed)

---

## Testing Setup

**Unit Tests**: `tests/unit/finetuning/`
- `versioning_test.go` — Model versioning (create, promote, rollback)
- `ab_test_test.go` — Cohort assignment, metrics, evaluation

**Integration Tests**: `tests/integration/finetuning/`
- `integration_test.go` — End-to-end job lifecycle, feedback conversion, scheduler

**Run**:
```bash
cd src/m365-knowledge-graph
go test ./tests/unit/finetuning/... -v
go test -tags=integration ./tests/integration/finetuning/... -v
```

---

## Metrics Dashboard (T126)

**Endpoint**: `GET /api/finetuning/metrics?model_type=answer_generator`

**Response Shows**:
1. Version history (all 10 retained versions)
2. A/B test results
   - Canary cohort: avg accuracy, latency, token usage
   - Control cohort: same metrics
   - Accuracy improvement: canary.accuracy - control.accuracy
   - Latency change: (canary.latency - control.latency) / control.latency * 100
3. Latest job status

**Use Cases**:
- Admin dashboard: Monitor active model + A/B test progress
- On-call: Rapid rollback if canary fails (POST /api/finetuning/rollback)
- Analytics: Track model improvement over time

---

## SLOs & Monitoring

| Metric | Target | Alert |
|--------|--------|-------|
| Fine-tuning cycle time | ≤24h | >36h |
| Canary evaluation period | 7 days | <500 queries in 7d |
| Accuracy improvement (canary) | ≥2% | <2% → no auto-promote |
| Latency regression (canary) | ≤5% | >5% → auto-rollback |
| Cost per fine-tuning | ≤$500 | Track API usage |
| Model versions retained | ≥5 | Cleanup old versions |
| A/B test cohort balance | 10%/90% | Monitor traffic split |

---

## Troubleshooting

### Fine-tuning job stuck in 'queued'
- Check Anthropic API key in config
- Check `fine_tuning_jobs` table for anthropic_job_id
- Manually query Anthropic API: `curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/beta/fine_tuning_jobs/{job_id}`

### Canary not promoting despite good metrics
- Check `EvaluateCanary()` thresholds (2% accuracy, 5% latency)
- Check query count in canary cohort (minimum 50)
- Verify `ab_test_results` populated correctly

### Users always assigned to control cohort
- Check `ABTestManager.GetCohort()` cohort selection logic
- Verify `ab_test_cohorts` has active cohorts (end_at IS NULL)
- Check traffic percentage sums to 100%

### Model version not appearing as active
- Check `model_versions.is_active = true` after promotion
- Check `promoted_at` timestamp updated
- Verify `AnswerGeneratorWithABTest.GenerateWithCohort()` uses correct version

---

## Next Steps (Post-Phase 9)

1. **Test Phase 9** (1 week)
   - Run unit + integration tests
   - Mock Anthropic API for local testing
   - Load test A/B framework

2. **Integration Testing** (1 week)
   - Deploy to staging
   - Collect real feedback data
   - Schedule test fine-tuning job
   - Evaluate canary metrics
   - Manual promotion/rollback

3. **Production Deployment** (on-demand)
   - Enable fine-tuning in production config
   - Monitor metrics for first 30 days
   - Adjust SLO thresholds based on real data
   - Consider multi-model support (reranker, entity extractor fine-tuning)

---

## Files Reference

| File | Purpose |
|------|---------|
| `internal/finetuning/versioning.go` | Model version CRUD + promotion/rollback |
| `internal/finetuning/anthropic_client.go` | Anthropic API client (job creation, polling) |
| `internal/finetuning/ab_test.go` | Cohort assignment, metrics, evaluation |
| `internal/finetuning/orchestrator.go` | Job scheduling + status tracking |
| `internal/finetuning/training_data_store.go` | Feedback → training pairs export |
| `internal/retrieval/answer_gen_finetuned.go` | A/B test-aware answer generator |
| `internal/scheduler/finetuning_job.go` | Monthly trigger + hourly polling |
| `internal/api/handlers_finetuning.go` | API endpoints (status, metrics, promote, rollback) |
| `migrations/002_finetuning_schema.sql` | Database schema (4 tables) |
| `tests/unit/finetuning/*.go` | Unit tests |
| `tests/integration/finetuning/*.go` | Integration tests |
