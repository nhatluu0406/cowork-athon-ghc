package finetuning_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/finetuning"
	test "github.com/rad-system/m365-knowledge-graph/tests/unit"
)

// TestABTestCreateCohort tests creating A/B test cohorts
func TestABTestCreateCohort(t *testing.T) {
	t.Run("should create canary and control cohorts", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)
		atm := finetuning.NewABTestManager(db)

		version, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-test", 100)

		// Act
		canary, err := atm.CreateCohort(context.Background(), version.ID, "canary", 10.0)

		// Assert
		if err != nil {
			t.Fatalf("CreateCohort failed: %v", err)
		}
		if canary == nil {
			t.Fatal("Canary cohort should not be nil")
		}
		if canary.TrafficPercentage != 10.0 {
			t.Errorf("Traffic percentage mismatch: %f", canary.TrafficPercentage)
		}
		if canary.CohortName != "canary" {
			t.Errorf("Cohort name mismatch: %s", canary.CohortName)
		}
	})

	t.Run("should reject invalid traffic percentage", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)
		atm := finetuning.NewABTestManager(db)

		version, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-test", 100)

		// Act
		_, err := atm.CreateCohort(context.Background(), version.ID, "invalid", 0.0)

		// Assert
		if err == nil {
			t.Error("Should reject 0% traffic")
		}
	})
}

// TestABTestRecordResult tests recording query results for metrics
func TestABTestRecordResult(t *testing.T) {
	t.Run("should record A/B test result", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		atm := finetuning.NewABTestManager(db)

		cohortID := int64(1)
		queryID := int64(100)
		modelVersionID := int64(1)
		accuracy := 0.95
		latency := 1500
		tokens := 450

		// Act
		err := atm.RecordResult(context.Background(), cohortID, queryID, modelVersionID, &accuracy, &latency, &tokens)

		// Assert
		if err != nil {
			t.Fatalf("RecordResult failed: %v", err)
		}
	})
}

// TestABTestGetCohortMetrics tests retrieving cohort metrics
func TestABTestGetCohortMetrics(t *testing.T) {
	t.Run("should return zero metrics when no data", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		atm := finetuning.NewABTestManager(db)

		// Act
		metrics, err := atm.GetCohortMetrics(context.Background(), 999, 7)

		// Assert
		if err == nil {
			t.Error("Should return error for nonexistent cohort")
		}
		if metrics != nil {
			t.Logf("Metrics returned despite error: %+v", metrics)
		}
	})
}

// TestABTestCloseCohort tests closing an A/B test cohort
func TestABTestCloseCohort(t *testing.T) {
	t.Run("should close a cohort", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)
		atm := finetuning.NewABTestManager(db)

		version, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-test", 100)
		cohort, _ := atm.CreateCohort(context.Background(), version.ID, "test_cohort", 50.0)

		// Act
		err := atm.CloseCohort(context.Background(), cohort.ID)

		// Assert
		if err != nil {
			t.Fatalf("CloseCohort failed: %v", err)
		}
	})
}
