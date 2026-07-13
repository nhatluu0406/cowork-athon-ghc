package retrieval

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/rad-system/m365-knowledge-graph/internal/brain"
	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
)

// IntentDetectionProvider defines the interface for intent detection backends.
// This allows swapping between keyword-based and LLM-based implementations.
type IntentDetectionProvider interface {
	// DetectIntent returns the detected intent type and a confidence score.
	DetectIntent(ctx context.Context, query string, contextStr string) (intent string, confidence float32, err error)
}

// IntentDetector implements Stage 1: classify one of 5 enterprise intents.
// It delegates to a configurable IntentDetectionProvider, which can be either
// keyword-based (NLP_MODE=1) or LLM-based (NLP_MODE=2/3 via router client).
// T178: Optional brainClient for task-type tagging
type IntentDetector struct {
	provider    IntentDetectionProvider
	brainClient *brain.BrainClient // T178
}

func NewIntentDetector() *IntentDetector {
	// Default to keyword-based classification
	return &IntentDetector{provider: &keywordIntentDetector{}}
}

func NewIntentDetectorWithProvider(provider IntentDetectionProvider) *IntentDetector {
	if provider == nil {
		provider = &keywordIntentDetector{}
	}
	return &IntentDetector{provider: provider}
}

// NewIntentDetectorWithBrainClient creates an IntentDetector that uses BrainClient for intent detection (T178)
func NewIntentDetectorWithBrainClient(brainClient *brain.BrainClient) *IntentDetector {
	return &IntentDetector{
		provider:    &keywordIntentDetector{}, // Keep keyword fallback
		brainClient: brainClient,
	}
}

// Detect classifies the user's intent by delegating to the configured provider.
// T178: Tries BrainClient first if available, falls back to provider
func (id *IntentDetector) Detect(ctx context.Context, query string) string {
	// T178: Try BrainClient for task-type tagging if available
	if id.brainClient != nil {
		intent, err := id.brainClient.DetectIntent(ctx, query, "")
		if err == nil {
			return intent
		}
		slog.DebugContext(ctx, "brain intent detection failed, using fallback", "err", err)
	}

	// Fallback to provider
	intent, _, err := id.provider.DetectIntent(ctx, query, "")
	if err != nil {
		// Log error and fall back to default intent
		slog.WarnContext(ctx, "intent detection failed", "query", query, "err", err)
		return "general_question"
	}
	return intent
}

// keywordIntentDetector implements IntentDetectionProvider using keyword matching.
// This is the NLP_MODE=1 baseline that is always available.
type keywordIntentDetector struct{}

func (k *keywordIntentDetector) DetectIntent(ctx context.Context, query string, contextStr string) (string, float32, error) {
	q := strings.ToLower(query)
	var confidence float32 = 0.7 // default confidence for keyword match

	switch {
	case strings.Contains(q, "who") || strings.Contains(q, "expert"):
		return "find_expert", confidence, nil
	case strings.Contains(q, "document") || strings.Contains(q, "file"):
		return "find_document", confidence, nil
	case strings.Contains(q, "project"):
		return "find_project_info", confidence, nil
	case strings.Contains(q, "technology") || strings.Contains(q, "tech"):
		return "find_technology_usage", confidence, nil
	default:
		return "general_question", confidence, nil
	}
}

// EntityRecognitionProvider defines the interface for query entity recognition.
// This allows swapping between substring-based (Cypher) and LLM-based implementations.
type EntityRecognitionProvider interface {
	// RecognizeEntities extracts entity mentions from the query text.
	RecognizeEntities(ctx context.Context, query string) ([]RecognizedEntity, error)
}

// QueryEntityRecognizer implements Stage 2: extract entity mentions from the
// query text. It delegates to a configurable EntityRecognitionProvider, which can be:
// - Cypher-based substring matching (NLP_MODE=1 baseline, always available)
// - LLM-based NER via router client (NLP_MODE=2/3, more sophisticated)
type QueryEntityRecognizer struct {
	provider EntityRecognitionProvider
}

