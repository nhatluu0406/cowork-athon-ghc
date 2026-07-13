package finetuning

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

type ModelVersion struct {
	ID                 int64
	ModelType          string
	BaseModel          string
	VersionTag         string
	FineTuningJobID    string
	TrainingPairsCount int64
	ValidationAccuracy float64
	IsActive           bool
	PromotedAt         *time.Time
	CreatedAt          time.Time
}

type Versioning struct {
	db *sql.DB
}

func NewVersioning(db *sql.DB) *Versioning {
	return &Versioning{db: db}
}

func (v *Versioning) Create(ctx context.Context, modelType, baseModel, versionTag string, pairsCount int64) (*ModelVersion, error) {
	query := `
		INSERT INTO model_versions (model_type, base_model, version_tag, training_pairs_count, is_active)
		VALUES ($1, $2, $3, $4, FALSE)
		RETURNING id, model_type, base_model, version_tag, fine_tuning_job_id, training_pairs_count, validation_accuracy, is_active, promoted_at, created_at
	`

	var (
		mv              ModelVersion
		fineTuningJobID sql.NullString
		validationAcc   sql.NullFloat64
		promotedAt      sql.NullTime
	)

	err := v.db.QueryRowContext(ctx, query, modelType, baseModel, versionTag, pairsCount).Scan(
		&mv.ID, &mv.ModelType, &mv.BaseModel, &mv.VersionTag, &fineTuningJobID,
		&mv.TrainingPairsCount, &validationAcc, &mv.IsActive, &promotedAt, &mv.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("finetuning.Create: %w", err)
	}

	// Handle NULL values
	if fineTuningJobID.Valid {
		mv.FineTuningJobID = fineTuningJobID.String
	}
	if validationAcc.Valid {
		mv.ValidationAccuracy = validationAcc.Float64
	}
	if promotedAt.Valid {
		mv.PromotedAt = &promotedAt.Time
	}

	slog.InfoContext(ctx, "model version created", "model_type", modelType, "version", versionTag, "pairs", pairsCount)
	return &mv, nil
}

func (v *Versioning) GetActive(ctx context.Context, modelType string) (*ModelVersion, error) {
	query := `
		SELECT id, model_type, base_model, version_tag, fine_tuning_job_id, training_pairs_count, validation_accuracy, is_active, promoted_at, created_at
		FROM model_versions
		WHERE model_type = $1 AND is_active = TRUE
		ORDER BY promoted_at DESC
		LIMIT 1
	`

	var (
		mv              ModelVersion
		fineTuningJobID sql.NullString
		validationAcc   sql.NullFloat64
		promotedAt      sql.NullTime
	)

	err := v.db.QueryRowContext(ctx, query, modelType).Scan(
		&mv.ID, &mv.ModelType, &mv.BaseModel, &mv.VersionTag, &fineTuningJobID,
		&mv.TrainingPairsCount, &validationAcc, &mv.IsActive, &promotedAt, &mv.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("finetuning.GetActive: no active version for %s", modelType)
	}
	if err != nil {
		return nil, fmt.Errorf("finetuning.GetActive: %w", err)
	}

	// Handle NULL values
	if fineTuningJobID.Valid {
		mv.FineTuningJobID = fineTuningJobID.String
	}
	if validationAcc.Valid {
		mv.ValidationAccuracy = validationAcc.Float64
	}
	if promotedAt.Valid {
		mv.PromotedAt = &promotedAt.Time
	}

	return &mv, nil
}

func (v *Versioning) GetByID(ctx context.Context, versionID int64) (*ModelVersion, error) {
	query := `
		SELECT id, model_type, base_model, version_tag, fine_tuning_job_id, training_pairs_count, validation_accuracy, is_active, promoted_at, created_at
		FROM model_versions
		WHERE id = $1
	`

	var (
		mv              ModelVersion
		fineTuningJobID sql.NullString
		validationAcc   sql.NullFloat64
		promotedAt      sql.NullTime
	)

	err := v.db.QueryRowContext(ctx, query, versionID).Scan(
		&mv.ID, &mv.ModelType, &mv.BaseModel, &mv.VersionTag, &fineTuningJobID,
		&mv.TrainingPairsCount, &validationAcc, &mv.IsActive, &promotedAt, &mv.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("finetuning.GetByID: %w", err)
	}

	// Handle NULL values
	if fineTuningJobID.Valid {
		mv.FineTuningJobID = fineTuningJobID.String
	}
	if validationAcc.Valid {
		mv.ValidationAccuracy = validationAcc.Float64
	}
	if promotedAt.Valid {
		mv.PromotedAt = &promotedAt.Time
	}

	return &mv, nil
}

