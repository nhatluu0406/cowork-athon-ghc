package parsers

import (
	"crypto/md5"
	"fmt"
	"strings"
)

const (
	DefaultChunkSize     = 512
	DefaultChunkOverlap  = 128
	MinimumChunkSize     = 100
)

type Chunker struct {
	chunkSize int
	overlap   int
}

func NewChunker(chunkSize, overlap int) *Chunker {
	if chunkSize < MinimumChunkSize {
		chunkSize = DefaultChunkSize
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 2
	}
	return &Chunker{
		chunkSize: chunkSize,
		overlap:   overlap,
	}
}

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

			if i < len(words)-1 {
				if c.overlap > 0 && chunkWordCount > c.overlap {
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
					currentChunk.Reset()
					chunkWordCount = 0
				}
			}
		}
	}

	return chunks
}

func md5Hex(text string) string {
	hash := md5.Sum([]byte(text))
	return fmt.Sprintf("%x", hash)
}
