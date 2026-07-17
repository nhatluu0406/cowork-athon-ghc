package embedding

import (
	"context"
)

type EmbeddingRuntime interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

type BatchEmbedder struct {
	runtime   EmbeddingRuntime
	batchSize int
}

func NewBatchEmbedder(runtime EmbeddingRuntime, batchSize int) *BatchEmbedder {
	return &BatchEmbedder{
		runtime:   runtime,
		batchSize: batchSize,
	}
}

func (be *BatchEmbedder) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	var allEmbeddings [][]float32

	for i := 0; i < len(texts); i += be.batchSize {
		end := i + be.batchSize
		if end > len(texts) {
			end = len(texts)
		}

		batch := texts[i:end]
		embeddings, err := be.runtime.Embed(ctx, batch)
		if err != nil {
			return nil, err
		}

		allEmbeddings = append(allEmbeddings, embeddings...)
	}

	return allEmbeddings, nil
}