func (v *Versioning) List(ctx context.Context, modelType string) ([]*ModelVersion, error) {
	query := `
		SELECT id, model_type, base_model, version_tag, fine_tuning_job_id, training_pairs_count, validation_accuracy, is_active, promoted_at, created_at
		FROM model_versions
		WHERE model_type = $1
		ORDER BY created_at DESC
		LIMIT 10
	`

	rows, err := v.db.QueryContext(ctx, query, modelType)
	if err != nil {
		return nil, fmt.Errorf("finetuning.List: %w", err)
	}
	defer rows.Close()

	var versions []*ModelVersion
	for rows.Next() {
		var (
			mv              ModelVersion
			fineTuningJobID sql.NullString
			validationAcc   sql.NullFloat64
			promotedAt      sql.NullTime
		)
		if err := rows.Scan(&mv.ID, &mv.ModelType, &mv.BaseModel, &mv.VersionTag, &fineTuningJobID,
			&mv.TrainingPairsCount, &validationAcc, &mv.IsActive, &promotedAt, &mv.CreatedAt); err != nil {
			return nil, fmt.Errorf("finetuning.List scan: %w", err)
		}

		// Handle NULL values
		if fineTuningJobID.Valid {
			mv.FineTuningJobID = fineTuningJobID.String
		}
		if validationAcc.Valid {
			mv.ValidationAccuracy = validationAcc.Float64
		}
		if promotedAt.Valid {
			mv.PromotedAt = &promotedAt.Time
		}

		versions = append(versions, &mv)
	}

	return versions, rows.Err()
}

func (v *Versioning) Promote(ctx context.Context, versionID int64) error {
	tx, err := v.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("finetuning.Promote: begin tx: %w", err)
	}
	defer tx.Rollback()

	// Get the version to promote
	var modelType string
	err = tx.QueryRowContext(ctx, "SELECT model_type FROM model_versions WHERE id = $1", versionID).Scan(&modelType)
	if err != nil {
		return fmt.Errorf("finetuning.Promote: get version: %w", err)
	}

	// Deactivate all other versions of this model type
	_, err = tx.ExecContext(ctx, "UPDATE model_versions SET is_active = FALSE WHERE model_type = $1", modelType)
	if err != nil {
		return fmt.Errorf("finetuning.Promote: deactivate others: %w", err)
	}

	// Promote this version
	_, err = tx.ExecContext(ctx, "UPDATE model_versions SET is_active = TRUE, promoted_at = CURRENT_TIMESTAMP WHERE id = $1", versionID)
	if err != nil {
		return fmt.Errorf("finetuning.Promote: promote: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("finetuning.Promote: commit: %w", err)
	}

	slog.InfoContext(ctx, "model version promoted", "version_id", versionID, "model_type", modelType)
	return nil
}

func (v *Versioning) Rollback(ctx context.Context, modelType string) error {
	// Get two most recent versions by ID (newer versions have higher IDs)
	query := `
		SELECT id FROM model_versions
		WHERE model_type = $1
		ORDER BY id DESC
		LIMIT 2
	`

	rows, err := v.db.QueryContext(ctx, query, modelType)
	if err != nil {
		return fmt.Errorf("finetuning.Rollback: %w", err)
	}
	defer rows.Close()

	var versionIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("finetuning.Rollback scan: %w", err)
		}
		versionIDs = append(versionIDs, id)
	}

	if len(versionIDs) < 2 {
		return fmt.Errorf("finetuning.Rollback: not enough versions to rollback")
	}

	// versionIDs is in DESC order: [newest, previous]
	// Promote the previous version (index 1)
	return v.Promote(ctx, versionIDs[1])
}

func (v *Versioning) UpdateJobID(ctx context.Context, versionID int64, jobID string) error {
	_, err := v.db.ExecContext(ctx, "UPDATE model_versions SET fine_tuning_job_id = $1 WHERE id = $2", jobID, versionID)
	if err != nil {
		return fmt.Errorf("finetuning.UpdateJobID: %w", err)
	}
	return nil
}

func (v *Versioning) UpdateAccuracy(ctx context.Context, versionID int64, accuracy float64) error {
	_, err := v.db.ExecContext(ctx, "UPDATE model_versions SET validation_accuracy = $1 WHERE id = $2", accuracy, versionID)
	if err != nil {
		return fmt.Errorf("finetuning.UpdateAccuracy: %w", err)
	}
	return nil
}
