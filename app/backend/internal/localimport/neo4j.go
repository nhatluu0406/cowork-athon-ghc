package localimport

import (
	"context"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// LocalNeo4jClient manages Neo4j operations for local documents.
type LocalNeo4jClient struct {
	driver neo4j.DriverWithContext
}

// NewLocalNeo4jClient creates a new Neo4j client for local documents.
func NewLocalNeo4jClient(driver neo4j.DriverWithContext) *LocalNeo4jClient {
	return &LocalNeo4jClient{driver: driver}
}

// UpsertSource creates or updates a LocalSource node in Neo4j.
func (c *LocalNeo4jClient) UpsertSource(ctx context.Context, source *LocalSource) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `MERGE (s:LocalSource {source_id: $id})
		SET s.name = $name, s.folder_path = $folder_path, s.status = $status
		RETURN s`

		result, err := tx.Run(ctx, query, map[string]interface{}{
			"id":          source.ID,
			"name":        source.Name,
			"folder_path": source.FolderPath,
			"status":      source.Status,
		})
		if err != nil {
			return nil, err
		}

		_, err = result.Single(ctx)
		return nil, err
	})

	return err
}

// UpsertDocument creates or updates a LocalDocument node and links it to LocalSource.
func (c *LocalNeo4jClient) UpsertDocument(ctx context.Context, file *LocalFile) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// Create/update LocalDocument node
		// MERGE (not MATCH) the LocalSource: a MATCH that misses would drop the row and make
		// result.Single error even though the document node was created. MERGE guarantees the
		// PART_OF link and a returned row.
		query := `MERGE (d:LocalDocument {local_file_id: $file_id})
		SET d.source_id = $source_id, d.rel_path = $rel_path, d.file_name = $file_name,
		    d.mime_type = $mime_type, d.is_binary = $is_binary, d.imported_at = datetime()
		WITH d
		MERGE (s:LocalSource {source_id: $source_id})
		MERGE (d)-[:PART_OF]->(s)
		RETURN d`

		result, err := tx.Run(ctx, query, map[string]interface{}{
			"file_id":   file.ID,
			"source_id": file.SourceID,
			"rel_path":  file.RelPath,
			"file_name": file.FileName,
			"mime_type": file.MimeType,
			"is_binary": file.IsBinary,
		})
		if err != nil {
			return nil, err
		}

		_, err = result.Single(ctx)
		return nil, err
	})

	return err
}

// DeleteDocument removes a LocalDocument node from Neo4j.
func (c *LocalNeo4jClient) DeleteDocument(ctx context.Context, localFileID string) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `MATCH (d:LocalDocument {local_file_id: $file_id})
		DETACH DELETE d`

		result, err := tx.Run(ctx, query, map[string]interface{}{
			"file_id": localFileID,
		})
		if err != nil {
			return nil, err
		}

		summary, err := result.Consume(ctx)
		if err != nil {
			return nil, err
		}

		// Log deletion summary (non-fatal if 0 nodes deleted)
		_ = summary
		return nil, nil
	})

	return err
}

// CreateMentionsRelationship creates a MENTIONS relationship between a LocalDocument and an Entity node.
func (c *LocalNeo4jClient) CreateMentionsRelationship(ctx context.Context, localFileID string, entityType string, entityName string, confidence float64) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// Keep `confidence` OUT of the MERGE pattern: including it there keys the relationship
		// on the value, so a re-import with a changed confidence creates a DUPLICATE MENTIONS
		// edge. MERGE the plain edge, then SET the confidence (update-in-place).
		query := `
		MATCH (d:LocalDocument {local_file_id: $file_id})
		MERGE (e:Entity {type: $entity_type, name: $entity_name})
		MERGE (d)-[r:MENTIONS]->(e)
		SET r.confidence = $confidence
		RETURN d, e, r`

		result, err := tx.Run(ctx, query, map[string]interface{}{
			"file_id":     localFileID,
			"entity_type": entityType,
			"entity_name": entityName,
			"confidence":  confidence,
		})
		if err != nil {
			return nil, err
		}

		_, err = result.Single(ctx)
		return nil, err
	})

	return err
}