func NewQueryEntityRecognizer(driver neo4j.DriverWithContext) *QueryEntityRecognizer {
	// Default to Cypher-based substring matching (NLP_MODE=1 baseline)
	return &QueryEntityRecognizer{provider: &cypherEntityRecognizer{driver: driver}}
}

func NewQueryEntityRecognizerWithProvider(provider EntityRecognitionProvider) *QueryEntityRecognizer {
	if provider == nil {
		return &QueryEntityRecognizer{provider: &cypherEntityRecognizer{}}
	}
	return &QueryEntityRecognizer{provider: provider}
}

// cypherEntityRecognizer implements EntityRecognitionProvider using Neo4j Cypher
// substring matching. This is the NLP_MODE=1 baseline that is always available.
type cypherEntityRecognizer struct {
	driver neo4j.DriverWithContext
}

// RecognizedEntity is an entity mention found in the query text.
type RecognizedEntity struct {
	ID   string
	Type string
	Name string
}

// Recognize extracts entity mentions from the query by delegating to the
// configured provider. This can be Cypher-based (NLP_MODE=1) or LLM-based (NLP_MODE>=2).
func (qer *QueryEntityRecognizer) Recognize(ctx context.Context, query string) ([]RecognizedEntity, error) {
	return qer.provider.RecognizeEntities(ctx, query)
}

// RecognizeEntities is a convenience method that matches the provider interface.
func (qer *QueryEntityRecognizer) RecognizeEntities(ctx context.Context, query string) ([]RecognizedEntity, error) {
	return qer.provider.RecognizeEntities(ctx, query)
}

// RecognizeEntities implements EntityRecognitionProvider using Neo4j Cypher
// substring matching (NLP_MODE=1 baseline).
func (cer *cypherEntityRecognizer) RecognizeEntities(ctx context.Context, query string) ([]RecognizedEntity, error) {
	if cer.driver == nil {
		// Return empty results if no driver configured (e.g., for a pure LLM-based provider)
		return nil, nil
	}

	session := cer.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	// Match entities whose name/displayName is contained in the query text
	// (case-insensitive). Covers the 5 named-entity labels from data-model §2.1
	// that have a natural-language name (Chunk/Document are content, not mentions).
	cypher := `
		MATCH (n)
		WHERE (n:Person OR n:Project OR n:Technology OR n:Customer OR n:Department)
		  AND (
			(n.displayName IS NOT NULL AND toLower($query) CONTAINS toLower(n.displayName))
			OR (n.name IS NOT NULL AND toLower($query) CONTAINS toLower(n.name))
		  )
		RETURN elementId(n) AS id, labels(n) AS labels, coalesce(n.displayName, n.name) AS name
		LIMIT 20
	`
	result, err := session.Run(ctx, cypher, map[string]interface{}{"query": query})
	if err != nil {
		return nil, fmt.Errorf("retrieval.cypherEntityRecognizer.RecognizeEntities: %w", err)
	}

	var found []RecognizedEntity
	for result.Next(ctx) {
		record := result.Record()
		id, _ := record.Get("id")
		labels, _ := record.Get("labels")
		name, _ := record.Get("name")

		entType := ""
		if labelList, ok := labels.([]interface{}); ok && len(labelList) > 0 {
			entType, _ = labelList[0].(string)
		}
		idStr, _ := id.(string)
		nameStr, _ := name.(string)

		found = append(found, RecognizedEntity{ID: idStr, Type: entType, Name: nameStr})
	}
	if err := result.Err(); err != nil {
		return nil, fmt.Errorf("retrieval.cypherEntityRecognizer.RecognizeEntities: iterating results: %w", err)
	}
	return found, nil
}

