package retrieval

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/rad-system/m365-knowledge-graph/internal/finetuning"
)

// AnswerGeneratorWithABTest wraps the base AnswerGenerator with A/B testing support
type AnswerGeneratorWithABTest struct {
	base    *AnswerGenerator
	abTest  *finetuning.ABTestManager
	version *finetuning.Versioning
}

func NewAnswerGeneratorWithABTest(base *AnswerGenerator, abTest *finetuning.ABTestManager, version *finetuning.Versioning) *AnswerGeneratorWithABTest {
	return &AnswerGeneratorWithABTest{
		base:    base,
		abTest:  abTest,
		version: version,
	}
}

// GenerateWithCohort generates an answer and assigns user to A/B test cohort
func (ag *AnswerGeneratorWithABTest) GenerateWithCohort(ctx context.Context, userID string, query string, packedContext string) (string, []interface{}, int64, error) {
	// 1. Assign user to cohort (deterministic by user_id)
	cohort, err := ag.abTest.GetCohort(ctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "failed to get A/B cohort, using base model", "user_id", userID, "error", err)
		answer, sources := ag.base.Generate(ctx, query, packedContext)
		return answer, sources, 0, nil
	}

	// 2. Get the model version for this cohort
	modelVersion, err := ag.version.GetByID(ctx, cohort.ModelVersionID)
	if err != nil {
		slog.WarnContext(ctx, "failed to get model version for cohort, using base model", "cohort_id", cohort.ID, "error", err)
		answer, sources := ag.base.Generate(ctx, query, packedContext)
		return answer, sources, 0, nil
	}

	slog.InfoContext(ctx, "A/B test cohort assigned", "user_id", userID, "cohort", cohort.CohortName, "model_version", modelVersion.VersionTag)

	// 3. Generate answer (in production, this would use the fine-tuned model)
	answer, sources := ag.base.Generate(ctx, query, packedContext)

	// 4. Return with model version ID for metrics tracking
	return answer, sources, modelVersion.ID, nil
}

// RecordQuery records answer quality for A/B test metrics
func (ag *AnswerGeneratorWithABTest) RecordQuery(ctx context.Context, userID string, queryID int64, accuracy float64, latencyMs int, tokenUsage int) error {
	// Get user's cohort
	cohort, err := ag.abTest.GetCohort(ctx, userID)
	if err != nil {
		return fmt.Errorf("answer_gen_finetuned.RecordQuery: get cohort: %w", err)
	}

	// Get current active model version
	modelVersion, err := ag.version.GetActive(ctx, "answer_generator")
	if err != nil {
		return fmt.Errorf("answer_gen_finetuned.RecordQuery: get model version: %w", err)
	}

	// Record result
	err = ag.abTest.RecordResult(ctx, cohort.ID, queryID, modelVersion.ID, &accuracy, &latencyMs, &tokenUsage)
	if err != nil {
		return fmt.Errorf("answer_gen_finetuned.RecordQuery: record result: %w", err)
	}

	slog.DebugContext(ctx, "A/B test result recorded", "query_id", queryID, "cohort", cohort.CohortName, "accuracy", accuracy)
	return nil
}

// EvaluateCanary checks if canary cohort should be promoted
func (ag *AnswerGeneratorWithABTest) EvaluateCanary(ctx context.Context) (bool, error) {
	// Find canary and control cohorts
	// TODO: Query database for active cohorts
	// For now, assume cohort IDs 1 and 2
	return ag.abTest.EvaluateCanary(ctx, 1, 2, 7)
}
