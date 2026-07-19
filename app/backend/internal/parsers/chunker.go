package parsers

import (
	"crypto/md5"
	"fmt"
	"strings"
)

const (
	// DefaultChunkSize is the default number of words per chunk (per spec §10.2)
	DefaultChunkSize = 512
	// DefaultChunkOverlap is the default overlap in words between consecutive chunks (per spec §10.2)
	DefaultChunkOverlap = 128
	// MinimumChunkSize is the minimum acceptable chunk size in words
	MinimumChunkSize = 100
	// MaximumChunkSize prevents excessively large chunks that would bloat embeddings
	MaximumChunkSize = 2000
)

// Chunker implements fixed-size text chunking with configurable overlap.
// Chunks are measured in words (space-delimited tokens) for language-neutral processing.
// Per spec §10.2, overlap ensures context preservation at chunk boundaries.
type Chunker struct {
	chunkSize int
	overlap   int
}

// NewChunker creates a Chunker with validated parameters.
// chunkSize and overlap are measured in words.
// If either parameter is invalid, reasonable defaults are applied.
func NewChunker(chunkSize, overlap int) *Chunker {
	if chunkSize < MinimumChunkSize {
		chunkSize = DefaultChunkSize
	}
	if chunkSize > MaximumChunkSize {
		chunkSize = MaximumChunkSize
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 2
	}
	if overlap < 0 {
		overlap = 0
	}
	return &Chunker{
		chunkSize: chunkSize,
		overlap:   overlap,
	}
}

// ChunkText splits text into fixed-size chunks (measured in words) with configurable overlap.
// Each chunk is identified by:
//   - ChunkIndex: sequential 0-based index of the chunk within the document
//   - Text: the chunk content (space-delimited words)
//   - ContentHash: MD5 hash of the chunk text for deduplication and change detection
//   - HeadingPath: breadcrumb context (e.g., section header) for semantic understanding
//
// Overlap strategy: when overlap > 0, the last N words of chunk[i] become the first N words
// of chunk[i+1], ensuring context preservation across boundaries (per spec §10.2).
func (c *Chunker) ChunkText(text, headingPath string) []Chunk {
	if len(text) == 0 {
		return nil
	}

	words := strings.Fields(text)
	if len(words) == 0 {
		return nil
	}

	var chunks []Chunk
	var currentChunk strings.Builder
	var chunkWordCount int
	chunkIndex := 0

	for i, word := range words {
		if chunkWordCount > 0 {
			currentChunk.WriteString(" ")
		}
		currentChunk.WriteString(word)
		chunkWordCount++

		// Create a new chunk when we reach chunkSize or process the last word
		if chunkWordCount >= c.chunkSize || i == len(words)-1 {
			chunkText := currentChunk.String()
			if len(chunkText) > 0 {
				chunks = append(chunks, Chunk{
					ChunkIndex:  chunkIndex,
					Text:        chunkText,
					ContentHash: md5Hex(chunkText),
					HeadingPath: headingPath,
				})
				chunkIndex++
			}

			// Prepare overlap for the next chunk (if not at end of text)
			if i < len(words)-1 {
				if c.overlap > 0 && chunkWordCount > c.overlap {
					// Extract the last `overlap` words from current chunk as the seed for the next chunk
					overlapStart := chunkWordCount - c.overlap
					overlapWords := strings.Fields(chunkText)
					if overlapStart > 0 && overlapStart < len(overlapWords) {
						currentChunk.Reset()
						for j := overlapStart; j < len(overlapWords); j++ {
							if j > overlapStart {
								currentChunk.WriteString(" ")
							}
							currentChunk.WriteString(overlapWords[j])
						}
						chunkWordCount = len(overlapWords) - overlapStart
					} else {
						currentChunk.Reset()
						chunkWordCount = 0
					}
				} else {
					// No overlap: start fresh
					currentChunk.Reset()
					chunkWordCount = 0
				}
			}
		}
	}

	return chunks
}

// md5Hex computes the MD5 hash of text and returns it as a hexadecimal string.
// Used as a content hash for deduplication and change detection (INVARIANT-4 per spec).
func md5Hex(text string) string {
	hash := md5.Sum([]byte(text))
	return fmt.Sprintf("%x", hash)
}

// ChunkMetrics provides statistics about a chunk for storage in the chunks table.
// Tokens are estimated as words (space-delimited tokens); a more sophisticated
// implementation might use a BPE tokenizer for more accurate counts.
type ChunkMetrics struct {
	TokenCount int // Approximate token count (words)
	ByteCount  int // Exact byte count
}

// ComputeMetrics computes metrics for a chunk text.
func ComputeMetrics(text string) ChunkMetrics {
	words := strings.Fields(text)
	return ChunkMetrics{
		TokenCount: len(words),
		ByteCount:  len(text),
	}
}