// EmbeddingRuntime mirrors internal/embedding.EmbeddingRuntime — declared
// locally so this package doesn't need to import internal/embedding just for
// the interface shape (Go interfaces satisfy structurally).
type EmbeddingRuntime interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

// SimilaritySearcher mirrors internal/embedding.Store's SearchSimilar method.
type SimilaritySearcher interface {
	SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]ScoredChunkResult, error)
}

// ScoredChunkResult mirrors embedding.ScoredChunk (duplicated locally per the
// same structural-typing rationale as EmbeddingRuntime above).
type ScoredChunkResult struct {
	ChunkID int64
	Score   float64
}

// SemanticSearch implements Stage 4: embed the query and find the most
// similar chunks via cosine similarity (research.md §6: brute-force, no
// pgvector at this POC's data volume).
type SemanticSearch struct {
	db        *sql.DB
	embedder  EmbeddingRuntime
	searcher  SimilaritySearcher
	modelID   int64
	topK      int
}

func NewSemanticSearch(db *sql.DB, embedder EmbeddingRuntime, searcher SimilaritySearcher, modelID int64) *SemanticSearch {
	return &SemanticSearch{db: db, embedder: embedder, searcher: searcher, modelID: modelID, topK: 10}
}

// Search returns semantically similar chunks, restricted to allowedFileIDs
// (the caller's Stage-0 permission scope — INVARIANT-1: this restriction
// must apply per-result, not just as an all-or-nothing gate before Stage 1).
// A nil/empty allowedFileIDs returns no results rather than falling open.
func (ss *SemanticSearch) Search(ctx context.Context, query string, allowedFileIDs []int) []map[string]interface{} {
	if ss.embedder == nil || ss.searcher == nil || len(allowedFileIDs) == 0 {
		return nil
	}

	vecs, err := ss.embedder.Embed(ctx, []string{query})
	if err != nil || len(vecs) == 0 {
		return nil
	}

	scored, err := ss.searcher.SearchSimilar(ctx, ss.modelID, vecs[0], ss.topK)
	if err != nil {
		return nil
	}

	allowed := make(map[int64]bool, len(allowedFileIDs))
	for _, id := range allowedFileIDs {
		allowed[int64(id)] = true
	}

	results := make([]map[string]interface{}, 0, len(scored))
	for _, sc := range scored {
		var fileID int64
		var text, headingPath, fileName sql.NullString
		row := ss.db.QueryRowContext(ctx, `
			SELECT c.file_id, c.text, c.heading_path, f.file_name
			FROM chunks c
			JOIN m365_files f ON f.id = c.file_id
			WHERE c.id = $1
		`, sc.ChunkID)
		if err := row.Scan(&fileID, &text, &headingPath, &fileName); err != nil {
			continue
		}

		// INVARIANT-1 enforcement: skip any chunk whose file is outside the
		// caller's permitted scope, even though it matched semantically.
		if !allowed[fileID] {
			continue
		}

		results = append(results, map[string]interface{}{
			"chunk_id":     sc.ChunkID,
			"score":        sc.Score,
			"text":         text.String,
			"heading_path": headingPath.String,
			"file_name":    fileName.String,
			"source":       "semantic",
		})
	}
	return results
}

// GraphExpander implements Stage 3: BFS expansion from query-recognized
// entities, depth 1-2, per data-model.md defaults.
type GraphExpander struct {
	driver   neo4j.DriverWithContext
	entities []RecognizedEntity
	depth    int
}

func NewGraphExpander(driver neo4j.DriverWithContext) *GraphExpander {
	return &GraphExpander{driver: driver, depth: 2}
}

// SetSeeds provides the entities recognized in Stage 2 to expand from.
// The Retriever calls this before Expand since Expand's original signature
// only carries semantic-search seeds (kept for backward compatibility).
func (ge *GraphExpander) SetSeeds(entities []RecognizedEntity) {
	ge.entities = entities
}

