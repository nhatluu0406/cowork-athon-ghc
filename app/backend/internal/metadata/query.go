package metadata

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// DeltaStateStore handles delta_state CRUD
type DeltaStateStore struct {
	db *DB
}

func (ds *DeltaStateStore) GetBySource(ctx context.Context, source string) (map[string]interface{}, error) {
	var changeToken string
	var hasMore bool
	var lastSyncAt time.Time

	err := ds.db.QueryRow(ctx,
		"SELECT change_token, has_more, last_sync_at FROM delta_state WHERE source = $1",
		source).Scan(&changeToken, &hasMore, &lastSyncAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("GetBySource: %w", err)
	}

	return map[string]interface{}{
		"source":       source,
		"change_token": changeToken,
		"has_more":     hasMore,
		"last_sync_at": lastSyncAt,
	}, nil
}

func (ds *DeltaStateStore) Upsert(ctx context.Context, source, changeToken string, hasMore bool) error {
	now := time.Now().UTC()
	_, err := ds.db.Exec(ctx,
		`INSERT INTO delta_state (source, change_token, has_more, last_sync_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (source) DO UPDATE SET
		 change_token = EXCLUDED.change_token,
		 has_more = EXCLUDED.has_more,
		 last_sync_at = EXCLUDED.last_sync_at`,
		source, changeToken, hasMore, now)

	if err != nil {
		return fmt.Errorf("DeltaStateStore.Upsert: %w", err)
	}
	return nil
}

// FileStore handles m365_files CRUD
type FileStore struct {
	db *DB
}

func (fs *FileStore) Create(ctx context.Context, sourceType, sourceID, fileName, fileType string,
	fileSize int64, contentHash string, permissionsJSON []byte) (int64, error) {

	var id int64
	now := time.Now().UTC()
	err := fs.db.QueryRow(ctx,
		`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at, permissions_json)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id`,
		sourceType, sourceID, nil, fileName, fileType, fileSize, contentHash, now, now, permissionsJSON).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("FileStore.Create: %w", err)
	}
	return id, nil
}

// CreateWithDriveID creates a file record with a drive_id (for OneDrive files)
func (fs *FileStore) CreateWithDriveID(ctx context.Context, sourceType, sourceID, driveID, fileName, fileType string,
	fileSize int64, contentHash string, permissionsJSON []byte) (int64, error) {

	var id int64
	now := time.Now().UTC()
	err := fs.db.QueryRow(ctx,
		`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at, permissions_json)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id`,
		sourceType, sourceID, driveID, fileName, fileType, fileSize, contentHash, now, now, permissionsJSON).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("FileStore.CreateWithDriveID: %w", err)
	}
	return id, nil
}

func (fs *FileStore) GetBySourceID(ctx context.Context, sourceID string) (int64, error) {
	var id int64
	err := fs.db.QueryRow(ctx,
		"SELECT id FROM m365_files WHERE source_id = $1", sourceID).Scan(&id)

	if err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, fmt.Errorf("FileStore.GetBySourceID: %w", err)
	}
	return id, nil
}

// ChunkStore handles chunks CRUD
type ChunkStore struct {
	db *DB
}

func (cs *ChunkStore) Create(ctx context.Context, fileID int64, chunkIndex int, text, contentHash, headingPath string) (int64, error) {
	var id int64
	err := cs.db.QueryRow(ctx,
		`INSERT INTO chunks (file_id, chunk_index, text, content_hash, heading_path)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		fileID, chunkIndex, text, contentHash, headingPath).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("ChunkStore.Create: %w", err)
	}
	return id, nil
}

func (cs *ChunkStore) GetByFileID(ctx context.Context, fileID int64) ([]map[string]interface{}, error) {
	rows, err := cs.db.Query(ctx,
		"SELECT id, chunk_index, text, content_hash, heading_path FROM chunks WHERE file_id = $1 ORDER BY chunk_index",
		fileID)

	if err != nil {
		return nil, fmt.Errorf("ChunkStore.GetByFileID: %w", err)
	}
	defer rows.Close()

	var chunks []map[string]interface{}
	for rows.Next() {
		var id, chunkIndex int
		var text, contentHash, headingPath string
		if err := rows.Scan(&id, &chunkIndex, &text, &contentHash, &headingPath); err != nil {
			return nil, fmt.Errorf("ChunkStore.GetByFileID scan: %w", err)
		}
		chunks = append(chunks, map[string]interface{}{
			"id":           id,
			"chunk_index":  chunkIndex,
			"text":         text,
			"content_hash": contentHash,
			"heading_path": headingPath,
		})
	}
	return chunks, nil
}

// ConnectionStore handles m365_connections CRUD
type ConnectionStore struct {
	db *DB
}

func (cs *ConnectionStore) Create(ctx context.Context, name, connType, tenantID string, configJSON []byte) (int64, error) {
	var id int64
	now := time.Now().UTC()
	err := cs.db.QueryRow(ctx,
		`INSERT INTO m365_connections (name, type, tenant_id, config_json, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		name, connType, tenantID, configJSON, "active", now).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("ConnectionStore.Create: %w", err)
	}
	return id, nil
}

