package brain

import (
	"context"
	"encoding/binary"
	"fmt"
	"log/slog"
	"math"

	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
	"google.golang.org/grpc/metadata"
)

// TaskType represents the type of LLM task being performed
type TaskType string

const (
	TaskIntentDetection     TaskType = "intent_detection"      // Stage 1
	TaskQueryNER            TaskType = "query_ner"            // Stage 2
	TaskContextCompression  TaskType = "context_compression"  // Stage 6
	TaskNlpExtraction       TaskType = "nlp_extraction"       // Ingestion-time
	TaskAnswerGeneration    TaskType = "answer_generation"    // Stage 7
	TaskEmbedding           TaskType = "embedding"            // All stages
	TaskReranking           TaskType = "reranking"            // Stage 5
)

// BrainClient wraps llmsvc.Client and adds task-type tagging per spec.md §3.4
// T177: Thin wrapper that tags each RPC call with task-type metadata so llm-svc can route per NLP_MODE
type BrainClient struct {
	llmsvcClient *llmsvc.Client
}

func NewBrainClient(llmsvcAddr string) (*BrainClient, error) {
	client, err := llmsvc.NewClient(llmsvcAddr)
	if err != nil {
		return nil, fmt.Errorf("brain.NewBrainClient: %w", err)
	}
	return &BrainClient{llmsvcClient: client}, nil
}

// LLMSvcClient returns the underlying llmsvc.Client
func (bc *BrainClient) LLMSvcClient() *llmsvc.Client {
	return bc.llmsvcClient
}

// NewBrainClientWithTLS creates a BrainClient with TLS support
func NewBrainClientWithTLS(llmsvcAddr string, tlsCertFile string) (*BrainClient, error) {
	client, err := llmsvc.NewClientWithTLS(llmsvcAddr, tlsCertFile)
	if err != nil {
		return nil, fmt.Errorf("brain.NewBrainClientWithTLS: %w", err)
	}
	return &BrainClient{llmsvcClient: client}, nil
}

// DetectIntent calls llmsvc.Client.DetectIntent with task-type tag (T177)
func (bc *BrainClient) DetectIntent(ctx context.Context, query string, model string) (string, error) {
	ctx = metadata.AppendToOutgoingContext(ctx, "task-type", string(TaskIntentDetection))
	slog.DebugContext(ctx, "brain.DetectIntent", "task_type", TaskIntentDetection, "query_len", len(query))

	intent, err := bc.llmsvcClient.DetectIntent(ctx, query, "")
	if err != nil {
		return "", fmt.Errorf("brain.DetectIntent: %w", err)
	}
	return intent.Intent, nil
}

// ExtractEntities calls llmsvc.Client.ExtractEntities with task-type tag (T177)
func (bc *BrainClient) ExtractEntities(ctx context.Context, text string, taskMode string, schema string) (*NERResult, error) {
	var taskType TaskType
	if taskMode == "ingestion" {
		taskType = TaskNlpExtraction
	} else {
		taskType = TaskQueryNER
	}

	ctx = metadata.AppendToOutgoingContext(ctx, "task-type", string(taskType))
	slog.DebugContext(ctx, "brain.ExtractEntities", "task_type", taskType, "task_mode", taskMode, "text_len", len(text))

	result, err := bc.llmsvcClient.ExtractEntities(ctx, text, taskMode, schema)
	if err != nil {
		return nil, fmt.Errorf("brain.ExtractEntities: %w", err)
	}

	// Convert llmsvc types to brain types
	entities := make([]*Entity, len(result.Entities))
	for i, e := range result.Entities {
		entities[i] = &Entity{
			Name:       e.Name,
			Type:       e.Type,
			Confidence: e.Confidence,
		}
	}

	relationships := make([]*Relationship, len(result.Relationships))
	for i, r := range result.Relationships {
		relationships[i] = &Relationship{
			From:         r.FromEntity,
			Type:         r.RelationshipType,
			To:           r.ToEntity,
			Confidence:   r.Confidence,
		}
	}

	return &NERResult{
		Entities:      entities,
		Relationships: relationships,
	}, nil
}

// Compress calls llmsvc.Client.Compress with task-type tag (T177)
func (bc *BrainClient) Compress(ctx context.Context, context string, targetTokens int, method string) (string, error) {
	ctx = metadata.AppendToOutgoingContext(ctx, "task-type", string(TaskContextCompression))
	result, err := bc.llmsvcClient.Compress(ctx, context, targetTokens, method)
	if err != nil {
		return "", fmt.Errorf("brain.Compress: %w", err)
	}
	return result.CompressedContext, nil
}

// Generate calls llmsvc.Client.Generate with task-type tag (T177)
func (bc *BrainClient) Generate(ctx context.Context, query, context, instructions string, temperature float32, maxTokens int) (string, []string, error) {
	ctx = metadata.AppendToOutgoingContext(ctx, "task-type", string(TaskAnswerGeneration))
	answer, err := bc.llmsvcClient.Generate(ctx, query, context, instructions, temperature, maxTokens)
	if err != nil {
		return "", nil, fmt.Errorf("brain.Generate: %w", err)
	}
	return answer.Answer, answer.Citations, nil
}

// Embed calls llmsvc.Client.Embed with task-type tag (T177)
func (bc *BrainClient) Embed(ctx context.Context, texts []string, model string) ([][]float32, error) {
	ctx = metadata.AppendToOutgoingContext(ctx, "task-type", string(TaskEmbedding))
	embeddings, err := bc.llmsvcClient.Embed(ctx, texts, model)
	if err != nil {
		return nil, fmt.Errorf("brain.Embed: %w", err)
	}

	result := make([][]float32, len(embeddings))
	for i, emb := range embeddings {
		f32, err := bytesToFloat32(emb)
		if err != nil {
			return nil, fmt.Errorf("brain.Embed: decode embedding: %w", err)
		}
		result[i] = f32
	}
	return result, nil
}

// Rerank calls llmsvc.Client.Rerank with task-type tag (T177)
func (bc *BrainClient) Rerank(ctx context.Context, query string, documents []llmsvc.DocumentForReranking, modelName string) ([]llmsvc.ScoredDocument, error) {
	ctx = metadata.AppendToOutgoingContext(ctx, "task-type", string(TaskReranking))
	return bc.llmsvcClient.Rerank(ctx, query, documents, modelName)
}

// Close closes the underlying gRPC connection
func (bc *BrainClient) Close() error {
	if bc.llmsvcClient != nil {
		return bc.llmsvcClient.Close()
	}
	return nil
}

// Helper types
type NERResult struct {
	Entities      []*Entity
	Relationships []*Relationship
}

type Entity struct {
	Name       string
	Type       string
	Confidence float32
}

type Relationship struct {
	From         string
	Type         string
	To           string
	Confidence   float32
}

// bytesToFloat32 converts byte slice to []float32 (little-endian)
func bytesToFloat32(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("invalid embedding size: expected multiple of 4, got %d", len(data))
	}
	count := len(data) / 4
	result := make([]float32, count)
	for i := 0; i < count; i++ {
		bits := binary.LittleEndian.Uint32(data[i*4 : (i+1)*4])
		result[i] = math.Float32frombits(bits)
	}
	return result, nil
}