func (ge *GraphExpander) Expand(ctx context.Context, seeds []map[string]interface{}) []map[string]interface{} {
	if len(ge.entities) == 0 {
		return nil
	}

	session := ge.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	var results []map[string]interface{}
	for _, ent := range ge.entities {
		// size(r), not length(r): r is a LIST of relationships from the
		// variable-length pattern, not a Path — length() expects a Path or
		// String and errors on a relationship list. That error was
		// previously silently swallowed since the loop below never checked
		// result.Err() after iterating (fixed below too).
		cypher := fmt.Sprintf(`
			MATCH (start) WHERE elementId(start) = $id
			MATCH (start)-[r*1..%d]-(neighbor)
			RETURN DISTINCT elementId(neighbor) AS id, labels(neighbor) AS labels,
			       coalesce(neighbor.displayName, neighbor.name, neighbor.fileName) AS name,
			       size(r) AS depth
			LIMIT 20
		`, ge.depth)

		result, err := session.Run(ctx, cypher, map[string]interface{}{"id": ent.ID})
		if err != nil {
			continue
		}
		for result.Next(ctx) {
			record := result.Record()
			id, _ := record.Get("id")
			labels, _ := record.Get("labels")
			name, _ := record.Get("name")
			depth, _ := record.Get("depth")

			entType := ""
			if labelList, ok := labels.([]interface{}); ok && len(labelList) > 0 {
				entType, _ = labelList[0].(string)
			}
			idStr, _ := id.(string)
			nameStr, _ := name.(string)
			depthVal, _ := depth.(int64)

			results = append(results, map[string]interface{}{
				"entity_id": idStr,
				"type":      entType,
				"name":      nameStr,
				"depth":     depthVal,
				"source":    "graph",
				"seed_id":   ent.ID,
				"seed_name": ent.Name,
			})
		}
		if err := result.Err(); err != nil {
			slog.WarnContext(ctx, "graph expansion query failed", "seed_id", ent.ID, "err", err)
		}
	}
	return results
}

// Reranker implements Stage 5: combined scoring per spec §7
// (50% relevance, 30% graph proximity, 20% confidence) or LLM-based reranking via llmsvc.
// T173: Optional llmsvc.Client for specialized Rerank RPC; fallback to in-process scoring if nil.
// T177: Optional brainClient for task-type tagging
type Reranker struct {
	llmsvcClient *llmsvc.Client  // Optional; nil means use fallback scoring
	brainClient  *brain.BrainClient // T177
}

func NewReranker() *Reranker {
	return &Reranker{}
}

// NewRerankerWithLLMSvc creates a Reranker that uses llmsvc.Client for reranking.
// T173: Use specialized Rerank RPC when available.
func NewRerankerWithLLMSvc(client *llmsvc.Client) *Reranker {
	return &Reranker{llmsvcClient: client}
}

// NewRerankerWithBrainClient creates a Reranker that uses BrainClient with task-type tagging (T177)
func NewRerankerWithBrainClient(brainClient *brain.BrainClient) *Reranker {
	return &Reranker{brainClient: brainClient}
}

func (r *Reranker) Rank(ctx context.Context, results []map[string]interface{}) []map[string]interface{} {
	// T173: Try LLM-based reranking if client available; fall back to in-process scoring
	if r.llmsvcClient != nil && len(results) > 0 {
		reranked := r.rankWithLLMSvc(ctx, results)
		if reranked != nil {
			return reranked
		}
		// Fall through to in-process scoring on error
		slog.WarnContext(ctx, "llmsvc reranking failed, using fallback scoring")
	}

	// Fallback: in-process scoring (NLP_MODE=1 baseline)
	return r.rankFallback(results)
}