func (cs *ConnectionStore) List(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := cs.db.Query(ctx,
		"SELECT id, name, type, tenant_id, status, created_at FROM m365_connections ORDER BY created_at DESC")

	if err != nil {
		return nil, fmt.Errorf("ConnectionStore.List: %w", err)
	}
	defer rows.Close()

	var conns []map[string]interface{}
	for rows.Next() {
		var id int64
		var name, connType, tenantID, status string
		var createdAt time.Time

		if err := rows.Scan(&id, &name, &connType, &tenantID, &status, &createdAt); err != nil {
			return nil, fmt.Errorf("ConnectionStore.List scan: %w", err)
		}
		conns = append(conns, map[string]interface{}{
			"id":         id,
			"name":       name,
			"type":       connType,
			"tenant_id":  tenantID,
			"status":     status,
			"created_at": createdAt,
		})
	}
	return conns, nil
}

// PermissionStore handles permission_cache CRUD
type PermissionStore struct {
	db *DB
}

func (ps *PermissionStore) SetUserFilePermission(ctx context.Context, userID string, fileID int64, permission string) error {
	_, err := ps.db.Exec(ctx,
		`INSERT INTO permission_cache (user_id, file_id, permission)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, file_id) DO UPDATE SET permission = EXCLUDED.permission`,
		userID, fileID, permission)

	if err != nil {
		return fmt.Errorf("PermissionStore.SetUserFilePermission: %w", err)
	}
	return nil
}

func (ps *PermissionStore) GetUserFilePermissions(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	rows, err := ps.db.Query(ctx,
		"SELECT file_id, permission FROM permission_cache WHERE user_id = $1",
		userID)

	if err != nil {
		return nil, fmt.Errorf("PermissionStore.GetUserFilePermissions: %w", err)
	}
	defer rows.Close()

	var perms []map[string]interface{}
	for rows.Next() {
		var fileID int64
		var permission string
		if err := rows.Scan(&fileID, &permission); err != nil {
			return nil, fmt.Errorf("PermissionStore.GetUserFilePermissions scan: %w", err)
		}
		perms = append(perms, map[string]interface{}{
			"file_id":    fileID,
			"permission": permission,
		})
	}
	return perms, nil
}

// EmbeddingModelStore handles embedding_models CRUD
type EmbeddingModelStore struct {
	db *DB
}

func (ems *EmbeddingModelStore) GetOrCreate(ctx context.Context, name string, version string, dims int) (int64, error) {
	var id int64

	err := ems.db.QueryRow(ctx,
		"SELECT id FROM embedding_models WHERE name = $1 AND COALESCE(version, '') = COALESCE($2, '')",
		name, version).Scan(&id)

	if err == nil {
		return id, nil
	}

	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("EmbeddingModelStore.GetOrCreate query: %w", err)
	}

	now := time.Now().UTC()
	err = ems.db.QueryRow(ctx,
		`INSERT INTO embedding_models (name, version, dims, created_at)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id`,
		name, version, dims, now).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("EmbeddingModelStore.GetOrCreate insert: %w", err)
	}
	return id, nil
}

// ChunkEmbeddingStore handles chunk_embeddings CRUD
type ChunkEmbeddingStore struct {
	db *DB
}

