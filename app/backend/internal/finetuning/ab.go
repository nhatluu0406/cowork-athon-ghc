package finetuning

import (
	"context"
	"database/sql"
	"fmt"
	"hash/crc32"
	"log/slog"
	"time"
)

type ABTestCohort struct {
	ID                int64
	ModelVersionID    int64
	CohortName        string // 'canary', 'control', 'treatment'
	TrafficPercentage float64
	StartAt           time.Time
	EndAt             *time.Time
	CreatedAt         time.Time
}

type ABTestResult struct {
	ID             int64
	CohortID       int64
	QueryID        int64
	ModelVersionID int64
	AccuracyScore  *float64
	LatencyMS      *int
	TokenUsage     *int
	CreatedAt      time.Time
}

type ABTestManager struct {
	db *sql.DB
}

func NewABTestManager(db *sql.DB) *ABTestManager {
	return &ABTestManager{db: db}
}

// CreateCohort creates a new A/B test cohort
func (atm *ABTestManager) CreateCohort(ctx context.Context, modelVersionID int64, cohortName string, trafficPct float64) (*ABTestCohort, error) {
	if trafficPct <= 0 || trafficPct > 100 {
		return nil, fmt.Errorf("ab_test.CreateCohort: invalid traffic percentage: %f", trafficPct)
	}

	query := `
		INSERT INTO ab_test_cohorts (model_version_id, cohort_name, traffic_percentage, start_at)
		VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
		RETURNING id, model_version_id, cohort_name, traffic_percentage, start_at, end_at, created_at
	`

	var cohort ABTestCohort
	err := atm.db.QueryRowContext(ctx, query, modelVersionID, cohortName, trafficPct).Scan(
		&cohort.ID, &cohort.ModelVersionID, &cohort.CohortName, &cohort.TrafficPercentage, &cohort.StartAt, &cohort.EndAt, &cohort.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("ab_test.CreateCohort: %w", err)
	}

	slog.InfoContext(ctx, "A/B test cohort created", "cohort_id", cohort.ID, "name", cohortName, "traffic_pct", trafficPct)
	return &cohort, nil
}

// GetCohort returns the cohort assignment for a user (deterministic by user_id)
func (atm *ABTestManager) GetCohort(ctx context.Context, userID string) (*ABTestCohort, error) {
	// Hash user_id deterministically to assign to cohort
	hash := crc32.ChecksumIEEE([]byte(userID))
	trafficHash := hash % 100

	query := `
		SELECT id, model_version_id, cohort_name, traffic_percentage, start_at, end_at, created_at
		FROM ab_test_cohorts
		WHERE end_at IS NULL
		ORDER BY traffic_percentage DESC
	`

	rows, err := atm.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("ab_test.GetCohort: %w", err)
	}
	defer rows.Close()

	var cumulative float64
	for rows.Next() {
		var cohort ABTestCohort
		if err := rows.Scan(&cohort.ID, &cohort.ModelVersionID, &cohort.CohortName, &cohort.TrafficPercentage, &cohort.StartAt, &cohort.EndAt, &cohort.CreatedAt); err != nil {
			return nil, fmt.Errorf("ab_test.GetCohort scan: %w", err)
		}

		cumulative += cohort.TrafficPercentage
		if float64(trafficHash) < cumulative {
			return &cohort, nil
		}
	}

	// Fallback to control cohort if no match (should not happen if percentages sum to 100)
	return nil, fmt.Errorf("ab_test.GetCohort: no cohort assigned for user")
}