// rankWithLLMSvc uses llmsvc.Client.Rerank for LLM-based reranking (T173).
func (r *Reranker) rankWithLLMSvc(ctx context.Context, results []map[string]interface{}) []map[string]interface{} {
	// T177: Use brainClient if available (includes task-type tagging)
	var scoreMap map[string]float32
	var err error

	// Build query and documents for reranking
	// For now, use a generic query since we don't have it in the Rank context
	query := "relevant information"

	documents := make([]llmsvc.DocumentForReranking, 0)
	for i, res := range results {
		docText := ""
		if text, ok := res["text"].(string); ok {
			docText = text
		} else if name, ok := res["name"].(string); ok {
			docText = name
		}

		if docText != "" {
			docID := fmt.Sprintf("%d", i)
			documents = append(documents, llmsvc.DocumentForReranking{
				DocID: docID,
				Text:  docText,
			})
		}
	}

	if len(documents) == 0 {
		return nil
	}

	// T177: Call brainClient if available (includes task-type tagging), otherwise use llmsvcClient
	var scored []llmsvc.ScoredDocument
	if r.brainClient != nil {
		scored, err = r.brainClient.Rerank(ctx, query, documents, "bge-reranker-base")
	} else {
		scored, err = r.llmsvcClient.Rerank(ctx, query, documents, "bge-reranker-base")
	}

	if err != nil {
		slog.WarnContext(ctx, "rerank call failed", "err", err)
		return nil
	}

	// Map reranked results back to original structure
	scoreMap = make(map[string]float32)
	for _, s := range scored {
		scoreMap[s.DocID] = s.Score
	}

	reranked := make([]map[string]interface{}, 0)
	for i, res := range results {
		docID := fmt.Sprintf("%d", i)
		if score, ok := scoreMap[docID]; ok {
			res["combined_score"] = float64(score)
			reranked = append(reranked, res)
		}
	}

	// Sort by combined_score
	sort.SliceStable(reranked, func(i, j int) bool {
		si, _ := reranked[i]["combined_score"].(float64)
		sj, _ := reranked[j]["combined_score"].(float64)
		return si > sj
	})

	return reranked
}

// rankFallback is the NLP_MODE=1 baseline using in-process scoring.
// T173: Fallback when llmsvc is unavailable.
func (r *Reranker) rankFallback(results []map[string]interface{}) []map[string]interface{} {
	scored := make([]map[string]interface{}, len(results))
	copy(scored, results)

	for _, res := range scored {
		relevance := 0.5 // default mid-relevance for graph-only results with no semantic score
		if v, ok := res["score"].(float64); ok {
			relevance = v
		}

		proximity := 1.0 // semantic results have no graph depth: full proximity
		if depth, ok := res["depth"].(int64); ok {
			// depth 1 -> 0.8, depth 2 -> 0.6, deeper decays further
			proximity = 1.0 - (float64(depth) * 0.2)
			if proximity < 0 {
				proximity = 0
			}
		}

		confidence := 0.75 // default confidence when not separately tracked
		if v, ok := res["confidence"].(float64); ok {
			confidence = v
		}

		res["combined_score"] = (0.5 * relevance) + (0.3 * proximity) + (0.2 * confidence)
	}

	sort.SliceStable(scored, func(i, j int) bool {
		si, _ := scored[i]["combined_score"].(float64)
		sj, _ := scored[j]["combined_score"].(float64)
		return si > sj
	})

	return scored
}

// CompressionProvider defines the interface for context compression.
// This allows optional compression when budget is exceeded.
type CompressionProvider interface {
	// Compress reduces context size to fit within a target token count.
	Compress(ctx context.Context, text string, targetTokens int) (string, error)
}

// ContextPacker implements Stage 6: token-budget-aware context assembly.
// Token count is approximated as len(text)/4 (a standard rough heuristic for
// English text); exact tokenization would require the target LLM's tokenizer,
// which the custom API endpoint does not expose.
//
// If a compression provider is configured, the packer can use it to reduce
// oversized contexts instead of truncating them (NLP_MODE >= 2).
// T180: Optional llmsvc.Client for LLM-based compression.
type ContextPacker struct {
	compressor    CompressionProvider // Optional compression provider
	llmsvcClient  *llmsvc.Client      // T180: Optional llmsvc client for compression
	brainClient   *brain.BrainClient  // T177: Optional brain client for task-type tagging
}

