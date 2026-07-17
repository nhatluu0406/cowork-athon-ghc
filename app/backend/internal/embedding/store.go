package embedding

import (
	"context"
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
)

// Store persists and retrieves embedding vectors in PostgreSQL, per
// data-model.md §1.6-1.7: embedding_models (name/version/dims) and
// chunk_embeddings (chunk_id, model_id, embedding BYTEA).
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// EnsureModel returns the embedding_models.id for (name, version), inserting
// it if it doesn't exist yet. Re-embedding after a model change is possible
// because vectors are keyed by (chunk_id, model_id).
func (s *Store) EnsureModel(ctx context.Context, name, version string, dims int) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM embedding_models WHERE name = $1 AND COALESCE(version, '') = COALESCE($2, '')`,
		name, version).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("embedding.Store.EnsureModel: query: %w", err)
	}

	err = s.db.QueryRowContext(ctx,
		`INSERT INTO embedding_models (name, version, dims) VALUES ($1, $2, $3) RETURNING id`,
		name, version, dims).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("embedding.Store.EnsureModel: insert: %w", err)
	}
	return id, nil
}

// SaveEmbedding upserts a single chunk's embedding for a given model.
func (s *Store) SaveEmbedding(ctx context.Context, chunkID, modelID int64, vec []float32) error {
	buf := encodeFloat32Slice(vec)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO chunk_embeddings (chunk_id, model_id, embedding)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (chunk_id, model_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
		chunkID, modelID, buf)
	if err != nil {
		return fmt.Errorf("embedding.Store.SaveEmbedding: %w", err)
	}
	return nil
}

// ScoredChunk is a chunk_id + cosine similarity score against a query vector.
type ScoredChunk struct {
	ChunkID int64
	Score   float64
}

// SearchSimilar performs brute-force cosine similarity search across all
// embeddings for the given model, returning the topK highest-scoring chunks.
//
// research.md §6 decision: no pgvector at this POC's data volume (~10K docs);
// brute-force is acceptable. Revisit if corpus size grows (spec §18 Open Q4).
func (s *Store) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]ScoredChunk, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT chunk_id, embedding FROM chunk_embeddings WHERE model_id = $1`, modelID)
	if err != nil {
		return nil, fmt.Errorf("embedding.Store.SearchSimilar: query: %w", err)
	}
	defer rows.Close()

	var scored []ScoredChunk
	for rows.Next() {
		var chunkID int64
		var raw []byte
		if err := rows.Scan(&chunkID, &raw); err != nil {
			return nil, fmt.Errorf("embedding.Store.SearchSimilar: scan: %w", err)
		}
		vec := decodeFloat32Slice(raw)
		score := cosineSimilarity(queryVec, vec)
		scored = append(scored, ScoredChunk{ChunkID: chunkID, Score: score})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("embedding.Store.SearchSimilar: rows: %w", err)
	}

	sortScoredChunksDesc(scored)
	if topK > 0 && len(scored) > topK {
		scored = scored[:topK]
	}
	return scored, nil
}

func sortScoredChunksDesc(s []ScoredChunk) {
	// Simple insertion sort — result sets are small (bounded by corpus size
	// at this POC's ~10K docs scale, per research.md §6).
	for i := 1; i < len(s); i++ {
		j := i
		for j > 0 && s[j-1].Score < s[j].Score {
			s[j-1], s[j] = s[j], s[j-1]
			j--
		}
	}
}

func cosineSimilarity(a, b []float32) float64 {
	if len(a) == 0 || len(b) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

func encodeFloat32Slice(vec []float32) []byte {
	buf := make([]byte, 4*len(vec))
	for i, f := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	return buf
}

func decodeFloat32Slice(buf []byte) []float32 {
	n := len(buf) / 4
	vec := make([]float32, n)
	for i := 0; i < n; i++ {
		vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(buf[i*4:]))
	}
	return vec
}
