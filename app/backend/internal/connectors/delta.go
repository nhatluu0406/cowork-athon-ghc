package connectors

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// SyncState represents the state machine for delta sync
type SyncState string

const (
	SyncStateIdle       SyncState = "IDLE"
	SyncStateRunning    SyncState = "SYNC_RUNNING"
	SyncStateHasMore    SyncState = "SYNC_PARTIAL_HAS_MORE"
	SyncStateCompleted  SyncState = "SYNC_COMPLETED"
	SyncStateFailed     SyncState = "SYNC_FAILED"
)

// DeltaSyncState represents persisted delta sync state for a source
type DeltaSyncState struct {
	Source      string
	ChangeToken string
	HasMore     bool
	LastSyncAt  time.Time
	State       SyncState
	Error       string
}

// DeltaSyncCoordinator manages incremental sync across M365 sources
// with state machine tracking: IDLE → SYNC_RUNNING → SYNC_PARTIAL_HAS_MORE/SYNC_COMPLETED → IDLE
// or IDLE → SYNC_RUNNING → SYNC_FAILED → IDLE
type DeltaSyncCoordinator struct {
	db          *sql.DB
	oneDrive    OneDriveConnectorInterface
	teams       TeamsConnectorInterface
	logger      *slog.Logger
	stateMutex  sync.RWMutex
	stateMap    map[string]SyncState // source → current state
}

func NewDeltaSyncCoordinator(db *sql.DB, oneDrive OneDriveConnectorInterface, teams TeamsConnectorInterface) *DeltaSyncCoordinator {
	return &DeltaSyncCoordinator{
		db:       db,
		oneDrive: oneDrive,
		teams:    teams,
		logger:   slog.Default(),
		stateMap: make(map[string]SyncState),
	}
}

// GetState returns the current state for a source
func (dsc *DeltaSyncCoordinator) GetState(source string) SyncState {
	dsc.stateMutex.RLock()
	defer dsc.stateMutex.RUnlock()
	if state, exists := dsc.stateMap[source]; exists {
		return state
	}
	return SyncStateIdle
}

// setState transitions the state machine for a source
func (dsc *DeltaSyncCoordinator) setState(source string, newState SyncState) {
	dsc.stateMutex.Lock()
	defer dsc.stateMutex.Unlock()
	oldState := dsc.stateMap[source]
	dsc.stateMap[source] = newState
	dsc.logger.InfoContext(context.Background(), "delta sync state transition",
		"source", source, "from_state", oldState, "to_state", newState)
}

// SyncOneDrive performs delta sync for a OneDrive site/drive
// Follows state machine: IDLE → SYNC_RUNNING → (SYNC_PARTIAL_HAS_MORE | SYNC_COMPLETED | SYNC_FAILED) → IDLE
func (dsc *DeltaSyncCoordinator) SyncOneDrive(ctx context.Context, siteID, driveID string) (int, error) {
	source := "onedrive://" + siteID + "/" + driveID

	// Load current sync state from DB
	syncState, err := dsc.LoadSyncState(ctx, source)
	if err != nil {
		dsc.logger.ErrorContext(ctx, "failed to load sync state", "source", source, "err", err)
		return 0, fmt.Errorf("SyncOneDrive: load state: %w", err)
	}

	// Transition to SYNC_RUNNING
	dsc.setState(source, SyncStateRunning)

	// Perform delta query
	token := syncState.ChangeToken
	files, newToken, hasMore, err := dsc.oneDrive.GetDeltaWithState(ctx, driveID, token)
	if err != nil {
		dsc.setState(source, SyncStateFailed)
		dsc.logger.ErrorContext(ctx, "delta query failed", "source", source, "err", err)
		// Save failed state to DB
		if saveErr := dsc.SaveSyncState(ctx, source, "", true, "delta query failed: "+err.Error()); saveErr != nil {
			dsc.logger.WarnContext(ctx, "failed to save error state", "err", saveErr)
		}
		return 0, fmt.Errorf("SyncOneDrive: delta query failed: %w", err)
	}

	filesCount := len(files)
	dsc.logger.InfoContext(ctx, "delta sync completed", "source", source, "files_count", filesCount, "has_more", hasMore)

	// Determine next state
	var nextState SyncState
	if hasMore {
		nextState = SyncStateHasMore
	} else {
		nextState = SyncStateCompleted
	}

	// Persist new state
	if err := dsc.SaveSyncState(ctx, source, newToken, hasMore, ""); err != nil {
		dsc.logger.ErrorContext(ctx, "failed to save sync state", "source", source, "err", err)
		// Despite the save error, return the files count and transition to IDLE
		// (sync did succeed; only persistence failed—operator can retry)
		dsc.setState(source, SyncStateIdle)
		return filesCount, fmt.Errorf("SyncOneDrive: save state: %w", err)
	}

	// Transition to final state, then back to IDLE
	dsc.setState(source, nextState)
	dsc.setState(source, SyncStateIdle)

	return filesCount, nil
}