func NewContextPacker() *ContextPacker {
	return &ContextPacker{}
}

func NewContextPackerWithCompressor(compressor CompressionProvider) *ContextPacker {
	return &ContextPacker{compressor: compressor}
}

// NewContextPackerWithLLMSvc creates a ContextPacker that uses llmsvc.Client for compression.
// T180: Use specialized Compress RPC when available.
func NewContextPackerWithLLMSvc(client *llmsvc.Client) *ContextPacker {
	return &ContextPacker{llmsvcClient: client}
}

// NewContextPackerWithBrainClient creates a ContextPacker that uses BrainClient with task-type tagging (T177)
func NewContextPackerWithBrainClient(brainClient *brain.BrainClient) *ContextPacker {
	return &ContextPacker{brainClient: brainClient}
}

func (cp *ContextPacker) Pack(ctx context.Context, results []map[string]interface{}, tokenBudget int) string {
	var sb strings.Builder
	usedTokens := 0

	for i, res := range results {
		var chunk string
		if text, ok := res["text"].(string); ok && text != "" {
			source := "unknown"
			if fn, ok := res["file_name"].(string); ok && fn != "" {
				source = fn
			}
			chunk = fmt.Sprintf("[Source %d: %s]\n%s\n\n", i+1, source, text)
		} else if name, ok := res["name"].(string); ok && name != "" {
			entType, _ := res["type"].(string)
			chunk = fmt.Sprintf("[Related entity: %s (%s)]\n\n", name, entType)
		} else {
			continue
		}

		approxTokens := len(chunk) / 4
		if usedTokens+approxTokens > tokenBudget {
			// If we exceed the budget and have a compressor, try compression instead of truncating
			// T180: Try llmsvc compression first if available
			compressed := cp.tryCompress(ctx, sb.String(), tokenBudget)
			if compressed != "" {
				return compressed
			}

			// Fall back to truncation if compression fails or unavailable
			break
		}
		sb.WriteString(chunk)
		usedTokens += approxTokens
	}

	return sb.String()
}

// tryCompress attempts context compression via llmsvc or the configured compressor.
// T180: Returns empty string if compression fails or is unavailable (fallback to truncation).
func (cp *ContextPacker) tryCompress(ctx context.Context, text string, targetTokens int) string {
	if text == "" {
		return ""
	}

	// T177: Try brain client first (includes task-type tagging)
	if cp.brainClient != nil {
		compressed, err := cp.brainClient.Compress(ctx, text, targetTokens, "map_reduce")
		if err == nil && compressed != "" {
			return compressed
		}
		if err != nil {
			slog.DebugContext(ctx, "brain compression failed", "err", err)
		}
	}

	// T180: Try llmsvc compression if brain client not available
	if cp.llmsvcClient != nil {
		result, err := cp.llmsvcClient.Compress(ctx, text, targetTokens, "map_reduce")
		if err == nil && result.CompressedContext != "" {
			return result.CompressedContext
		}
		if err != nil {
			slog.DebugContext(ctx, "llmsvc compression failed", "err", err)
		}
	}

	// Fall back to configured compressor if llmsvc failed or unavailable
	if cp.compressor != nil {
		compressed, err := cp.compressor.Compress(ctx, text, targetTokens)
		if err != nil {
			slog.DebugContext(ctx, "compression provider failed", "err", err)
			return ""
		}
		return compressed
	}

	return ""
}

// LLMClient is the local interface AnswerGenerator depends on; any type
// with a matching Complete method (e.g. embedding.SvcAdapter) satisfies
// it structurally. T176a: CustomAPIClient has been removed per spec §3.5.
type LLMClient interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

