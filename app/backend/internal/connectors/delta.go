package connectors

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
)

type DeltaSyncCoordinator struct {
	db             *sql.DB
	oneDrive       *OneDriveConnector
	teams          *TeamsConnector
	changeTokenMap map[string]string
}

func NewDeltaSyncCoordinator(db *sql.DB, oneDrive *OneDriveConnector, teams *TeamsConnector) *DeltaSyncCoordinator {
	return &DeltaSyncCoordinator{
		db:             db,
		oneDrive:       oneDrive,
		teams:          teams,
		changeTokenMap: make(map[string]string),
	}
}

func (dsc *DeltaSyncCoordinator) SyncOneDrive(ctx context.Context, siteID, driveID string) (int, error) {
	token, _ := dsc.changeTokenMap[driveID]

	files, newToken, err := dsc.oneDrive.GetDelta(ctx, driveID, token)
	if err != nil {
		return 0, fmt.Errorf("delta query failed: %w", err)
	}

	// TODO: process files, insert/update m365_files + chunks tables
	filesCount := len(files)

	// Persist new token
	if newToken != "" {
		if err := dsc.SaveChangeToken(ctx, driveID, newToken); err != nil {
			slog.WarnContext(ctx, "failed to save change token", "err", err)
		}
		dsc.changeTokenMap[driveID] = newToken
	}

	return filesCount, nil
}

func (dsc *DeltaSyncCoordinator) SaveChangeToken(ctx context.Context, source, token string) error {
	_, err := dsc.db.ExecContext(ctx,
		`INSERT INTO delta_state (source, change_token, has_more, last_sync_at)
		 VALUES ($1, $2, false, now())
		 ON CONFLICT (source) DO UPDATE SET change_token = $2, last_sync_at = now()`,
		source, token)
	return err
}