// SyncTeams performs delta sync for Teams channels
func (dsc *DeltaSyncCoordinator) SyncTeams(ctx context.Context, teamID string) (int, error) {
	source := "teams://" + teamID

	// Transition to SYNC_RUNNING
	dsc.setState(source, SyncStateRunning)

	// List channels and messages (Teams does not support delta queries in the same way as OneDrive)
	channels, err := dsc.teams.ListChannels(ctx, teamID)
	if err != nil {
		dsc.setState(source, SyncStateFailed)
		dsc.logger.ErrorContext(ctx, "failed to list channels", "source", source, "err", err)
		return 0, fmt.Errorf("SyncTeams: list channels: %w", err)
	}

	totalMessages := 0
	for _, channel := range channels {
		messages, err := dsc.teams.ListMessages(ctx, teamID, channel.ID)
		if err != nil {
			dsc.logger.WarnContext(ctx, "failed to list messages", "source", source, "channel", channel.ID, "err", err)
			continue
		}
		totalMessages += len(messages)
	}

	dsc.logger.InfoContext(ctx, "teams sync completed", "source", source, "total_messages", totalMessages)

	// Persist sync state (no token for Teams, just timestamp)
	if err := dsc.SaveSyncState(ctx, source, "", false, ""); err != nil {
		dsc.logger.ErrorContext(ctx, "failed to save sync state", "source", source, "err", err)
		dsc.setState(source, SyncStateIdle)
		return totalMessages, fmt.Errorf("SyncTeams: save state: %w", err)
	}

	dsc.setState(source, SyncStateCompleted)
	dsc.setState(source, SyncStateIdle)

	return totalMessages, nil
}

// LoadSyncState retrieves delta sync state from the database
func (dsc *DeltaSyncCoordinator) LoadSyncState(ctx context.Context, source string) (*DeltaSyncState, error) {
	row := dsc.db.QueryRowContext(ctx,
		`SELECT COALESCE(source, ''), COALESCE(change_token, ''),
		        COALESCE(has_more, false), COALESCE(last_sync_at, now())
		 FROM delta_state WHERE source = $1`,
		source)

	var state DeltaSyncState
	state.Source = source
	err := row.Scan(&state.Source, &state.ChangeToken, &state.HasMore, &state.LastSyncAt)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("LoadSyncState: %w", err)
	}

	return &state, nil
}

// SaveSyncState persists delta sync state to the database
func (dsc *DeltaSyncCoordinator) SaveSyncState(ctx context.Context, source, changeToken string, hasMore bool, errMsg string) error {
	_, err := dsc.db.ExecContext(ctx,
		`INSERT INTO delta_state (source, change_token, has_more, last_sync_at, error)
		 VALUES ($1, $2, $3, now(), $4)
		 ON CONFLICT (source) DO UPDATE SET
		   change_token = $2,
		   has_more = $3,
		   last_sync_at = now(),
		   error = $4`,
		source, changeToken, hasMore, errMsg)
	return err
}