// AnswerGenerator implements Stage 7: LLM answer generation with citations.
// T174: Optional llmsvc.Client for specialized Generate RPC; fallback to LLMClient.Complete if nil.
type AnswerGenerator struct {
	llm          LLMClient           // Fallback LLM client
	llmsvcClient *llmsvc.Client      // T174: Optional specialized client
	brainClient  *brain.BrainClient  // T177: Optional brain client for task-type tagging
}

func NewAnswerGenerator(llm LLMClient) *AnswerGenerator {
	return &AnswerGenerator{llm: llm}
}

// NewAnswerGeneratorWithLLMSvc creates an AnswerGenerator that uses llmsvc.Client for generation.
// T174: Use specialized Generate RPC when available.
func NewAnswerGeneratorWithLLMSvc(client *llmsvc.Client, llm LLMClient) *AnswerGenerator {
	return &AnswerGenerator{
		llmsvcClient: client,
		llm:          llm,
	}
}

// NewAnswerGeneratorWithBrainClient creates an AnswerGenerator that uses BrainClient with task-type tagging (T177)
func NewAnswerGeneratorWithBrainClient(brainClient *brain.BrainClient, llm LLMClient) *AnswerGenerator {
	return &AnswerGenerator{
		brainClient: brainClient,
		llm:         llm,
	}
}

func (ag *AnswerGenerator) Generate(ctx context.Context, query string, packedContext string) (string, []interface{}) {
	sources := extractSourcesFromContext(packedContext)

	if packedContext == "" {
		return "I don't have enough information to answer that question.", sources
	}

	// T174: Try specialized Generate RPC if client available; fall back to Complete interface
	if ag.llmsvcClient != nil && query != "" {
		answer, citations, err := ag.generateWithLLMSvc(ctx, query, packedContext)
		if err == nil {
			// Convert citations to sources format
			if len(citations) > 0 {
				for _, citation := range citations {
					sources = append(sources, map[string]interface{}{"citation": citation})
				}
			}
			return answer, sources
		}
		slog.DebugContext(ctx, "llmsvc generation failed, using fallback", "err", err)
	}

	// Fallback: use LLMClient.Complete interface
	if ag.llm == nil {
		return "I don't have enough information to answer that question.", sources
	}

	prompt := fmt.Sprintf(
		"You are an enterprise knowledge assistant. Answer the question using ONLY the context below. "+
			"Cite sources using [Source N] notation.\n\nContext:\n%s\n\nQuestion: %s\n\nAnswer:",
		packedContext, query,
	)

	answer, err := ag.llm.Complete(ctx, prompt)
	if err != nil {
		return fmt.Sprintf("Unable to generate an answer due to an internal error: %v", err), sources
	}

	return answer, sources
}

// generateWithLLMSvc uses llmsvc.Client.Generate for answer generation (T174).
func (ag *AnswerGenerator) generateWithLLMSvc(ctx context.Context, query string, packedContext string) (string, []string, error) {
	instructions := "You are an enterprise knowledge assistant. Answer the question using ONLY the context below. Cite sources using [Source N] notation."

	// T177: Use brain client if available (includes task-type tagging), otherwise use llmsvcClient
	if ag.brainClient != nil {
		answer, citations, err := ag.brainClient.Generate(ctx, query, packedContext, instructions, 0.7, 2048)
		if err != nil {
			return "", nil, fmt.Errorf("brain.Generate: %w", err)
		}
		return answer, citations, nil
	}

	result, err := ag.llmsvcClient.Generate(ctx, query, packedContext, instructions, 0.7, 2048)
	if err != nil {
		return "", nil, fmt.Errorf("llmsvc.Generate: %w", err)
	}

	return result.Answer, result.Citations, nil
}

func extractSourcesFromContext(packedContext string) []interface{} {
	var sources []interface{}
	for _, line := range strings.Split(packedContext, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[Source ") {
			sources = append(sources, map[string]interface{}{"citation": line})
		}
	}
	return sources
}
