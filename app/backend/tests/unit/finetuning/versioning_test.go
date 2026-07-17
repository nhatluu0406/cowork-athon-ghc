package finetuning_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/finetuning"
	test "github.com/rad-system/m365-knowledge-graph/tests/unit"
)

// TestVersioningCreate tests creating a new model version
func TestVersioningCreate(t *testing.T) {
	t.Run("should create a new model version", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		// Act
		version, err := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-20260711", 150)

		// Assert
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		if version == nil {
			t.Fatal("version should not be nil")
		}
		if version.VersionTag != "v1.0.0-20260711" {
			t.Errorf("VersionTag mismatch: %s", version.VersionTag)
		}
		if version.IsActive != false {
			t.Error("NewVersion should not be active by default")
		}
	})

	t.Run("should return error on duplicate version tag", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		// Create first version
		_, err := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-duplicate", 100)
		if err != nil {
			t.Fatalf("First Create failed: %v", err)
		}

		// Act - try to create duplicate
		_, err = v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-duplicate", 150)

		// Assert
		if err == nil {
			t.Error("Should return error on duplicate version tag")
		}
	})
}

// TestVersioningGetActive tests retrieving the active model version
func TestVersioningGetActive(t *testing.T) {
	t.Run("should get active model version", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		version, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-active", 100)
		v.Promote(context.Background(), version.ID)

		// Act
		active, err := v.GetActive(context.Background(), "answer_generator")

		// Assert
		if err != nil {
			t.Fatalf("GetActive failed: %v", err)
		}
		if active.ID != version.ID {
			t.Errorf("Active version ID mismatch: %d vs %d", active.ID, version.ID)
		}
		if !active.IsActive {
			t.Error("Active version should have IsActive=true")
		}
	})

	t.Run("should return error when no active version", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		// Act
		_, err := v.GetActive(context.Background(), "nonexistent_model")

		// Assert
		if err == nil {
			t.Error("Should return error when no active version")
		}
	})
}

// TestVersioningPromote tests model promotion
func TestVersioningPromote(t *testing.T) {
	t.Run("should promote a model version", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		v1, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-first", 100)
		v2, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.1-second", 150)

		// Promote v1
		v.Promote(context.Background(), v1.ID)

		// Act - Promote v2
		err := v.Promote(context.Background(), v2.ID)

		// Assert
		if err != nil {
			t.Fatalf("Promote failed: %v", err)
		}

		active, _ := v.GetActive(context.Background(), "answer_generator")
		if active.ID != v2.ID {
			t.Errorf("Active version should be v2 (%d), got %d", v2.ID, active.ID)
		}
	})

	t.Run("should deactivate previous versions on promote", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		v1, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-old", 100)
		v.Promote(context.Background(), v1.ID)

		// Act
		v2, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.1-new", 200)
		v.Promote(context.Background(), v2.ID)

		// Assert
		old, _ := v.GetByID(context.Background(), v1.ID)
		if old.IsActive {
			t.Error("Old version should be deactivated")
		}
	})
}

// TestVersioningRollback tests model rollback
func TestVersioningRollback(t *testing.T) {
	t.Run("should rollback to previous version", func(t *testing.T) {
		// Arrange
		db := test.SetupTestDB(t)
		defer test.TeardownTestDB(t, db)
		v := finetuning.NewVersioning(db)

		v1, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-stable", 100)
		v.Promote(context.Background(), v1.ID)

		v2, _ := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.1-broken", 150)
		v.Promote(context.Background(), v2.ID)

		// Act
		err := v.Rollback(context.Background(), "answer_generator")

		// Assert
		if err != nil {
			t.Fatalf("Rollback failed: %v", err)
		}

		active, _ := v.GetActive(context.Background(), "answer_generator")
		if active.ID != v1.ID {
			t.Errorf("After rollback, active version should be v1, got %d", active.ID)
		}
	})
}
