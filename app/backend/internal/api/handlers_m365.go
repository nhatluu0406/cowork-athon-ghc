package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// M365Deps bundles the dependencies HandleM365* handlers need to reach real
// persistence (m365_connections/delta_state) and the real connectors
// (onedrive.go/teams.go/delta.go) — tasks.md T187.
type M365Deps struct {
	DB           *sql.DB
	M365ClientID string // used along with each connection's own tenant_id to mint an app-only Graph token for sync
	M365Secret   string
}

type M365ConnectRequest struct {
	Name     string            `json:"name"`
	Type     string            `json:"type"` // "onedrive" | "teams"
	TenantID string            `json:"tenant_id"`
	Config   map[string]string `json:"config"`
}

type M365ConnectResponse struct {
	ID     int64  `json:"id"`
	Status string `json:"status"`
}

// HandleM365Connect wires POST /api/m365/connect to a real insert into
// m365_connections (tasks.md T187).
func HandleM365Connect(deps *M365Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req M365ConnectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		if req.Name == "" || req.Type == "" || req.TenantID == "" {
			http.Error(w, "name, type, and tenant_id are required", http.StatusBadRequest)
			return
		}
		if req.Type != "onedrive" && req.Type != "teams" {
			http.Error(w, "type must be 'onedrive' or 'teams'", http.StatusBadRequest)
			return
		}

		configJSON, err := json.Marshal(req.Config)
		if err != nil {
			http.Error(w, "invalid config: "+err.Error(), http.StatusBadRequest)
			return
		}

		var id int64
		err = deps.DB.QueryRowContext(r.Context(),
			`INSERT INTO m365_connections (name, type, tenant_id, config_json, status)
			 VALUES ($1, $2, $3, $4, 'active')
			 RETURNING id`,
			req.Name, req.Type, req.TenantID, configJSON).Scan(&id)
		if err != nil {
			http.Error(w, "failed to persist connection: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := M365ConnectResponse{ID: id, Status: "active"}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type m365SyncRequest struct {
	ConnectionID int64  `json:"connection_id,omitempty"`
	Source       string `json:"source,omitempty"` // legacy free-form form, e.g. "onedrive:/site/drive-1"
	DriveID      string `json:"drive_id,omitempty"`
}

// HandleM365Sync wires POST /api/m365/sync to the real connectors (tasks.md
// T187): it loads the connection's persisted config, builds an app-only
// Microsoft Graph token via the client-credentials grant, and calls
// OneDriveConnector.GetDelta / TeamsConnector.ListTeams before recording the
// resulting delta token via DeltaSyncCoordinator.SaveChangeToken.
//
// This performs the sync synchronously and reports how many items were seen
// rather than truly backgrounding a job (there is no job queue in this
// service yet) — the response still reports job_started for API
// compatibility with the documented contract.
func HandleM365Sync(deps *M365Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req m365SyncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		conn, err := resolveConnection(r.Context(), deps.DB, req)
		if err != nil {
			http.Error(w, "failed to resolve connection: "+err.Error(), http.StatusBadRequest)
			return
		}
		if conn == nil {
			http.Error(w, "connection not found", http.StatusNotFound)
			return
		}

		tokenFunc := graphTokenFunc(deps.M365ClientID, deps.M365Secret, conn.TenantID)
		client := connectors.NewGraphClient(tokenFunc)

		sourceKey := fmt.Sprintf("%s:%d", conn.Type, conn.ID)
		itemCount := 0

		switch conn.Type {
		case "onedrive":
			driveID := req.DriveID
			if driveID == "" {
				driveID = conn.Config["drive_id"]
			}
			if driveID == "" {
				http.Error(w, "drive_id is required for onedrive sync (pass it in the request or store it in the connection config)", http.StatusBadRequest)
				return
			}

			oneDrive := connectors.NewOneDriveConnector(client)
			teams := connectors.NewTeamsConnector(client)
			coordinator := connectors.NewDeltaSyncCoordinator(deps.DB, oneDrive, teams)

			count, err := coordinator.SyncOneDrive(r.Context(), conn.TenantID, driveID)
			if err != nil {
				http.Error(w, "onedrive sync failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			itemCount = count

		case "teams":
			teams := connectors.NewTeamsConnector(client)
			teamList, err := teams.ListTeams(r.Context())
			if err != nil {
				http.Error(w, "teams sync failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			itemCount = len(teamList)

			if err := saveDeltaState(r.Context(), deps.DB, sourceKey, ""); err != nil {
				http.Error(w, "failed to record sync state: "+err.Error(), http.StatusInternalServerError)
				return
			}

		default:
			http.Error(w, "unsupported connection type: "+conn.Type, http.StatusBadRequest)
			return
		}

		resp := map[string]interface{}{
			"job_started": true,
			"source":      sourceKey,
			"items_seen":  itemCount,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// HandleM365SyncStatus wires GET /api/m365/sync/status to real rows from
// delta_state (tasks.md T187).
func HandleM365SyncStatus(deps *M365Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		rows, err := deps.DB.QueryContext(r.Context(),
			`SELECT source, has_more, last_sync_at FROM delta_state ORDER BY last_sync_at DESC`)
		if err != nil {
			http.Error(w, "failed to query sync status: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var result []map[string]interface{}
		for rows.Next() {
			var source string
			var hasMore bool
			var lastSyncAt interface{}
			if err := rows.Scan(&source, &hasMore, &lastSyncAt); err != nil {
				http.Error(w, "failed to scan sync status: "+err.Error(), http.StatusInternalServerError)
				return
			}
			state := "IDLE"
			if hasMore {
				state = "RUNNING"
			}
			result = append(result, map[string]interface{}{
				"source":       source,
				"state":        state,
				"last_sync_at": lastSyncAt,
			})
		}
		if result == nil {
			result = []map[string]interface{}{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// HandleM365Sources wires GET /api/m365/sources to real rows from
// m365_connections, left-joined against delta_state for last_sync_at
// (tasks.md T187).
func HandleM365Sources(deps *M365Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		rows, err := deps.DB.QueryContext(r.Context(), `
			SELECT c.id, c.name, c.type, c.status, d.last_sync_at
			FROM m365_connections c
			LEFT JOIN delta_state d ON d.source = c.type || ':' || c.id::text
			ORDER BY c.id`)
		if err != nil {
			http.Error(w, "failed to query sources: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var result []map[string]interface{}
		for rows.Next() {
			var id int64
			var name, connType, status string
			var lastSyncAt sql.NullTime
			if err := rows.Scan(&id, &name, &connType, &status, &lastSyncAt); err != nil {
				http.Error(w, "failed to scan sources: "+err.Error(), http.StatusInternalServerError)
				return
			}
			entry := map[string]interface{}{
				"id":     id,
				"name":   name,
				"type":   connType,
				"status": status,
			}
			if lastSyncAt.Valid {
				entry["last_sync_at"] = lastSyncAt.Time
			} else {
				entry["last_sync_at"] = nil
			}
			result = append(result, entry)
		}
		if result == nil {
			result = []map[string]interface{}{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

type m365Connection struct {
	ID       int64
	Name     string
	Type     string
	TenantID string
	Config   map[string]string
}

// resolveConnection looks up the target connection either by connection_id
// or by a legacy "type:name" source string.
func resolveConnection(ctx context.Context, db *sql.DB, req m365SyncRequest) (*m365Connection, error) {
	var row *sql.Row
	if req.ConnectionID != 0 {
		row = db.QueryRowContext(ctx,
			`SELECT id, name, type, tenant_id, config_json FROM m365_connections WHERE id = $1`, req.ConnectionID)
	} else if req.Source != "" {
		row = db.QueryRowContext(ctx,
			`SELECT id, name, type, tenant_id, config_json FROM m365_connections WHERE type || ':' || name = $1 OR type || ':' || id::text = $1
			 ORDER BY id LIMIT 1`, req.Source)
	} else {
		return nil, fmt.Errorf("connection_id or source is required")
	}

	var conn m365Connection
	var configJSON []byte
	if err := row.Scan(&conn.ID, &conn.Name, &conn.Type, &conn.TenantID, &configJSON); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	conn.Config = map[string]string{}
	if len(configJSON) > 0 {
		_ = json.Unmarshal(configJSON, &conn.Config)
	}

	return &conn, nil
}

func saveDeltaState(ctx context.Context, db *sql.DB, source, token string) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO delta_state (source, change_token, has_more, last_sync_at)
		 VALUES ($1, $2, false, now())
		 ON CONFLICT (source) DO UPDATE SET change_token = $2, last_sync_at = now()`,
		source, token)
	return err
}

// graphTokenFunc returns a token provider for connectors.GraphClient using
// the client-credentials grant against Entra ID (app-only Graph access —
// distinct from the user-delegated auth-code flow used by HandleLogin). A
// fresh EntraIDAuth is built per-tenant since each m365_connections row may
// belong to a different Entra tenant even though the app registration
// (client ID/secret) is shared.
func graphTokenFunc(clientID, clientSecret, tenantID string) func() (string, error) {
	return func() (string, error) {
		if clientID == "" || clientSecret == "" || tenantID == "" {
			return "", fmt.Errorf("m365 connector: M365_CLIENT_ID/M365_CLIENT_SECRET/tenant_id not configured")
		}
		entraAuth := auth.NewEntraIDAuth(tenantID, clientID, clientSecret)
		tokenResp, err := entraAuth.ClientCredentialsToken(context.Background())
		if err != nil {
			return "", fmt.Errorf("m365 connector: client-credentials token: %w", err)
		}
		return tokenResp.AccessToken, nil
	}
}