func (ces *ChunkEmbeddingStore) Upsert(ctx context.Context, chunkID, modelID int64, embedding []byte) error {
	_, err := ces.db.Exec(ctx,
		`INSERT INTO chunk_embeddings (chunk_id, model_id, embedding, created_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (chunk_id, model_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
		chunkID, modelID, embedding, time.Now().UTC())

	if err != nil {
		return fmt.Errorf("ChunkEmbeddingStore.Upsert: %w", err)
	}
	return nil
}

// EmbeddingJobStore handles embedding_jobs CRUD
type EmbeddingJobStore struct {
	db *DB
}

func (ejs *EmbeddingJobStore) Create(ctx context.Context, modelID int64) (int64, error) {
	var id int64
	now := time.Now().UTC()
	err := ejs.db.QueryRow(ctx,
		`INSERT INTO embedding_jobs (status, model_id, created_at)
		 VALUES ($1, $2, $3)
		 RETURNING id`,
		"queued", modelID, now).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("EmbeddingJobStore.Create: %w", err)
	}
	return id, nil
}

func (ejs *EmbeddingJobStore) UpdateStatus(ctx context.Context, jobID int64, status, errorMsg string) error {
	now := time.Now().UTC()
	query := "UPDATE embedding_jobs SET status = $1, finished_at = $2"
	args := []interface{}{status, now}

	if errorMsg != "" {
		query += ", error = $3"
		args = append(args, errorMsg)
	}

	query += " WHERE id = $4"
	args = append(args, jobID)

	_, err := ejs.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("EmbeddingJobStore.UpdateStatus: %w", err)
	}
	return nil
}

// QueryLogStore handles query_logs CRUD
type QueryLogStore struct {
	db *DB
}

func (qls *QueryLogStore) Create(ctx context.Context, userID, queryText, intent string, resultsCount, latencyMs int) (int64, error) {
	var id int64
	now := time.Now().UTC()
	err := qls.db.QueryRow(ctx,
		`INSERT INTO query_logs (user_id, query_text, intent, results_count, latency_ms, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		userID, queryText, intent, resultsCount, latencyMs, now).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("QueryLogStore.Create: %w", err)
	}
	return id, nil
}

// FeedbackStore handles feedback_events CRUD
type FeedbackStore struct {
	db *DB
}

func (fs *FeedbackStore) Create(ctx context.Context, queryID int64, userID, feedbackType, comment string) (int64, error) {
	var id int64
	now := time.Now().UTC()
	err := fs.db.QueryRow(ctx,
		`INSERT INTO feedback_events (query_id, user_id, feedback_type, comment, created_at)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		queryID, userID, feedbackType, comment, now).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("FeedbackStore.Create: %w", err)
	}
	return id, nil
}

// ExtractionConfidenceStore handles extraction_confidence CRUD
type ExtractionConfidenceStore struct {
	db *DB
}

func (ecs *ExtractionConfidenceStore) Upsert(ctx context.Context, entityID, relationshipType, targetEntityID string, confidence float64) error {
	now := time.Now().UTC()
	_, err := ecs.db.Exec(ctx,
		`INSERT INTO extraction_confidence (entity_id, relationship_type, target_entity_id, confidence, created_at)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (entity_id, relationship_type, target_entity_id) DO UPDATE SET confidence = EXCLUDED.confidence`,
		entityID, relationshipType, targetEntityID, confidence, now)

	if err != nil {
		return fmt.Errorf("ExtractionConfidenceStore.Upsert: %w", err)
	}
	return nil
}

func (ecs *ExtractionConfidenceStore) GetLowConfidence(ctx context.Context, threshold float64) ([]map[string]interface{}, error) {
	rows, err := ecs.db.Query(ctx,
		"SELECT entity_id, relationship_type, target_entity_id, confidence FROM extraction_confidence WHERE confidence < $1 ORDER BY confidence ASC LIMIT 100",
		threshold)

	if err != nil {
		return nil, fmt.Errorf("ExtractionConfidenceStore.GetLowConfidence: %w", err)
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var entityID, relType, targetID string
		var confidence float64
		if err := rows.Scan(&entityID, &relType, &targetID, &confidence); err != nil {
			return nil, fmt.Errorf("ExtractionConfidenceStore.GetLowConfidence scan: %w", err)
		}
		results = append(results, map[string]interface{}{
			"entity_id":         entityID,
			"relationship_type": relType,
			"target_entity_id":  targetID,
			"confidence":        confidence,
		})
	}
	return results, nil
}

// QueryBuilders expose store constructors
func NewDeltaStateStore(db *DB) *DeltaStateStore {
	return &DeltaStateStore{db}
}

func NewFileStore(db *DB) *FileStore {
	return &FileStore{db}
}

func NewChunkStore(db *DB) *ChunkStore {
	return &ChunkStore{db}
}

func NewConnectionStore(db *DB) *ConnectionStore {
	return &ConnectionStore{db}
}

func NewPermissionStore(db *DB) *PermissionStore {
	return &PermissionStore{db}
}

func NewEmbeddingModelStore(db *DB) *EmbeddingModelStore {
	return &EmbeddingModelStore{db}
}

func NewChunkEmbeddingStore(db *DB) *ChunkEmbeddingStore {
	return &ChunkEmbeddingStore{db}
}

func NewEmbeddingJobStore(db *DB) *EmbeddingJobStore {
	return &EmbeddingJobStore{db}
}

func NewQueryLogStore(db *DB) *QueryLogStore {
	return &QueryLogStore{db}
}

func NewFeedbackStore(db *DB) *FeedbackStore {
	return &FeedbackStore{db}
}

func NewExtractionConfidenceStore(db *DB) *ExtractionConfidenceStore {
	return &ExtractionConfidenceStore{db}
}
