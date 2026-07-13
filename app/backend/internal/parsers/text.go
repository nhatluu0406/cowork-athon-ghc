package parsers

import "strings"

type Chunk struct {
	Text        string
	ChunkIndex  int
	HeadingPath string
	ContentHash string
}

type Parser interface {
	Parse(data []byte) ([]Chunk, error)
}

type TextParser struct {
	chunkSize int
	overlap   int
}

func NewTextParser(chunkSize, overlap int) *TextParser {
	return &TextParser{chunkSize: chunkSize, overlap: overlap}
}

func (tp *TextParser) Parse(data []byte) ([]Chunk, error) {
	text := string(data)
	lines := strings.Split(text, "\n")

	var chunks []Chunk
	var currentChunk strings.Builder
	chunkIndex := 0

	for _, line := range lines {
		if currentChunk.Len()+len(line) > tp.chunkSize && currentChunk.Len() > 0 {
			chunks = append(chunks, Chunk{
				Text:       currentChunk.String(),
				ChunkIndex: chunkIndex,
			})
			chunkIndex++
			currentChunk.Reset()
		}
		currentChunk.WriteString(line + "\n")
	}

	if currentChunk.Len() > 0 {
		chunks = append(chunks, Chunk{
			Text:       currentChunk.String(),
			ChunkIndex: chunkIndex,
		})
	}

	return chunks, nil
}
