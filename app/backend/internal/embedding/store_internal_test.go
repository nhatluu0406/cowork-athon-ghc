package embedding

import (
	"math"
	"testing"
)

func TestCosineSimilarity_IdenticalVectors(t *testing.T) {
	a := []float32{1, 2, 3}
	b := []float32{1, 2, 3}
	got := cosineSimilarity(a, b)
	if math.Abs(got-1.0) > 1e-6 {
		t.Errorf("expected cosine similarity 1.0 for identical vectors, got %v", got)
	}
}

func TestCosineSimilarity_OrthogonalVectors(t *testing.T) {
	a := []float32{1, 0}
	b := []float32{0, 1}
	got := cosineSimilarity(a, b)
	if math.Abs(got) > 1e-6 {
		t.Errorf("expected cosine similarity 0.0 for orthogonal vectors, got %v", got)
	}
}

func TestCosineSimilarity_OppositeVectors(t *testing.T) {
	a := []float32{1, 0}
	b := []float32{-1, 0}
	got := cosineSimilarity(a, b)
	if math.Abs(got-(-1.0)) > 1e-6 {
		t.Errorf("expected cosine similarity -1.0 for opposite vectors, got %v", got)
	}
}

func TestCosineSimilarity_MismatchedLength(t *testing.T) {
	a := []float32{1, 2, 3}
	b := []float32{1, 2}
	got := cosineSimilarity(a, b)
	if got != 0 {
		t.Errorf("expected 0 for mismatched-length vectors, got %v", got)
	}
}

func TestCosineSimilarity_ZeroVector(t *testing.T) {
	a := []float32{0, 0, 0}
	b := []float32{1, 2, 3}
	got := cosineSimilarity(a, b)
	if got != 0 {
		t.Errorf("expected 0 when one vector is all-zero, got %v", got)
	}
}

func TestEncodeDecodeFloat32Slice_RoundTrip(t *testing.T) {
	original := []float32{0.1, -0.5, 3.14159, 0, -1000.25}
	encoded := encodeFloat32Slice(original)
	decoded := decodeFloat32Slice(encoded)

	if len(decoded) != len(original) {
		t.Fatalf("expected %d floats after round-trip, got %d", len(original), len(decoded))
	}
	for i := range original {
		if decoded[i] != original[i] {
			t.Errorf("index %d: expected %v, got %v", i, original[i], decoded[i])
		}
	}
}

func TestSortScoredChunksDesc(t *testing.T) {
	chunks := []ScoredChunk{
		{ChunkID: 1, Score: 0.5},
		{ChunkID: 2, Score: 0.9},
		{ChunkID: 3, Score: 0.1},
	}
	sortScoredChunksDesc(chunks)

	if chunks[0].ChunkID != 2 || chunks[1].ChunkID != 1 || chunks[2].ChunkID != 3 {
		t.Errorf("expected order [2,1,3] by descending score, got %+v", chunks)
	}
}
