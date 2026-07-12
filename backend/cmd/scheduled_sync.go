package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/rad-system/m365-knowledge-graph/internal/api"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// runScheduledDeltaSync is the real callback for the periodic delta-sync
// scheduler (tasks.md T115/T125). It replicates HandleM365Sync's per-connection
// sync logic (internal/api/handlers_m365.go) across every active row in
// m365_connections, instead of relying solely on a manually-triggered
// POST /api/m365/sync call. A failure syncing one connection is logged and
// skipped rather than aborting the whole tick, so one bad connection can't
// starve the rest.
// Group G: permissionExtractor populates permission_cache via RefreshCache after each sync.
func runScheduledDeltaSync(ctx context.Context, deps *api.M365Deps, permissionExtractor *connectors.PermissionExtractor, logger *slog.Logger) error {
	rows, err := deps.DB.QueryContext(ctx,
		`SELECT id, type, tenant_id, config_json FROM m365_connections WHERE status = 'active' ORDER BY id`)
	if err != nil {
		return fmt.Errorf("scheduled delta sync: failed to list active connections: %w", err)
	}
	defer rows.Close()

	type conn struct {
		id       int64
		connType string
		tenantID string
		config   map[string]string
	}
	var conns []conn
	for rows.Next() {
		var c conn
		var configJSON []byte
		if err := rows.Scan(&c.id, &c.connType, &c.tenantID, &configJSON); err != nil {
			return fmt.Errorf("scheduled delta sync: failed to scan connection row: %w", err)
		}
		c.config = map[string]string{}
		if len(configJSON) > 0 {
			_ = json.Unmarshal(configJSON, &c.config)
		}
		conns = append(conns, c)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("scheduled delta sync: row iteration error: %w", err)
	}

	for _, c := range conns {
		if err := syncOneConnection(ctx, deps.DB, deps.M365ClientID, deps.M365Secret, c.id, c.connType, c.tenantID, c.config, permissionExtractor); err != nil {
			logger.ErrorContext(ctx, "scheduled delta sync: connection failed", "connection_id", c.id, "type", c.connType, "err", err)
			continue
		}
		logger.InfoContext(ctx, "scheduled delta sync: connection synced", "connection_id", c.id, "type", c.connType)
	}

	return nil
}

func syncOneConnection(ctx context.Context, db *sql.DB, m365ClientID, m365Secret string, connID int64, connType, tenantID string, config map[string]string, permissionExtractor *connectors.PermissionExtractor) error {
	tokenFunc := func() (string, error) {
		if m365ClientID == "" || m365Secret == "" || tenantID == "" {
			return "", fmt.Errorf("m365 connector: M365_CLIENT_ID/M365_CLIENT_SECRET/tenant_id not configured")
		}
		entraAuth := auth.NewEntraIDAuth(tenantID, m365ClientID, m365Secret)
		tokenResp, err := entraAuth.ClientCredentialsToken(ctx)
		if err != nil {
			return "", fmt.Errorf("m365 connector: client-credentials token: %w", err)
		}
		return tokenResp.AccessToken, nil
	}
	client := connectors.NewGraphClient(tokenFunc)

	switch connType {
	case "onedrive":
		driveID := config["drive_id"]
		if driveID == "" {
			return fmt.Errorf("onedrive connection %d has no drive_id in its stored config", connID)
		}

		oneDrive := connectors.NewOneDriveConnector(client)
		teams := connectors.NewTeamsConnector(client)
		coordinator := connectors.NewDeltaSyncCoordinator(db, oneDrive, teams)

		if _, err := coordinator.SyncOneDrive(ctx, tenantID, driveID); err != nil {
			return fmt.Errorf("onedrive sync failed: %w", err)
		}

		// Group G (T150): Refresh permission cache after delta sync.
		// RefreshCache fetches latest ACLs from MS Graph for all ingested files
		// and populates permission_cache. Full re-pull strategy per spec §18.5.
		if permissionExtractor != nil {
			if err := permissionExtractor.RefreshCache(ctx); err != nil {
				slog.WarnContext(ctx, "failed to refresh permission cache after OneDrive sync", "err", err)
				// Don't fail the whole sync if permission refresh fails — log and continue
			}
		}
		return nil

	case "teams":
		teams := connectors.NewTeamsConnector(client)
		if _, err := teams.ListTeams(ctx); err != nil {
			return fmt.Errorf("teams sync failed: %w", err)
		}
		sourceKey := fmt.Sprintf("teams:%d", connID)
		if _, err := db.ExecContext(ctx,
			`INSERT INTO delta_state (source, change_token, has_more, last_sync_at)
			 VALUES ($1, '', false, now())
			 ON CONFLICT (source) DO UPDATE SET last_sync_at = now()`,
			sourceKey); err != nil {
			return fmt.Errorf("failed to record sync state: %w", err)
		}
		return nil

	default:
		return fmt.Errorf("unsupported connection type: %s", connType)
	}
}