// RecordResult records the outcome of a query for A/B testing
func (atm *ABTestManager) RecordResult(ctx context.Context, cohortID, queryID, modelVersionID int64, accuracy *float64, latencyMs *int, tokenUsage *int) error {
	query := `
		INSERT INTO ab_test_results (cohort_id, query_id, model_version_id, accuracy_score, latency_ms, token_usage)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

	_, err := atm.db.ExecContext(ctx, query, cohortID, queryID, modelVersionID, accuracy, latencyMs, tokenUsage)
	if err != nil {
		return fmt.Errorf("ab_test.RecordResult: %w", err)
	}

	return nil
}

type CohortMetrics struct {
	CohortName      string
	QueryCount      int64
	AvgAccuracy     float64
	AvgLatencyMs    float64
	AvgTokenUsage   float64
	ThumbsUpCount   int64
	ThumbsDownCount int64
}

// GetCohortMetrics computes metrics for a cohort over the last N days
func (atm *ABTestManager) GetCohortMetrics(ctx context.Context, cohortID int64, days int) (*CohortMetrics, error) {
	query := `
		SELECT
			ac.cohort_name,
			COUNT(atr.id) as query_count,
			COALESCE(AVG(atr.accuracy_score), 0) as avg_accuracy,
			COALESCE(AVG(atr.latency_ms), 0) as avg_latency,
			COALESCE(AVG(atr.token_usage), 0) as avg_tokens,
			SUM(CASE WHEN fe.feedback_type = 'like' THEN 1 ELSE 0 END) as likes,
			SUM(CASE WHEN fe.feedback_type = 'dislike' THEN 1 ELSE 0 END) as dislikes
		FROM ab_test_results atr
		JOIN ab_test_cohorts ac ON ac.id = atr.cohort_id
		LEFT JOIN feedback_events fe ON fe.query_id = atr.query_id
		WHERE atr.cohort_id = $1
		AND atr.created_at > datetime('now', '-' || $2 || ' days')
		GROUP BY ac.cohort_name
	`

	var metrics CohortMetrics
	err := atm.db.QueryRowContext(ctx, query, cohortID, days).Scan(
		&metrics.CohortName, &metrics.QueryCount, &metrics.AvgAccuracy, &metrics.AvgLatencyMs,
		&metrics.AvgTokenUsage, &metrics.ThumbsUpCount, &metrics.ThumbsDownCount,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("ab_test.GetCohortMetrics: no data")
	}
	if err != nil {
		return nil, fmt.Errorf("ab_test.GetCohortMetrics: %w", err)
	}

	return &metrics, nil
}

// EvaluateCanary determines if canary cohort should be promoted
func (atm *ABTestManager) EvaluateCanary(ctx context.Context, canaryID, controlID int64, durationDays int) (bool, error) {
	canaryMetrics, err := atm.GetCohortMetrics(ctx, canaryID, durationDays)
	if err != nil {
		return false, fmt.Errorf("ab_test.EvaluateCanary: get canary metrics: %w", err)
	}

	controlMetrics, err := atm.GetCohortMetrics(ctx, controlID, durationDays)
	if err != nil {
		return false, fmt.Errorf("ab_test.EvaluateCanary: get control metrics: %w", err)
	}

	// Promote if:
	// 1. Canary accuracy > control accuracy + 2%
	// 2. Canary latency <= control latency + 5%
	// 3. Canary has enough samples (>50 queries)
	accuracyImprovement := canaryMetrics.AvgAccuracy - controlMetrics.AvgAccuracy
	latencyRegression := canaryMetrics.AvgLatencyMs - controlMetrics.AvgLatencyMs
	latencyRegressionPct := (latencyRegression / controlMetrics.AvgLatencyMs) * 100

	shouldPromote := accuracyImprovement >= 0.02 &&
		latencyRegressionPct <= 5.0 &&
		canaryMetrics.QueryCount >= 50

	slog.InfoContext(ctx, "canary evaluation", "accuracy_improvement", accuracyImprovement,
		"latency_regression_pct", latencyRegressionPct, "canary_queries", canaryMetrics.QueryCount,
		"should_promote", shouldPromote)

	return shouldPromote, nil
}

// CloseCohort marks a cohort as ended
func (atm *ABTestManager) CloseCohort(ctx context.Context, cohortID int64) error {
	_, err := atm.db.ExecContext(ctx, "UPDATE ab_test_cohorts SET end_at = CURRENT_TIMESTAMP WHERE id = $1", cohortID)
	if err != nil {
		return fmt.Errorf("ab_test.CloseCohort: %w", err)
	}

	slog.InfoContext(ctx, "A/B test cohort closed", "cohort_id", cohortID)
	return nil
}
