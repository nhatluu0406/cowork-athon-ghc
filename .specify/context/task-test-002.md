<!-- context-assembler: task=TASK-TEST-002 -->
<!-- sections: TASK, ACCEPTANCE CRITERIA, DESIGN, CODE SCOPE -->
<!-- estimated tokens: 23,407 -->


---
## TASK

# Task: TASK-TEST-002 — Full context with scope + ACs + design

ac_refs: [AC-TEST-001, AC-TEST-002, AC-TEST-003]
design_refs: [§3.5]

Acceptance Criteria to satisfy: AC-TEST-001, AC-TEST-002, AC-TEST-003
Design sections to follow: §3.5

---
## ACCEPTANCE CRITERIA

### AC-TEST-001: Assembler runs without error
**Given** tasks.md có task với đầy đủ `scope`, `ac_refs`, `design_refs`
**When** chạy `python .specify/scripts/context-assembler.py --task TASK-TEST-001`
**Then** script exit code = 0, output file `.specify/context/task-test-001.md` được tạo

### AC-TEST-002: Token reduction ≥ 50%
**Given** baseline context của cả spec directory (spec.md + plan.md + tasks.md + full code)
**When** so sánh với context-assembler output cho cùng task
**Then** context-assembler output ≤ 50% token count của baseline

### AC-TEST-003: ACs được include đúng
**Given** task khai báo `ac_refs: [AC-TEST-001, AC-TEST-002]`
**When** context file được generate
**Then** nội dung của cả hai ACs xuất hiện trong section `ACCEPTANCE CRITERIA`

---
## DESIGN

<!-- §3.5: not found in design docs -->

---
## CODE SCOPE

<!-- 15 files packed -->

### src/Backend/internal/retriever/bert_reranker.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
)

// BERTRerankerConfig configures BERT reranker behavior
type BERTRerankerConfig struct {
	ModelPath       string  // Path to BERT model
	ModelName       string  // Model identifier (default: "cross-encoder/ms-marco-MiniLM-L-12-v2")
	Threshold       float32 // Minimum score (0-1)
	BatchSize       int     // Batch size for processing
	DeviceID        int     // GPU device (-1 = CPU)
	CacheEmbeddings bool    // Cache embeddings for reuse
}

// BERTRerankerImpl implements semantic reranking using BERT cross-encoder
type BERTRerankerImpl struct {
	config     BERTRerankerConfig
	logger     *slog.Logger
	embedCache map[string][]float32 // Query → embedding cache
}

// NewBERTReranker creates a BERT reranker with configuration
func NewBERTReranker(config BERTRerankerConfig, logger *slog.Logger) *BERTRerankerImpl {
	if logger == nil {
		logger = slog.Default()
	}

	if config.ModelName == "" {
		config.ModelName = "cross-encoder/ms-marco-MiniLM-L-12-v2"
	}

	if config.BatchSize == 0 {
		config.BatchSize = 32
	}

	if config.Threshold < 0 {
		config.Threshold = 0.0
	}

	if config.CacheEmbeddings {
		logger.Info("BERT reranker initialized with caching")
	}

	return &BERTRerankerImpl{
		config:     config,
		logger:     logger,
		embedCache: make(map[string][]float32),
	}
}

// RerankedResult represents a reranked candidate with BERT score
type RerankedResult struct {
	Candidate  RankedCandidate
	BERTScore  float32 // Cross-encoder score (0-1)
	TFIDFScore float32 // Original TF-IDF score
	FinalScore float32 // Weighted combination
	Confidence float32 // Confidence level
}

// RerankWithBERT reranks candidates using BERT cross-encoder semantic matching
func (br *BERTRerankerImpl) RerankWithBERT(
	ctx context.Context,
	query string,
	candidates []RankedCandidate,
) ([]RerankedResult, error) {
	if len(candidates) == 0 {
		return []RerankedResult{}, nil
	}

	br.logger.InfoContext(ctx, "BERT reranking started",
		"query_length", len(query),
		"candidates", len(candidates),
		"batch_size", br.config.BatchSize)

	results := make([]RerankedResult, 0, len(candidates))

	// Process in batches for efficiency
	for i := 0; i < len(candidates); i += br.config.BatchSize {
		end := i + br.config.BatchSize
		if end > len(candidates) {
			end = len(candidates)
		}

		batch := candidates[i:end]

		// Score each candidate in batch
		for _, candidate := range batch {
			score := br.scoreCandidate(ctx, query, candidate)
			if score < br.config.Threshold {
				continue
			}

			finalScore := br.combinedScore(score, candidate.Score)

			results = append(results, RerankedResult{
				Candidate:  candidate,
				BERTScore:  score,
				TFIDFScore: candidate.Score,
				FinalScore: finalScore,
				Confidence: calculateConfidence(score),
			})
		}
	}

	// Sort by final score
	sort.Slice(results, func(i, j int) bool {
		if results[i].FinalScore != results[j].FinalScore {
			return results[i].FinalScore > results[j].FinalScore
		}
		// Tie-breaker: original score
		return results[i].TFIDFScore > results[j].TFIDFScore
	})

	br.logger.InfoContext(ctx, "BERT reranking completed",
		"input", len(candidates),
		"output", len(results),
		"threshold_filtered", len(candidates)-len(results))

	return results, nil
}

// scoreCandidate scores a single candidate using cross-encoder
func (br *BERTRerankerImpl) scoreCandidate(ctx context.Context, query string, candidate RankedCandidate) float32 {
	// Extract text from candidate metadata
	candidateText := br.extractCandidateText(candidate)

	// In production, would use actual BERT cross-encoder model
	// For now, simulate semantic scoring based on text similarity
	score := br.simulateSemanticScore(query, candidateText)

	return score
}

// extractCandidateText extracts text from candidate for scoring
func (br *BERTRerankerImpl) extractCandidateText(candidate RankedCandidate) string {
	text := ""

	if name, ok := candidate.Metadata["name"].(string); ok && name != "" {
		text += name + " "
	}

	if kind, ok := candidate.Metadata["kind"].(string); ok && kind != "" {
		text += "(" + kind + ") "
	}

	if summary, ok := candidate.Metadata["summary"].(string); ok && summary != "" {
		text += summary
	}

	return text
}

// simulateSemanticScore simulates BERT cross-encoder scoring
// In production, this would use actual model inference
func (br *BERTRerankerImpl) simulateSemanticScore(query, candidateText string) float32 {
	// Calculate semantic similarity (placeholder)
	// Real implementation would use BERT embeddings and cosine similarity

	// Simple heuristic: word overlap + length similarity
	queryWords := countWords(query)
	candidateWords := countWords(candidateText)

	if candidateWords == 0 {
		return 0.0
	}

	// Base score on word overlap
	overlapScore := float32(len(commonWords(query, candidateText))) / float32(queryWords)
	overlapScore = min(overlapScore, 1.0)

	// Bonus for similar length
	lengthRatio := float32(candidateWords) / float32(queryWords+1)
	if lengthRatio > 1.0 {
		lengthRatio = 1.0 / lengthRatio
	}
	lengthBonus := lengthRatio * 0.2

	score := overlapScore*0.8 + lengthBonus
	return min(score, 1.0)
}

// combinedScore combines BERT and TF-IDF scores
func (br *BERTRerankerImpl) combinedScore(bertScore, tfIDFScore float32) float32 {
	// 70% BERT semantic score + 30% TF-IDF lexical score
	// BERT usually provides better relevance
	combined := bertScore*0.7 + tfIDFScore*0.3
	return min(combined, 1.0)
}

// calculateConfidence calculates confidence level from score
func calculateConfidence(score float32) float32 {
	// Confidence peaks at 0.7-0.8, decreases at extremes
	if score < 0.3 {
		return score / 3 // Very low confidence for low scores
	}
	if score > 0.9 {
		return 0.95 // Cap high confidence
	}
	return score
}

// QuestionAnsweringReranker ranks candidates for question answering
type QuestionAnsweringReranker struct {
	bert   *BERTRerankerImpl
	logger *slog.Logger
}

// NewQuestionAnsweringReranker creates a QA-optimized reranker
func NewQuestionAnsweringReranker(config BERTRerankerConfig, logger *slog.Logger) *QuestionAnsweringReranker {
	return &QuestionAnsweringReranker{
		bert:   NewBERTReranker(config, logger),
		logger: logger,
	}
}

// RankForQA ranks candidates specifically for question answering
func (qa *QuestionAnsweringReranker) RankForQA(
	ctx context.Context,
	question string,
	candidates []RankedCandidate,
) ([]RerankedResult, error) {
	if len(candidates) == 0 {
		return []RerankedResult{}, nil
	}

	qa.logger.InfoContext(ctx, "QA ranking started",
		"question_length", len(question),
		"candidates", len(candidates))

	// Use BERT reranker with higher threshold for QA
	results, err := qa.bert.RerankWithBERT(ctx, question, candidates)
	if err != nil {
		return nil, fmt.Errorf("QA reranking failed: %w", err)
	}

	// Filter to top-K answers for QA
	maxResults := 5
	if len(results) > maxResults {
		results = results[:maxResults]
	}

	qa.logger.InfoContext(ctx, "QA ranking completed",
		"results", len(results))

	return results, nil
}

// Helper functions

func countWords(text string) int {
	if text == "" {
		return 0
	}
	count := 0
	inWord := false
	for _, ch := range text {
		if ch == ' ' || ch == '\n' || ch == '\t' {
			inWord = false
		} else if !inWord {
			count++
			inWord = true
		}
	}
	return count
}

func commonWords(text1, text2 string) []string {
	words1 := extractWords(text1)
	words2 := extractWords(text2)

	// Create map for O(1) lookup
	wordsMap := make(map[string]bool)
	for _, w := range words1 {
		wordsMap[w] = true
	}

	// Find common words
	common := []string{}
	seen := make(map[string]bool)
	for _, w := range words2 {
		if wordsMap[w] && !seen[w] {
			common = append(common, w)
			seen[w] = true
		}
	}

	return common
}

func extractWords(text string) []string {
	words := []string{}
	word := ""

	for _, ch := range text {
		if ch == ' ' || ch == '\n' || ch == '\t' || ch == '(' || ch == ')' {
			if len(word) > 0 {
				words = append(words, word)
				word = ""
			}
		} else {
			word += string(ch)
		}
	}

	if len(word) > 0 {
		words = append(words, word)
	}

	return words
}
```

### src/Backend/internal/retriever/budget_allocator.go
```
package retriever

import (
	"context"
	"log/slog"
)

// BudgetZone represents a single zone in the 4-partition budget model
type BudgetZone struct {
	Name      string  `json:"name"`
	Ratio     float32 `json:"ratio"`
	Allocated int     `json:"allocated"`
	Used      int     `json:"used"`
}

// BudgetSummary summarizes the budget allocation across all zones
type BudgetSummary struct {
	Zones           map[string]BudgetZone `json:"zones"`
	TotalBudget     int                   `json:"total_budget"`
	TotalUsed       int                   `json:"total_used"`
	UtilizationRate float32               `json:"utilization_rate"`
}

// BudgetAllocator manages token allocation across 4 zones
type BudgetAllocator struct {
	totalBudget int
	zones       map[string]*BudgetZone
}

// TokenUsage represents the token usage across all zones
type TokenUsage struct {
	Intent     SearchIntent `json:"intent"`
	Primary    int          `json:"primary"`
	Supporting int          `json:"supporting"`
	Graph      int          `json:"graph"`
	Raw        int          `json:"raw"`
	Total      int          `json:"total"`
}

// Zone names
const (
	ZonePrimary    = "primary"
	ZoneSupporting = "supporting"
	ZoneGraph      = "graph"
	ZoneRaw        = "raw"
)

// intentZoneRatios maps SearchIntent to zone ratios (4 zones, summing to 1.0)
var intentZoneRatios = map[SearchIntent]map[string]float32{
	IntentGeneral: {
		ZonePrimary: 0.40, ZoneSupporting: 0.30, ZoneGraph: 0.20, ZoneRaw: 0.10,
	},
	IntentBugFix: {
		ZonePrimary: 0.35, ZoneSupporting: 0.25, ZoneGraph: 0.20, ZoneRaw: 0.20,
	},
	IntentSpecGeneration: {
		ZonePrimary: 0.35, ZoneSupporting: 0.20, ZoneGraph: 0.35, ZoneRaw: 0.10,
	},
	IntentEstimation: {
		ZonePrimary: 0.30, ZoneSupporting: 0.40, ZoneGraph: 0.20, ZoneRaw: 0.10,
	},
	IntentCodeReview: {
		ZonePrimary: 0.40, ZoneSupporting: 0.30, ZoneGraph: 0.20, ZoneRaw: 0.10,
	},
	IntentTestRepair: {
		ZonePrimary: 0.35, ZoneSupporting: 0.25, ZoneGraph: 0.15, ZoneRaw: 0.25,
	},
}

// zoneOrder defines the order for allocation (first 3 with int rounding, last as remainder)
var zoneOrder = []string{ZonePrimary, ZoneSupporting, ZoneGraph, ZoneRaw}

// NewBudgetAllocator creates a new BudgetAllocator for the given total budget and intent
func NewBudgetAllocator(totalBudget int, intent SearchIntent) *BudgetAllocator {
	ratios, ok := intentZoneRatios[intent]
	if !ok {
		ratios = intentZoneRatios[IntentGeneral]
	}

	zones := make(map[string]*BudgetZone, 4)

	// Allocate first 3 zones with int() rounding, allocate last zone as remainder
	first3Sum := 0
	for i, z := range zoneOrder {
		ratio := ratios[z]
		var allocated int
		if i < len(zoneOrder)-1 {
			allocated = int(float32(totalBudget) * ratio)
			first3Sum += allocated
		} else {
			// Last zone gets remainder to guarantee sum == totalBudget
			allocated = totalBudget - first3Sum
			if allocated < 0 {
				allocated = 0
			}
		}
		zones[z] = &BudgetZone{
			Name:      z,
			Ratio:     ratio,
			Allocated: allocated,
			Used:      0,
		}
	}

	return &BudgetAllocator{
		totalBudget: totalBudget,
		zones:       zones,
	}
}

// CanAllocate checks if the given zone has enough remaining tokens
func (b *BudgetAllocator) CanAllocate(zone string, tokens int) bool {
	z, ok := b.zones[zone]
	if !ok {
		return false
	}
	return z.Allocated-z.Used >= tokens
}

// Consume deducts tokens from the given zone
// Returns false and does NOT modify state if insufficient tokens remain
func (b *BudgetAllocator) Consume(zone string, tokens int) bool {
	z, ok := b.zones[zone]
	if !ok {
		return false
	}
	if z.Allocated-z.Used < tokens {
		return false
	}
	z.Used += tokens
	return true
}

// Summary returns a BudgetSummary with current usage stats
func (b *BudgetAllocator) Summary() BudgetSummary {
	zoneSummary := make(map[string]BudgetZone, len(b.zones))
	totalUsed := 0
	for name, z := range b.zones {
		zoneSummary[name] = *z
		totalUsed += z.Used
	}

	var utilRate float32
	if b.totalBudget > 0 {
		utilRate = float32(totalUsed) / float32(b.totalBudget)
	}

	return BudgetSummary{
		Zones:           zoneSummary,
		TotalBudget:     b.totalBudget,
		TotalUsed:       totalUsed,
		UtilizationRate: utilRate,
	}
}

// buildTokenUsage constructs a TokenUsage struct from a BudgetSummary
func buildTokenUsage(intent SearchIntent, summary BudgetSummary) TokenUsage {
	usage := TokenUsage{
		Intent: intent,
		Total:  summary.TotalUsed,
	}
	if z, ok := summary.Zones[ZonePrimary]; ok {
		usage.Primary = z.Used
	}
	if z, ok := summary.Zones[ZoneSupporting]; ok {
		usage.Supporting = z.Used
	}
	if z, ok := summary.Zones[ZoneGraph]; ok {
		usage.Graph = z.Used
	}
	if z, ok := summary.Zones[ZoneRaw]; ok {
		usage.Raw = z.Used
	}
	return usage
}

// logUsage emits a structured slog record for token usage
func logUsage(ctx context.Context, usage TokenUsage, totalBudget int) {
	var utilization float32
	if totalBudget > 0 {
		utilization = float32(usage.Total) / float32(totalBudget)
	}

	slog.InfoContext(ctx, "token_usage",
		"intent", usage.Intent,
		"primary", usage.Primary,
		"supporting", usage.Supporting,
		"graph", usage.Graph,
		"raw", usage.Raw,
		"total", usage.Total,
		"budget", totalBudget,
		"utilization", utilization,
	)
}
```

### src/Backend/internal/retriever/budgeting.go
```
package retriever

import (
	"context"
	"fmt"
	"sort"
)

// TokenBudgetManager manages token allocation for context packing
type TokenBudgetManager struct {
	defaultBudget int
	overhead      int // ヘッダー・フッター等の固定オーバーヘッド
}

// NewTokenBudgetManager creates a new token budget manager
func NewTokenBudgetManager(defaultBudget, overhead int) *TokenBudgetManager {
	if defaultBudget <= 0 {
		defaultBudget = 12000 // デフォルト12Kトークン
	}
	if overhead <= 0 {
		overhead = 200 // 固定オーバーヘッド200トークン
	}

	return &TokenBudgetManager{
		defaultBudget: defaultBudget,
		overhead:      overhead,
	}
}

// EstimateTokens estimates the token count for content
// 簡易推定: 1トークン ≈ 4文字
func (m *TokenBudgetManager) EstimateTokens(content string) int {
	if content == "" {
		return 0
	}
	return len(content) / 4
}

// AllocateResults allocates results within token budget
// Algorithm:
// 1. Sort results by relevance score (descending)
// 2. Estimate tokens for each result
// 3. Greedily pack results until budget exhausted
// 4. Return packed results and remaining budget
func (m *TokenBudgetManager) AllocateResults(ctx context.Context, results []*SearchResult, budget int) ([]*SearchResult, int, error) {
	if budget <= m.overhead {
		return []*SearchResult{}, 0, fmt.Errorf("budget %d <= overhead %d", budget, m.overhead)
	}

	availableBudget := budget - m.overhead
	usedBudget := 0
	allocatedResults := make([]*SearchResult, 0)

	// Copy and sort by score descending
	sortedResults := make([]*SearchResult, len(results))
	copy(sortedResults, results)
	sort.Slice(sortedResults, func(i, j int) bool {
		return sortedResults[i].Score > sortedResults[j].Score
	})

	// Greedy packing
	for _, result := range sortedResults {
		resultTokens := m.EstimateResultTokens(result)

		if usedBudget+resultTokens <= availableBudget {
			allocatedResults = append(allocatedResults, result)
			usedBudget += resultTokens
		} else {
			// Budget exhausted
			break
		}
	}

	return allocatedResults, availableBudget - usedBudget, nil
}

// EstimateResultTokens estimates tokens for a single result
func (m *TokenBudgetManager) EstimateResultTokens(result *SearchResult) int {
	if result == nil {
		return 0
	}

	// Content + metadata overhead
	contentTokens := m.EstimateTokens(result.Content)
	headerTokens := m.EstimateTokens(result.StableKey + result.FilePath)

	// Metadata overhead (score, rank, etc.)
	metadataOverhead := 50

	return contentTokens + headerTokens + metadataOverhead
}

// SummarizeResult creates a summary of a result to reduce token usage
// Reduction target: 50-70% of original
func (m *TokenBudgetManager) SummarizeResult(result *SearchResult, maxTokens int) string {
	if result == nil || result.Content == "" {
		return ""
	}

	// Simple summarization: take first N chars
	// In production, use actual NLP summarization
	contentTokens := m.EstimateTokens(result.Content)
	if contentTokens <= maxTokens {
		return result.Content
	}

	// Estimate chars needed for target tokens
	charsPerToken := 4
	targetChars := maxTokens * charsPerToken

	if targetChars > len(result.Content) {
		targetChars = len(result.Content)
	}

	summary := result.Content[:targetChars]

	// Add ellipsis if truncated
	if targetChars < len(result.Content) {
		summary += "..."
	}

	return summary
}

// BudgetAllocationReport provides detailed budget allocation info
type BudgetAllocationReport struct {
	TotalBudget       int
	OverheadTokens    int
	AvailableBudget   int
	UsedBudget        int
	RemainingBudget   int
	ItemsAllocated    int
	ItemsSkipped      int
	AllocationPercent float64
}

// GenerateReport generates budget allocation report
func (m *TokenBudgetManager) GenerateReport(budget, used, allocated, skipped int) *BudgetAllocationReport {
	availableBudget := budget - m.overhead
	remainingBudget := availableBudget - used
	if remainingBudget < 0 {
		remainingBudget = 0
	}

	allocationPercent := float64(0)
	if availableBudget > 0 {
		allocationPercent = float64(used) / float64(availableBudget) * 100
	}

	return &BudgetAllocationReport{
		TotalBudget:       budget,
		OverheadTokens:    m.overhead,
		AvailableBudget:   availableBudget,
		UsedBudget:        used,
		RemainingBudget:   remainingBudget,
		ItemsAllocated:    allocated,
		ItemsSkipped:      skipped,
		AllocationPercent: allocationPercent,
	}
}

// OptimizeAllocation applies optimization strategies to maximize quality within budget
// Strategies:
// 1. Prefer high-quality results (QualityScore)
// 2. Balance diversity (avoid similar results)
// 3. Include recent results
func (m *TokenBudgetManager) OptimizeAllocation(results []*SearchResult, budget int) ([]*SearchResult, error) {
	if len(results) == 0 {
		return []*SearchResult{}, nil
	}

	// Score-based allocation (quality + recency + diversity)
	type scoredResult struct {
		result   *SearchResult
		optScore float64
	}

	scored := make([]*scoredResult, len(results))
	for i, r := range results {
		// Optimization score: 100% relevance (using Score field)
		optScore := r.Score
		scored[i] = &scoredResult{result: r, optScore: optScore}
	}

	// Sort by optimization score
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].optScore > scored[j].optScore
	})

	// Allocate with optimized order
	allocatedResults := make([]*SearchResult, 0)
	usedBudget := m.overhead

	for _, sr := range scored {
		resultTokens := m.EstimateResultTokens(sr.result)
		if usedBudget+resultTokens <= budget {
			allocatedResults = append(allocatedResults, sr.result)
			usedBudget += resultTokens
		}
	}

	return allocatedResults, nil
}
```

### src/Backend/internal/retriever/context_packer.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
)

// ContextLevel represents the resolution level of context
type ContextLevel int

const (
	L1 ContextLevel = iota // Compact metadata (30-70 tokens)
	L2                     // Semantic summary (30-50 tokens)
	L3                     // Behavioral facts (50-100 tokens)
	L4                     // Raw source (variable, hydrated on-demand)
)

// ContextItem represents a piece of context at a specific level
type ContextItem struct {
	ID       string
	Level    ContextLevel
	Content  string
	Tokens   int
	Metadata map[string]interface{}
}

// ContextPacker packs context items within token budget
type ContextPacker struct {
	tokenBudget int
	logger      *slog.Logger
}

// NewContextPacker creates a context packer
func NewContextPacker(tokenBudget int, logger *slog.Logger) *ContextPacker {
	if tokenBudget < 1 {
		tokenBudget = 12000 // Default: 12K tokens
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &ContextPacker{
		tokenBudget: tokenBudget,
		logger:      logger,
	}
}

// PackedContext represents packed context ready for LLM
type PackedContext struct {
	Items          []ContextItem
	TotalTokens    int
	BudgetUsage    float32 // Percentage
	ContentSummary string
}

// PackContext packs context items within token budget using adaptive strategy
func (cp *ContextPacker) PackContext(ctx context.Context, items []ContextItem) (*PackedContext, error) {
	if len(items) == 0 {
		return &PackedContext{
			Items:       []ContextItem{},
			TotalTokens: 0,
			BudgetUsage: 0,
		}, nil
	}

	// Allocate token budget by level
	budgetAllocation := cp.allocateBudget(cp.tokenBudget)

	// Group items by level
	itemsByLevel := make(map[ContextLevel][]ContextItem)
	for _, item := range items {
		itemsByLevel[item.Level] = append(itemsByLevel[item.Level], item)
	}

	// Sort each level by quality (estimated via tokens)
	for level := range itemsByLevel {
		sort.Slice(itemsByLevel[level], func(i, j int) bool {
			return itemsByLevel[level][i].Tokens > itemsByLevel[level][j].Tokens
		})
	}

	// Pack items level by level within budget
	packed := make([]ContextItem, 0)
	totalTokens := 0

	for level := L1; level <= L4; level++ {
		budget := budgetAllocation[level]
		remaining := budget

		for _, item := range itemsByLevel[level] {
			if remaining >= item.Tokens {
				packed = append(packed, item)
				totalTokens += item.Tokens
				remaining -= item.Tokens
			} else if level != L4 { // L4 (raw source) is always optional
				break
			}
		}
	}

	budgetUsage := float32(totalTokens) / float32(cp.tokenBudget)

	return &PackedContext{
		Items:       packed,
		TotalTokens: totalTokens,
		BudgetUsage: budgetUsage,
		ContentSummary: fmt.Sprintf(
			"%d items packed, %d/%d tokens (%.1f%%)",
			len(packed), totalTokens, cp.tokenBudget, budgetUsage*100,
		),
	}, nil
}

// allocateBudget allocates token budget across levels
func (cp *ContextPacker) allocateBudget(totalBudget int) map[ContextLevel]int {
	return map[ContextLevel]int{
		L1: int(float32(totalBudget) * 0.20), // 20% for metadata
		L2: int(float32(totalBudget) * 0.25), // 25% for summaries
		L3: int(float32(totalBudget) * 0.35), // 35% for facts
		L4: int(float32(totalBudget) * 0.20), // 20% for raw source
	}
}

// AdaptiveContextBuilder builds context adaptively based on query type
type AdaptiveContextBuilder struct {
	packer *ContextPacker
	logger *slog.Logger
}

// NewAdaptiveContextBuilder creates an adaptive builder
func NewAdaptiveContextBuilder(packer *ContextPacker, logger *slog.Logger) *AdaptiveContextBuilder {
	if logger == nil {
		logger = slog.Default()
	}
	return &AdaptiveContextBuilder{
		packer: packer,
		logger: logger,
	}
}

// BuildContext builds context based on query intent
func (acb *AdaptiveContextBuilder) BuildContext(ctx context.Context, queryIntent string, candidates []ExpandedResult) (*PackedContext, error) {
	// Convert ExpandedResult to ContextItem
	items := make([]ContextItem, len(candidates))

	for i, cand := range candidates {
		level := acb.selectLevel(queryIntent, cand)
		tokens := acb.estimateTokens(level, cand)

		items[i] = ContextItem{
			ID:      cand.Symbol.ID,
			Level:   level,
			Content: cand.Symbol.Summary,
			Tokens:  tokens,
			Metadata: map[string]interface{}{
				"name":       cand.Symbol.QualifiedName,
				"kind":       cand.Symbol.Kind,
				"distance":   cand.Distance,
				"importance": cand.Importance,
			},
		}
	}

	acb.logger.InfoContext(ctx, "adaptive context building",
		"query_intent", queryIntent,
		"candidates", len(candidates),
		"context_items", len(items),
	)

	return acb.packer.PackContext(ctx, items)
}

// selectLevel selects context level based on query intent
func (acb *AdaptiveContextBuilder) selectLevel(intent string, result ExpandedResult) ContextLevel {
	// High-importance results get more detail
	if result.Importance > 0.8 {
		return L3
	}

	// Medium importance gets summary
	if result.Importance > 0.5 {
		return L2
	}

	// Low importance gets just metadata
	return L1
}

// estimateTokens estimates token count for a context item
func (acb *AdaptiveContextBuilder) estimateTokens(level ContextLevel, result ExpandedResult) int {
	baseTokens := map[ContextLevel]int{
		L1: 40,  // Metadata
		L2: 50,  // Summary
		L3: 80,  // Facts
		L4: 200, // Raw source (estimated)
	}

	tokens := baseTokens[level]

	// Adjust by symbol complexity
	if result.Symbol.Kind == "interface" || result.Symbol.Kind == "class" {
		tokens += 20
	}

	// Adjust by visibility
	if result.Symbol.Visibility == "public" {
		tokens += 10
	}

	return tokens
}

// TokenCounter estimates total tokens for content
type TokenCounter struct {
	// Rough estimates: 1 token ≈ 4 characters in English
	charsPerToken float32
}

// NewTokenCounter creates a token counter
func NewTokenCounter() *TokenCounter {
	return &TokenCounter{
		charsPerToken: 4.0,
	}
}

// CountTokens estimates token count for content
func (tc *TokenCounter) CountTokens(content string) int {
	return int(float32(len(content)) / tc.charsPerToken)
}

// CountItemTokens counts tokens for multiple items
func (tc *TokenCounter) CountItemTokens(items []ContextItem) int {
	total := 0
	for _, item := range items {
		total += item.Tokens
	}
	return total
}
```

### src/Backend/internal/retriever/graph.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
)

// GraphSymbol represents a symbol in the knowledge graph
type GraphSymbol struct {
	ID                string
	QualifiedName     string
	Kind              string
	Summary           string
	FilePath          string
	Visibility        string
	QualityScore      float32
	RelatedUpstream   []string // Incoming relations
	RelatedDownstream []string // Outgoing relations
}

// GraphExpander expands search results using graph relationships
type GraphExpander struct {
	maxDepth   int
	maxResults int
}

// NewGraphExpander creates a graph expander
func NewGraphExpander(maxDepth int, maxResults int) *GraphExpander {
	if maxDepth < 1 {
		maxDepth = 2
	}
	if maxResults < 1 {
		maxResults = 50
	}
	return &GraphExpander{
		maxDepth:   maxDepth,
		maxResults: maxResults,
	}
}

// ExpandedResult represents a symbol and its graph context
type ExpandedResult struct {
	Symbol       GraphSymbol
	Distance     int
	RelationType string
	Importance   float32
}

// ExpandSymbols expands a symbol using BFS to find related symbols
func (ge *GraphExpander) ExpandSymbols(ctx context.Context, startSymbols []GraphSymbol) ([]ExpandedResult, error) {
	if len(startSymbols) == 0 {
		return nil, fmt.Errorf("no start symbols provided")
	}

	results := make([]ExpandedResult, 0)
	visited := make(map[string]bool)
	queue := make([]bfsNode, 0)

	// Initialize queue with start symbols
	for _, sym := range startSymbols {
		queue = append(queue, bfsNode{
			symbol:   sym,
			distance: 0,
			relation: "start",
		})
		visited[sym.ID] = true
	}

	// BFS traversal
	for len(queue) > 0 && len(results) < ge.maxResults {
		node := queue[0]
		queue = queue[1:]

		// Add to results
		importance := ge.calculateImportance(node.symbol, node.distance)
		results = append(results, ExpandedResult{
			Symbol:       node.symbol,
			Distance:     node.distance,
			RelationType: node.relation,
			Importance:   importance,
		})

		// Expand if within depth limit
		if node.distance < ge.maxDepth {
			// Explore upstream (callers/importers)
			for _, upID := range node.symbol.RelatedUpstream {
				if !visited[upID] && len(results) < ge.maxResults {
					visited[upID] = true
					// In real implementation, fetch symbol from DB
					childSymbol := GraphSymbol{
						ID:            upID,
						QualifiedName: upID,
						Kind:          "unknown",
					}
					queue = append(queue, bfsNode{
						symbol:   childSymbol,
						distance: node.distance + 1,
						relation: "called_by",
					})
				}
			}

			// Explore downstream (callees/dependencies)
			for _, downID := range node.symbol.RelatedDownstream {
				if !visited[downID] && len(results) < ge.maxResults {
					visited[downID] = true
					// In real implementation, fetch symbol from DB
					childSymbol := GraphSymbol{
						ID:            downID,
						QualifiedName: downID,
						Kind:          "unknown",
					}
					queue = append(queue, bfsNode{
						symbol:   childSymbol,
						distance: node.distance + 1,
						relation: "calls",
					})
				}
			}
		}
	}

	// Sort by importance
	sortByImportance(results)

	return results, nil
}

// calculateImportance calculates importance based on quality and distance
func (ge *GraphExpander) calculateImportance(symbol GraphSymbol, distance int) float32 {
	// Closer symbols are more important
	distanceFactor := float32(1.0) / (1.0 + float32(distance)*0.5)

	// Higher quality symbols are more important
	qualityFactor := symbol.QualityScore

	// Public symbols are slightly more important
	visibilityFactor := float32(0.8)
	if symbol.Visibility == "public" {
		visibilityFactor = 1.0
	}

	importance := distanceFactor * qualityFactor * visibilityFactor
	return min(importance, 1.0)
}

// bfsNode represents a node in BFS traversal
type bfsNode struct {
	symbol   GraphSymbol
	distance int
	relation string
}

// sortByImportance sorts results by importance (descending)
func sortByImportance(results []ExpandedResult) {
	// Simple bubble sort for now (can be optimized)
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].Importance > results[i].Importance {
				results[i], results[j] = results[j], results[i]
			}
		}
	}
}

// ConflictDetector detects conflicts in expanded results
type ConflictDetector struct {
	logger *slog.Logger
}

// NewConflictDetector creates a conflict detector
func NewConflictDetector(logger *slog.Logger) *ConflictDetector {
	if logger == nil {
		logger = slog.Default()
	}
	return &ConflictDetector{logger: logger}
}

// Conflict represents a detected conflict
type Conflict struct {
	Type        string // "inconsistent_visibility", "circular_dependency", etc.
	Symbol1     string
	Symbol2     string
	Severity    string // "error", "warning", "info"
	Description string
}

// DetectConflicts detects conflicts in expanded results
func (cd *ConflictDetector) DetectConflicts(ctx context.Context, results []ExpandedResult) ([]Conflict, error) {
	conflicts := make([]Conflict, 0)
	mu := sync.Mutex{}

	// Check for visibility conflicts
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if hasVisibilityConflict(results[i].Symbol, results[j].Symbol) {
				mu.Lock()
				conflicts = append(conflicts, Conflict{
					Type:     "inconsistent_visibility",
					Symbol1:  results[i].Symbol.ID,
					Symbol2:  results[j].Symbol.ID,
					Severity: "warning",
					Description: fmt.Sprintf(
						"Symbol %s (visibility: %s) related to %s (visibility: %s)",
						results[i].Symbol.QualifiedName,
						results[i].Symbol.Visibility,
						results[j].Symbol.QualifiedName,
						results[j].Symbol.Visibility,
					),
				})
				mu.Unlock()
			}
		}
	}

	cd.logger.InfoContext(ctx, "conflict detection completed",
		"total_results", len(results),
		"conflicts_found", len(conflicts),
	)

	return conflicts, nil
}

// hasVisibilityConflict checks if two symbols have conflicting visibility
func hasVisibilityConflict(sym1, sym2 GraphSymbol) bool {
	// Public symbol shouldn't call private symbol in many languages
	if sym1.Visibility == "public" && sym2.Visibility == "private" {
		return true
	}
	return false
}
```

### src/Backend/internal/retriever/hydrator.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/dungpd4/rad-system/internal/metadata"
)

// HydrationLevel represents the level of hydration
type HydrationLevel int

const (
	L3Only      HydrationLevel = 0 // Only L2/L3 metadata, no L4 raw source
	L4Optional  HydrationLevel = 1 // L4 raw source loaded if budget permits
	L4Required  HydrationLevel = 2 // L4 raw source must be loaded
)

// HydrationPolicy defines the hydration policy for a given intent
type HydrationPolicy struct {
	Level       HydrationLevel
	MaxL4Tokens int
}

// hydrationPolicyByIntent maps SearchIntent to HydrationPolicy
var hydrationPolicyByIntent = map[SearchIntent]HydrationPolicy{
	IntentSpecGeneration: {Level: L3Only, MaxL4Tokens: 0},
	IntentEstimation:     {Level: L3Only, MaxL4Tokens: 0},
	IntentBugFix:         {Level: L4Required, MaxL4Tokens: 4000},
	IntentCodeReview:     {Level: L4Required, MaxL4Tokens: 4000},
	IntentTestRepair:     {Level: L3Only, MaxL4Tokens: 2000},
	IntentGeneral:        {Level: L3Only, MaxL4Tokens: 0},
}

// HydratedResult represents a search result that has been hydrated with context
type HydratedResult struct {
	StableKey    string   `json:"stable_key"`
	Score        float32  `json:"score"`
	L2Summary    string   `json:"l2_summary"`
	L3Facts      []string `json:"l3_facts"`
	L4Source     string   `json:"l4_source,omitempty"`
	L4Loaded     bool     `json:"l4_loaded"`
	TokenCount   int      `json:"token_count"`
	KnowledgeDoc string   `json:"knowledge_doc,omitempty"`
}

// Hydrator enriches search results with additional context (Stage 6)
type Hydrator interface {
	Hydrate(ctx context.Context, symbols []SearchResult, intent *IntentResult, epochID int64) ([]HydratedResult, error)
}

// DefaultHydrator implements Hydrator using DB lookups and filesystem knowledge docs
type DefaultHydrator struct {
	knowledgeDir string
	db           metadata.DB
	counter      *TokenCounter
	logger       *slog.Logger
}

// NewDefaultHydrator creates a new DefaultHydrator
func NewDefaultHydrator(knowledgeDir string, db metadata.DB, logger *slog.Logger) *DefaultHydrator {
	if logger == nil {
		logger = slog.Default()
	}
	return &DefaultHydrator{
		knowledgeDir: knowledgeDir,
		db:           db,
		counter:      NewTokenCounter(),
		logger:       logger,
	}
}

// Hydrate hydrates the top-5 search results with L2/L3/L4 context
func (h *DefaultHydrator) Hydrate(ctx context.Context, symbols []SearchResult, intent *IntentResult, epochID int64) ([]HydratedResult, error) {
	if intent == nil {
		return nil, fmt.Errorf("intent result is required")
	}

	// Determine policy from intent
	policy, ok := hydrationPolicyByIntent[intent.Intent]
	if !ok {
		policy = hydrationPolicyByIntent[IntentGeneral]
	}

	// Process at most 5 results
	maxResults := 5
	if len(symbols) < maxResults {
		maxResults = len(symbols)
	}

	results := make([]HydratedResult, 0, maxResults)

	for i := 0; i < maxResults; i++ {
		sym := symbols[i]

		hr := HydratedResult{
			StableKey: sym.StableKey,
			Score:     float32(sym.Score),
		}

		// Load L2 summary and L3 facts from DB (skip if no DB configured)
		if h.db != nil {
			symbol, err := h.db.GetSymbol(ctx, 0, epochID, sym.StableKey)
			if err == nil && symbol != nil {
				hr.L2Summary = symbol.Signature
				if symbol.QualifiedName != "" {
					hr.L3Facts = append(hr.L3Facts,
						fmt.Sprintf("name: %s", symbol.QualifiedName),
						fmt.Sprintf("kind: %s", symbol.Kind),
					)
				}
			} else {
				hr.L2Summary = sym.Content
			}
		} else {
			hr.L2Summary = sym.Content
		}

		// Attempt to load knowledge doc from filesystem
		docPath := h.buildDocPath(epochID, sym.StableKey)
		docContent, err := h.loadKnowledgeDoc(docPath)
		if err == nil {
			hr.KnowledgeDoc = docContent
		}
		// Missing file is non-fatal — proceed with L2/L3 only

		// Apply policy for L4 loading
		if policy.Level >= L4Optional || policy.Level == L4Required {
			l4Content, l4Loaded := h.loadL4Source(ctx, sym, epochID, policy.MaxL4Tokens)
			hr.L4Source = l4Content
			hr.L4Loaded = l4Loaded
		}

		// Estimate token count
		hr.TokenCount = h.estimateTokens(&hr)

		results = append(results, hr)
	}

	return results, nil
}

// buildDocPath builds the filesystem path for a knowledge doc
func (h *DefaultHydrator) buildDocPath(epochID int64, stableKey string) string {
	return filepath.Join(h.knowledgeDir, fmt.Sprintf("%d", epochID), stableKey+".md")
}

// loadKnowledgeDoc attempts to load a knowledge doc from the filesystem
func (h *DefaultHydrator) loadKnowledgeDoc(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", err // file not found — caller handles gracefully
		}
		return "", fmt.Errorf("read knowledge doc: %w", err)
	}
	return string(data), nil
}

// loadL4Source attempts to load raw source for a search result
func (h *DefaultHydrator) loadL4Source(ctx context.Context, sym SearchResult, epochID int64, maxTokens int) (string, bool) {
	if sym.Content == "" {
		return "", false
	}

	tokens := h.counter.CountTokens(sym.Content)
	if maxTokens > 0 && tokens > maxTokens {
		// Truncate to max tokens
		charsPerToken := 4
		maxChars := maxTokens * charsPerToken
		if maxChars > len(sym.Content) {
			maxChars = len(sym.Content)
		}
		return sym.Content[:maxChars], true
	}

	return sym.Content, true
}

// estimateTokens estimates total token count for a HydratedResult
func (h *DefaultHydrator) estimateTokens(hr *HydratedResult) int {
	total := 0
	total += h.counter.CountTokens(hr.L2Summary)
	for _, fact := range hr.L3Facts {
		total += h.counter.CountTokens(fact)
	}
	total += h.counter.CountTokens(hr.L4Source)
	total += h.counter.CountTokens(hr.KnowledgeDoc)
	return total
}
```

### src/Backend/internal/retriever/intent_detector.go
```
package retriever

import (
	"context"
	"regexp"
	"sync"
)

// SearchIntent represents the type of search intent
type SearchIntent string

const (
	IntentSpecGeneration SearchIntent = "spec_generation"
	IntentEstimation     SearchIntent = "estimation"
	IntentBugFix         SearchIntent = "bug_fix"
	IntentCodeReview     SearchIntent = "code_review"
	IntentTestRepair     SearchIntent = "test_repair"
	IntentGeneral        SearchIntent = "general"
)

// IntentResult holds the result of intent detection
type IntentResult struct {
	Intent     SearchIntent
	Confidence float32
	DomainHint string
}

// IntentDetector detects the search intent from a query string
type IntentDetector interface {
	Detect(ctx context.Context, query string) (*IntentResult, error)
}

// intentRule holds compiled regex patterns for a single intent
type intentRule struct {
	intent   SearchIntent
	patterns []*regexp.Regexp
}

// RuleBasedIntentDetector implements IntentDetector using regex pattern matching
type RuleBasedIntentDetector struct {
	rules              []intentRule
	domainHintPatterns map[string]*regexp.Regexp
	once               sync.Once
}

// NewRuleBasedIntentDetector creates a new RuleBasedIntentDetector
func NewRuleBasedIntentDetector() *RuleBasedIntentDetector {
	d := &RuleBasedIntentDetector{}
	d.once.Do(d.compilePatterns)
	return d
}

// compilePatterns compiles all regex patterns (called once via sync.Once)
func (d *RuleBasedIntentDetector) compilePatterns() {
	d.rules = []intentRule{
		{
			intent: IntentSpecGeneration,
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\bspec\b`),
				regexp.MustCompile(`(?i)\bspecification\b`),
				regexp.MustCompile(`(?i)\brequirement\b`),
				regexp.MustCompile(`設計書`),
				regexp.MustCompile(`仕様`),
			},
		},
		{
			intent: IntentEstimation,
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\bestimate\b`),
				regexp.MustCompile(`(?i)\bestimation\b`),
				regexp.MustCompile(`見積`),
				regexp.MustCompile(`工数`),
				regexp.MustCompile(`(?i)\bstory point\b`),
				regexp.MustCompile(`(?i)\bhow long\b`),
			},
		},
		{
			intent: IntentTestRepair,
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)test.*fail`),
				regexp.MustCompile(`(?i)\bfailing test\b`),
				regexp.MustCompile(`テスト.*失敗`),
				regexp.MustCompile(`(?i)\brepair test\b`),
				regexp.MustCompile(`(?i)\bfix test\b`),
			},
		},
		{
			intent: IntentBugFix,
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\bbug\b`),
				regexp.MustCompile(`(?i)\bfix\b`),
				regexp.MustCompile(`(?i)\berror\b`),
				regexp.MustCompile(`(?i)\bexception\b`),
				regexp.MustCompile(`(?i)\bcrash\b`),
				regexp.MustCompile(`バグ`),
				regexp.MustCompile(`修正`),
			},
		},
		{
			intent: IntentCodeReview,
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\breview\b`),
				regexp.MustCompile(`レビュー`),
				regexp.MustCompile(`(?i)\bcheck\b`),
				regexp.MustCompile(`(?i)\binspect\b`),
				regexp.MustCompile(`(?i)\bverify\b`),
			},
		},
	}

	d.domainHintPatterns = map[string]*regexp.Regexp{
		"auth":         regexp.MustCompile(`(?i)\bauth\b`),
		"payment":      regexp.MustCompile(`(?i)\bpayment\b`),
		"user":         regexp.MustCompile(`(?i)\buser\b`),
		"notification": regexp.MustCompile(`(?i)\bnotification\b`),
	}
}

// Detect detects the search intent from a query string
func (d *RuleBasedIntentDetector) Detect(ctx context.Context, query string) (*IntentResult, error) {
	if query == "" {
		return &IntentResult{
			Intent:     IntentGeneral,
			Confidence: 0.50,
		}, nil
	}

	// Compile patterns if not already done
	d.once.Do(d.compilePatterns)

	// Match against each intent rule in priority order
	for _, rule := range d.rules {
		for _, pattern := range rule.patterns {
			if pattern.MatchString(query) {
				// Extract domain hint
				domainHint := d.extractDomainHint(query)
				return &IntentResult{
					Intent:     rule.intent,
					Confidence: 0.90,
					DomainHint: domainHint,
				}, nil
			}
		}
	}

	// No match — return general intent
	domainHint := d.extractDomainHint(query)
	return &IntentResult{
		Intent:     IntentGeneral,
		Confidence: 0.50,
		DomainHint: domainHint,
	}, nil
}

// extractDomainHint extracts domain hint from query
func (d *RuleBasedIntentDetector) extractDomainHint(query string) string {
	for domain, pattern := range d.domainHintPatterns {
		if pattern.MatchString(query) {
			return domain
		}
	}
	return ""
}

// ValidateSearchIntent validates that a string is a valid SearchIntent
func ValidateSearchIntent(s string) (SearchIntent, error) {
	switch SearchIntent(s) {
	case IntentSpecGeneration, IntentEstimation, IntentBugFix,
		IntentCodeReview, IntentTestRepair, IntentGeneral:
		return SearchIntent(s), nil
	default:
		// Unknown intents default to general search
		return IntentGeneral, nil
	}
}
```

### src/Backend/internal/retriever/metadata_filter.go
```
package retriever

import (
	"context"
	"fmt"
	"strings"

	"github.com/dungpd4/rad-system/internal/metadata"
)

// FilterParams holds parameters for metadata filtering
type FilterParams struct {
	RepoID     int64
	EpochID    int64
	MinQuality float32
	DomainHint string
	Kinds      []string
	Limit      int
}

// Default values for filter params
const (
	defaultMinQuality = 0.75
	defaultFilterLimit = 200
)

// MetadataFilter filters symbol candidates by metadata before vector search
type MetadataFilter interface {
	Filter(ctx context.Context, intent *IntentResult, repoID, epochID int64) ([]string, error)
}

// SQLiteMetadataFilter implements MetadataFilter using SQLite queries
type SQLiteMetadataFilter struct {
	db         metadata.DB
	minQuality float32
	resultLimit int
}

// kindsByIntent maps SearchIntent to allowed symbol kinds
var kindsByIntent = map[SearchIntent][]string{
	IntentSpecGeneration: {"method", "interface", "class"},
	IntentEstimation:     {"method", "class"},
	IntentBugFix:         {"method"},
	IntentCodeReview:     {"method", "property"},
	IntentTestRepair:     {"method"},
	IntentGeneral:        {}, // no kind filter for general
}

// NewSQLiteMetadataFilter creates a new SQLiteMetadataFilter
func NewSQLiteMetadataFilter(db metadata.DB) *SQLiteMetadataFilter {
	return &SQLiteMetadataFilter{
		db:          db,
		minQuality:  defaultMinQuality,
		resultLimit: defaultFilterLimit,
	}
}

// SetMinQuality overrides the default minimum quality threshold
func (f *SQLiteMetadataFilter) SetMinQuality(q float32) {
	if q >= 0 && q <= 1 {
		f.minQuality = q
	}
}

// SetResultLimit overrides the default result limit
func (f *SQLiteMetadataFilter) SetResultLimit(limit int) {
	if limit > 0 {
		f.resultLimit = limit
	}
}

// Filter filters symbol candidates by metadata
// Joins symbols with embedding_items for quality_score and graph_nodes for domain.
func (f *SQLiteMetadataFilter) Filter(ctx context.Context, intent *IntentResult, repoID, epochID int64) ([]string, error) {
	if intent == nil {
		return nil, fmt.Errorf("intent result is required")
	}

	// Determine kind filter from intent
	kinds := kindsByIntent[intent.Intent]

	// Build dynamic WHERE clause
	clauses := []string{}
	args := []interface{}{}

	// Base filters
	clauses = append(clauses, "s.repo_id = ?")
	args = append(args, repoID)

	clauses = append(clauses, "s.epoch = ?")
	args = append(args, epochID)

	// Quality score filter via embedding_items
	clauses = append(clauses, "COALESCE(ei.quality_score, 0) >= ?")
	args = append(args, f.minQuality)

	// Domain hint filter — use graph_nodes if available
	if intent.DomainHint != "" {
		clauses = append(clauses, "gn.domain = ?")
		args = append(args, intent.DomainHint)
	}

	// Kind filter (from symbols table)
	if len(kinds) > 0 {
		placeholders := makePlaceholders(len(kinds))
		clauses = append(clauses, fmt.Sprintf("s.kind IN (%s)", placeholders))
		for _, k := range kinds {
			args = append(args, k)
		}
	}

	whereClause := strings.Join(clauses, " AND ")

	// Build full query
	query := fmt.Sprintf(`
		SELECT DISTINCT s.symbol_key
		FROM symbols s
		LEFT JOIN embedding_items ei ON ei.stable_key = s.symbol_key
			AND ei.item_type = 'symbol'
			AND ei.repo_id = s.repo_id
			AND ei.epoch = s.epoch
		LEFT JOIN graph_nodes gn ON gn.qualified_name = s.qualified_name
			AND gn.repo_id = s.repo_id
			AND gn.epoch = s.epoch
		WHERE %s
		ORDER BY COALESCE(ei.quality_score, 0) DESC
		LIMIT ?
	`, whereClause)

	args = append(args, f.resultLimit)

	// Execute query
	rows, err := f.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("metadata filter query: %w", err)
	}
	defer rows.Close()

	var symbolKeys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, fmt.Errorf("scan symbol key: %w", err)
		}
		symbolKeys = append(symbolKeys, key)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration: %w", err)
	}

	return symbolKeys, nil
}

// makePlaceholders generates a comma-separated list of SQL placeholders
func makePlaceholders(n int) string {
	if n <= 0 {
		return ""
	}
	parts := make([]string, n)
	for i := 0; i < n; i++ {
		parts[i] = "?"
	}
	return strings.Join(parts, ", ")
}
```

### src/Backend/internal/retriever/models.go
```
package retriever

import "time"

// SearchRequest represents a search query
type SearchRequest struct {
	QueryText   string            `json:"query_text"`
	TopK        int               `json:"top_k"`
	RepoID      int64             `json:"repo_id"`
	Epoch       int64             `json:"epoch"`
	Filters     map[string]string `json:"filters"`
	ExpandGraph bool              `json:"expand_graph"`
	GraphDepth  int               `json:"graph_depth"`
	TaskType    string            `json:"task_type,omitempty"` // Pre-set intent override
	TokenBudget int               `json:"token_budget,omitempty"` // Per-request budget override
}

// LLMContext represents the final context prepared for LLM consumption
type LLMContext struct {
	Content   string `json:"content"`
	TokenSize int    `json:"token_size"`
}

// StageTimings holds per-stage latency measurements in milliseconds
type StageTimings struct {
	Stage1Ms int64 `json:"stage1_ms"` // Intent Detection
	Stage2Ms int64 `json:"stage2_ms"` // Metadata Filter
	Stage3Ms int64 `json:"stage3_ms"` // Vector Search
	Stage4Ms int64 `json:"stage4_ms"` // Graph Expansion
	Stage5Ms int64 `json:"stage5_ms"` // Reranker
	Stage6Ms int64 `json:"stage6_ms"` // Hydration
	Stage7Ms int64 `json:"stage7_ms"` // Context Packing
	TotalMs  int64 `json:"total_ms"`
}

// SearchResponse contains search results
type SearchResponse struct {
	Results      []SearchResult `json:"results"`
	TotalFound   int            `json:"total_found"`
	ProcessTime  time.Duration  `json:"process_time"`
	LLMContext   *LLMContext    `json:"llm_context,omitempty"`
	TokenUsage   *TokenUsage    `json:"token_usage,omitempty"`
	StageTimings *StageTimings  `json:"stage_timings,omitempty"`
}

// SearchResult represents a single search result
type SearchResult struct {
	Source       string         `json:"source"` // "symbol", "chunk", "file"
	StableKey    string         `json:"stable_key"`
	Score        float64        `json:"score"`
	Content      string         `json:"content"`
	FilePath     string         `json:"file_path"`
	StartLine    int            `json:"start_line"`
	EndLine      int            `json:"end_line"`
	RelatedItems []RelatedItem  `json:"related_items"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// RelatedItem represents a related symbol or chunk
type RelatedItem struct {
	StableKey string  `json:"stable_key"`
	Type      string  `json:"type"` // "symbol", "chunk", "file"
	Distance  int     `json:"distance"`
	Score     float64 `json:"score"`
	FilePath  string  `json:"file_path"`
}

// VectorSearchResult represents raw vector search result
type VectorSearchResult struct {
	VectorKey   string
	StableKey   string
	Score       float64
	ItemType    string
	ContentHash string
}
```

### src/Backend/internal/retriever/query_expansion.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

// QueryExpansionStrategy defines how queries are expanded
type QueryExpansionStrategy interface {
	Expand(ctx context.Context, query string) ([]string, error)
}

// SimpleQueryExpander expands queries using synonym and related term substitution
type SimpleQueryExpander struct {
	synonymMap map[string][]string
	logger     *slog.Logger
}

// NewSimpleQueryExpander creates a simple query expander
func NewSimpleQueryExpander(logger *slog.Logger) *SimpleQueryExpander {
	if logger == nil {
		logger = slog.Default()
	}

	// Build synonym map for common programming terms
	synonymMap := map[string][]string{
		"auth":        {"authentication", "authorization", "login", "password"},
		"database":    {"db", "sql", "storage", "persistence"},
		"error":       {"exception", "failure", "bug", "issue"},
		"function":    {"method", "procedure", "routine", "handler"},
		"class":       {"object", "type", "struct", "interface"},
		"api":         {"endpoint", "service", "handler", "controller"},
		"test":        {"unit test", "integration test", "test case", "testing"},
		"performance": {"speed", "latency", "throughput", "efficiency"},
		"security":    {"encryption", "authentication", "authorization", "safety"},
		"logging":     {"log", "trace", "debug", "monitoring"},
		"cache":       {"memory cache", "caching", "memoization", "buffer"},
	}

	return &SimpleQueryExpander{
		synonymMap: synonymMap,
		logger:     logger,
	}
}

// Expand expands a query by generating related queries
func (sq *SimpleQueryExpander) Expand(ctx context.Context, query string) ([]string, error) {
	expanded := []string{query} // Always include original

	// Extract key terms
	terms := extractKeyTerms(query)

	// Generate synonym variations
	for _, term := range terms {
		if synonyms, ok := sq.synonymMap[strings.ToLower(term)]; ok {
			for _, syn := range synonyms {
				// Replace term with synonym
				expandedQuery := strings.ReplaceAll(strings.ToLower(query), strings.ToLower(term), syn)
				if !contains(expanded, expandedQuery) {
					expanded = append(expanded, expandedQuery)
				}
			}
		}
	}

	// Generate compound queries (combine terms differently)
	if len(terms) > 1 {
		// Add negations
		for i := range terms {
			withoutTerm := removeTermAt(terms, i)
			if len(withoutTerm) > 0 {
				compoundQuery := strings.Join(withoutTerm, " ")
				if !contains(expanded, compoundQuery) {
					expanded = append(expanded, compoundQuery)
				}
			}
		}
	}

	sq.logger.InfoContext(ctx, "query expansion completed",
		"original", query,
		"variants", len(expanded)-1,
		"total_queries", len(expanded))

	return expanded, nil
}

// SemanticQueryExpander expands queries using semantic relationships
type SemanticQueryExpander struct {
	conceptMap map[string][]string // Concept → related concepts
	logger     *slog.Logger
}

// NewSemanticQueryExpander creates a semantic query expander
func NewSemanticQueryExpander(logger *slog.Logger) *SemanticQueryExpander {
	if logger == nil {
		logger = slog.Default()
	}

	// Map concepts to related terms
	conceptMap := map[string][]string{
		"authentication": {
			"login", "signin", "credentials", "username", "password",
			"session", "token", "jwt", "oauth", "saml",
		},
		"sorting": {
			"order", "arrange", "compare", "ascending", "descending",
			"quicksort", "mergesort", "heapsort", "bubblesort",
		},
		"searching": {
			"find", "locate", "query", "lookup", "scan", "traverse",
			"bsearch", "linear search", "binary search",
		},
		"optimization": {
			"performance", "speed", "fast", "efficient", "scale",
			"cache", "parallel", "async", "concurrent",
		},
		"debugging": {
			"trace", "log", "breakpoint", "inspect", "monitor",
			"profiler", "debugger", "stacktrace", "assertion",
		},
	}

	return &SemanticQueryExpander{
		conceptMap: conceptMap,
		logger:     logger,
	}
}

// Expand expands query using semantic relationships
func (se *SemanticQueryExpander) Expand(ctx context.Context, query string) ([]string, error) {
	expanded := []string{query}

	// Identify concepts in query
	for concept, relatedTerms := range se.conceptMap {
		if strings.Contains(strings.ToLower(query), strings.ToLower(concept)) {
			// Generate query with each related term
			for _, relTerm := range relatedTerms {
				expandedQuery := strings.ReplaceAll(strings.ToLower(query), strings.ToLower(concept), relTerm)
				if !contains(expanded, expandedQuery) {
					expanded = append(expanded, expandedQuery)
					if len(expanded) > 10 { // Limit expansion
						break
					}
				}
			}
			if len(expanded) > 10 {
				break
			}
		}
	}

	se.logger.InfoContext(ctx, "semantic query expansion completed",
		"original", query,
		"variants", len(expanded)-1)

	return expanded, nil
}

// MultiQueryExpander combines multiple expansion strategies
type MultiQueryExpander struct {
	expanders  []QueryExpansionStrategy
	logger     *slog.Logger
	maxQueries int
}

// NewMultiQueryExpander creates a multi-strategy expander
func NewMultiQueryExpander(maxQueries int, logger *slog.Logger) *MultiQueryExpander {
	if logger == nil {
		logger = slog.Default()
	}

	if maxQueries == 0 {
		maxQueries = 10
	}

	return &MultiQueryExpander{
		expanders: []QueryExpansionStrategy{
			NewSimpleQueryExpander(logger),
			NewSemanticQueryExpander(logger),
		},
		logger:     logger,
		maxQueries: maxQueries,
	}
}

// Expand expands query using all strategies
func (mq *MultiQueryExpander) Expand(ctx context.Context, query string) ([]string, error) {
	allExpanded := map[string]bool{
		query: true, // Include original
	}

	// Apply each strategy
	for _, expander := range mq.expanders {
		expanded, err := expander.Expand(ctx, query)
		if err != nil {
			mq.logger.WarnContext(ctx, "expansion strategy failed",
				"expander_type", fmt.Sprintf("%T", expander),
				"error", err)
			continue
		}

		for _, q := range expanded {
			allExpanded[q] = true
			if len(allExpanded) >= mq.maxQueries {
				break
			}
		}

		if len(allExpanded) >= mq.maxQueries {
			break
		}
	}

	// Convert map to slice
	result := make([]string, 0, len(allExpanded))
	result = append(result, query) // Keep original first

	for q := range allExpanded {
		if q != query {
			result = append(result, q)
		}
	}

	// Limit to maxQueries
	if len(result) > mq.maxQueries {
		result = result[:mq.maxQueries]
	}

	mq.logger.InfoContext(ctx, "multi-strategy query expansion completed",
		"original", query,
		"total_queries", len(result))

	return result, nil
}

// ExpansionResult represents results from query expansion
type ExpansionResult struct {
	OriginalQuery   string
	ExpandedQueries []string
	ResultsPerQuery map[string][]RankedCandidate
	CombinedResults []RankedCandidate
	Timestamp       string
}

// Helper functions

func extractKeyTerms(query string) []string {
	terms := []string{}
	words := strings.Fields(query)

	// Filter out common stop words
	stopWords := map[string]bool{
		"the": true, "a": true, "an": true, "and": true, "or": true,
		"is": true, "are": true, "was": true, "been": true,
		"in": true, "on": true, "at": true, "to": true, "for": true,
	}

	for _, word := range words {
		lowered := strings.ToLower(word)
		if !stopWords[lowered] && len(word) > 2 {
			terms = append(terms, word)
		}
	}

	return terms
}

func removeTermAt(terms []string, index int) []string {
	result := make([]string, 0, len(terms)-1)
	for i, term := range terms {
		if i != index {
			result = append(result, term)
		}
	}
	return result
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// RankMultiQueryResults combines and reranks results from multiple queries
func RankMultiQueryResults(
	ctx context.Context,
	queryResults map[string][]RankedCandidate,
	reranker *SimpleReranker,
	logger *slog.Logger,
) ([]RankedCandidate, error) {
	if len(queryResults) == 0 {
		return []RankedCandidate{}, nil
	}

	// Combine all results
	combined := make(map[string]RankedCandidate)

	for _, results := range queryResults {
		for _, candidate := range results {
			if existing, ok := combined[candidate.ID]; ok {
				// Accumulate scores from multiple queries
				existing.Score = (existing.Score + candidate.Score) / 2
				combined[candidate.ID] = existing
			} else {
				combined[candidate.ID] = candidate
			}
		}
	}

	// Convert to slice
	combinedList := make([]RankedCandidate, 0, len(combined))
	for _, cand := range combined {
		combinedList = append(combinedList, cand)
	}

	// Re-rank combined results
	finalResults := make([]RankedCandidate, 0)
	for q := range queryResults {
		reranked, err := reranker.Rerank(ctx, q, combinedList)
		if err != nil {
			logger.WarnContext(ctx, "reranking failed for query",
				"query", q,
				"error", err)
			continue
		}
		finalResults = reranked
		break // Use first successful reranking
	}

	logger.InfoContext(ctx, "multi-query results ranked",
		"queries", len(queryResults),
		"combined_candidates", len(combinedList),
		"final_results", len(finalResults))

	return finalResults, nil
}
```

### src/Backend/internal/retriever/ranker.go
```
package retriever

import (
	"log/slog"
	"sort"
	"strings"
)

// Ranker re-ranks search results
type Ranker struct {
	logger *slog.Logger
}

// RankerConfig configures ranker
type RankerConfig struct {
	Logger *slog.Logger
}

// NewRanker creates a new ranker
func NewRanker(config RankerConfig) *Ranker {
	return &Ranker{
		logger: config.Logger,
	}
}

// Rank re-ranks search results using multiple signals
func (r *Ranker) Rank(results []SearchResult, req SearchRequest) []SearchResult {
	if len(results) == 0 {
		return results
	}

	r.logger.Debug("Ranking results", "count", len(results))

	// Calculate combined scores
	for i := range results {
		originalScore := results[i].Score
		results[i].Score = r.calculateScore(results[i], req)
		if results[i].Score != originalScore {
			r.logger.Debug("Score adjusted", "stable_key", results[i].StableKey, "original", originalScore, "adjusted", results[i].Score)
		}
	}

	// Sort by score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}

// calculateScore computes a combined relevance score
func (r *Ranker) calculateScore(result SearchResult, req SearchRequest) float64 {
	score := result.Score // Start with vector similarity score

	// Avoid zero score - if score is 0, use a default minimum
	if score <= 0 {
		score = 0.5 // Default minimum score for degraded results
	}

	// Boost based on source type
	switch result.Source {
	case "symbol":
		score *= 1.2 // Symbols are often more relevant
	case "chunk":
		score *= 1.0
	case "file":
		score *= 0.8
	}

	// Boost based on content match
	queryLower := strings.ToLower(req.QueryText)
	contentLower := strings.ToLower(result.Content)
	stableKeyLower := strings.ToLower(result.StableKey)

	// Exact name match
	if strings.Contains(stableKeyLower, queryLower) {
		score *= 1.5
	}

	// Partial name match
	queryWords := strings.Fields(queryLower)
	matchCount := 0
	for _, word := range queryWords {
		if len(word) < 3 {
			continue // Skip short words
		}
		if strings.Contains(stableKeyLower, word) {
			matchCount++
		}
		if strings.Contains(contentLower, word) {
			matchCount++
		}
	}
	if matchCount > 0 {
		score *= (1.0 + 0.1*float64(matchCount))
	}

	// Boost symbols with related items (well-connected in graph)
	if len(result.RelatedItems) > 0 {
		connectivityBoost := 1.0 + (0.05 * float64(len(result.RelatedItems)))
		if connectivityBoost > 1.3 {
			connectivityBoost = 1.3 // Cap boost
		}
		score *= connectivityBoost
	}

	// Boost based on metadata
	if result.Metadata != nil {
		// Public symbols are more relevant than private
		if visibility, ok := result.Metadata["visibility"].(string); ok {
			if visibility == "public" || visibility == "exported" {
				score *= 1.1
			}
		}

		// Functions are more relevant than variables
		if kind, ok := result.Metadata["kind"].(string); ok {
			switch kind {
			case "function", "method":
				score *= 1.15
			case "class", "struct", "interface":
				score *= 1.1
			case "variable", "constant":
				score *= 0.95
			}
		}
	}

	// Length penalty for very short content
	if len(result.Content) < 50 {
		score *= 0.9
	}

	// Freshness: Results from higher epochs are slightly preferred
	// (This assumes epoch increases with time)
	// score *= (1.0 + 0.001*float64(result.Epoch))

	return score
}

// DedupResults removes duplicate results based on stable_key
func (r *Ranker) DedupResults(results []SearchResult) []SearchResult {
	seen := make(map[string]bool)
	deduped := make([]SearchResult, 0, len(results))

	for _, result := range results {
		if seen[result.StableKey] {
			continue
		}
		seen[result.StableKey] = true
		deduped = append(deduped, result)
	}

	return deduped
}

// FilterByScore removes results below a minimum score threshold
func (r *Ranker) FilterByScore(results []SearchResult, minScore float64) []SearchResult {
	filtered := make([]SearchResult, 0)
	for _, result := range results {
		if result.Score >= minScore {
			filtered = append(filtered, result)
		}
	}
	return filtered
}

// GroupByFile groups search results by file path
func (r *Ranker) GroupByFile(results []SearchResult) map[string][]SearchResult {
	grouped := make(map[string][]SearchResult)
	for _, result := range results {
		grouped[result.FilePath] = append(grouped[result.FilePath], result)
	}
	return grouped
}

// BoostByFilters applies custom boosting based on filters
func (r *Ranker) BoostByFilters(results []SearchResult, filters map[string]string) []SearchResult {
	// Apply custom filter-based boosting
	for i := range results {
		// Example: boost results from specific languages
		if lang, ok := filters["language"]; ok {
			if strings.Contains(results[i].FilePath, "."+lang) {
				results[i].Score *= 1.2
			}
		}

		// Example: boost results from specific paths
		if pathPrefix, ok := filters["path_prefix"]; ok {
			if strings.HasPrefix(results[i].FilePath, pathPrefix) {
				results[i].Score *= 1.3
			}
		}
	}

	// Re-sort after boosting
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}
```

### src/Backend/internal/retriever/reranker.go
```
package retriever

import (
	"context"
	"sort"
	"strings"
)

// RankedCandidate represents a scored candidate for ranking
type RankedCandidate struct {
	ID           string
	Score        float32
	OriginalRank int
	Metadata     map[string]interface{}
}

// CandidateReranker scores and ranks RankedCandidate items
type CandidateReranker interface {
	Rerank(ctx context.Context, query string, candidates []RankedCandidate) ([]RankedCandidate, error)
}

// Reranker reranks SearchResult items in the pipeline (Stage 5)
type Reranker interface {
	Rerank(ctx context.Context, query string, candidates []SearchResult) ([]SearchResult, error)
}

// SimpleReranker implements a basic TF-IDF style reranking
type SimpleReranker struct {
	minConfidence float32
}

// NewSimpleReranker creates a simple reranker
func NewSimpleReranker(minConfidence float32) *SimpleReranker {
	if minConfidence < 0 || minConfidence > 1 {
		minConfidence = 0.5
	}
	return &SimpleReranker{
		minConfidence: minConfidence,
	}
}

// Rerank reranks candidates by relevance score
func (r *SimpleReranker) Rerank(ctx context.Context, query string, candidates []RankedCandidate) ([]RankedCandidate, error) {
	if len(candidates) == 0 {
		return candidates, nil
	}

	// Score each candidate based on relevance
	scored := make([]RankedCandidate, 0, len(candidates))
	for _, cand := range candidates {
		score := r.calculateRelevance(query, cand)
		if score >= r.minConfidence {
			cand.Score = score
			scored = append(scored, cand)
		}
	}

	// Sort by score descending
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].Score > scored[j].Score
	})

	return scored, nil
}

// calculateRelevance calculates relevance score based on keyword overlap
func (r *SimpleReranker) calculateRelevance(query string, candidate RankedCandidate) float32 {
	// Extract keywords from candidate metadata
	keywords := r.extractKeywords(candidate.Metadata)

	// Calculate TF-IDF-like score
	score := float32(0)
	for _, kw := range keywords {
		if strings.Contains(query, kw) {
			score += 0.1 // Keyword match boost
		}
	}

	// Normalize by number of keywords
	if len(keywords) > 0 {
		score = (score / float32(len(keywords))) + 0.5 // Base score
	} else {
		score = 0.5
	}

	return minScore(score, 1.0)
}

// extractKeywords extracts potential keywords from metadata
func (r *SimpleReranker) extractKeywords(metadata map[string]interface{}) []string {
	keywords := []string{}

	if name, ok := metadata["name"].(string); ok && name != "" {
		keywords = append(keywords, name)
	}

	if kind, ok := metadata["kind"].(string); ok && kind != "" {
		keywords = append(keywords, kind)
	}

	if summary, ok := metadata["summary"].(string); ok && summary != "" {
		// Extract first few words
		words := split(summary, 3)
		keywords = append(keywords, words...)
	}

	return keywords
}

// PipelineReranker wraps a CandidateReranker to work with SearchResult objects
// using the combined score formula: rerank*0.6 + vector*0.3 + graph*0.1
type PipelineReranker struct {
	base CandidateReranker
}

// NewPipelineReranker creates a PipelineReranker wrapping a CandidateReranker
func NewPipelineReranker(base CandidateReranker) *PipelineReranker {
	return &PipelineReranker{base: base}
}

// Rerank reranks SearchResult items using the base reranker and score formula
func (pr *PipelineReranker) Rerank(ctx context.Context, query string, candidates []SearchResult) ([]SearchResult, error) {
	if len(candidates) == 0 {
		return candidates, nil
	}

	// Convert SearchResult to RankedCandidate for the base reranker
	rankedCandidates := make([]RankedCandidate, 0, len(candidates))
	for _, c := range candidates {
		rc := RankedCandidate{
			ID:           c.StableKey,
			Score:        float32(c.Score),
			OriginalRank: 0,
			Metadata:     c.Metadata,
		}
		if c.Metadata == nil {
			rc.Metadata = make(map[string]interface{})
		}
		rankedCandidates = append(rankedCandidates, rc)
	}

	// Run through the base reranker
	reranked, err := pr.base.Rerank(ctx, query, rankedCandidates)
	if err != nil {
		return nil, err
	}

	// Build lookup map for reranker scores
	rerankScores := make(map[string]float32)
	for _, rc := range reranked {
		rerankScores[rc.ID] = rc.Score
	}

	// Apply FinalScore formula: rerank*0.6 + vector*0.3 + graph*0.1
	// Graph score is 0 if not available
	results := make([]SearchResult, 0, len(candidates))
	for _, c := range candidates {
		rerankScore := rerankScores[c.StableKey]
		vectorScore := float32(c.Score)
		graphScore := float32(0)

		// Check for graph score in metadata
		if gs, ok := c.Metadata["graph_score"].(float64); ok {
			graphScore = float32(gs)
		}

		finalScore := rerankScore*0.6 + vectorScore*0.3 + graphScore*0.1
		c.Score = float64(finalScore)
		results = append(results, c)
	}

	// Sort by final score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results, nil
}

// Helper functions

func split(text string, maxWords int) []string {
	words := []string{}
	word := ""

	for _, ch := range text {
		if ch == ' ' || ch == '\n' || ch == '\t' {
			if len(word) > 0 {
				words = append(words, word)
				word = ""
				if len(words) >= maxWords {
					break
				}
			}
		} else {
			word += string(ch)
		}
	}

	if len(word) > 0 && len(words) < maxWords {
		words = append(words, word)
	}

	return words
}

func minScore(a, b float32) float32 {
	if a < b {
		return a
	}
	return b
}
```

### src/Backend/internal/retriever/retriever.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/dungpd4/rad-system/internal/llm"
	"github.com/dungpd4/rad-system/internal/metadata"
	"github.com/dungpd4/rad-system/internal/vectordb"
)

// Retriever provides hybrid search functionality
type Retriever interface {
	Search(ctx context.Context, req SearchRequest) (*SearchResponse, error)
}

// HybridRetriever implements Retriever with vector search + graph traversal
type HybridRetriever struct {
	db             metadata.DB
	vectorDB       vectordb.Client
	llmRuntime     llm.Runtime
	embedModelID   string
	vectorSearch   *VectorSearcher
	graphTraversal *GraphExpander
	ranker         *Ranker
	logger         *slog.Logger

	// New pipeline components (TASK-03, TASK-09)
	reranker       Reranker
	intentDetector IntentDetector
	metadataFilter MetadataFilter
	hydrator       Hydrator
	contextPacker  *ContextPacker
}

// Config holds retriever configuration
type Config struct {
	DB           metadata.DB
	VectorDB     vectordb.Client
	LLMRuntime   llm.Runtime
	EmbedModelID string
	Logger       *slog.Logger

	// Pipeline configuration
	RerankEnabled       bool    // Enable Stage 5 reranker (default: false)
	TokenBudget         int     // Default token budget (default: 12000)
	KnowledgeDir        string  // Path to knowledge docs directory
	MinQuality          float32 // Minimum quality score filter (default: 0.75)
	FullPipelineEnabled bool    // Enable full 7-stage pipeline (default: false)
}

// NewHybridRetriever creates a new hybrid retriever
func NewHybridRetriever(config Config) (*HybridRetriever, error) {
	if config.DB == nil {
		return nil, fmt.Errorf("metadata DB is required")
	}
	if config.VectorDB == nil {
		return nil, fmt.Errorf("vector DB is required")
	}
	if config.LLMRuntime == nil {
		return nil, fmt.Errorf("LLM runtime is required")
	}
	if config.EmbedModelID == "" {
		config.EmbedModelID = "text-embedding-3-small"
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	if config.TokenBudget <= 0 {
		config.TokenBudget = 12000
	}
	if config.MinQuality <= 0 {
		config.MinQuality = 0.75
	}

	vectorSearch := NewVectorSearcher(VectorSearchConfig{
		VectorDB:     config.VectorDB,
		DB:           config.DB,
		LLMRuntime:   config.LLMRuntime,
		EmbedModelID: config.EmbedModelID,
		Logger:       config.Logger,
	})

	graphExpander := NewGraphExpander(2, 50)

	ranker := NewRanker(RankerConfig{
		Logger: config.Logger,
	})

	r := &HybridRetriever{
		db:             config.DB,
		vectorDB:       config.VectorDB,
		llmRuntime:     config.LLMRuntime,
		embedModelID:   config.EmbedModelID,
		vectorSearch:   vectorSearch,
		graphTraversal: graphExpander,
		ranker:         ranker,
		logger:         config.Logger,
	}

	// Initialize pipeline components if full pipeline is enabled
	if config.FullPipelineEnabled {
		r.intentDetector = NewRuleBasedIntentDetector()
		r.metadataFilter = NewSQLiteMetadataFilter(config.DB)
		r.hydrator = NewDefaultHydrator(config.KnowledgeDir, config.DB, config.Logger)
		r.contextPacker = NewContextPacker(config.TokenBudget, config.Logger)

		if config.RerankEnabled {
			// Wrap the existing SimpleReranker as a PipelineReranker
			baseReranker := NewSimpleReranker(0.5)
			r.reranker = NewPipelineReranker(baseReranker)
		}

		// Set metadata filter configuration
		if mf, ok := r.metadataFilter.(*SQLiteMetadataFilter); ok {
			mf.SetMinQuality(config.MinQuality)
		}
	}

	return r, nil
}

// Search performs hybrid search
func (r *HybridRetriever) Search(ctx context.Context, req SearchRequest) (*SearchResponse, error) {
	startTime := time.Now()

	// Validate request
	if err := r.validateRequest(req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// If full pipeline is enabled, use the 7-stage pipeline
	if r.intentDetector != nil && r.metadataFilter != nil {
		return r.searchFullPipeline(ctx, req, startTime)
	}

	// ── Legacy Path (backward compatible) ──────────────────────
	r.logger.Info("Starting hybrid search (legacy)",
		"query", req.QueryText,
		"top_k", req.TopK,
		"repo_id", req.RepoID,
		"expand_graph", req.ExpandGraph,
	)

	// Step 1: Vector search
	vectorResults, err := r.vectorSearch.Search(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("vector search failed: %w", err)
	}

	r.logger.Info("Vector search completed", "results", len(vectorResults))

	// Convert to SearchResults
	results := make([]SearchResult, 0, len(vectorResults))
	errorCount := 0
	for _, vr := range vectorResults {
		result, err := r.buildSearchResult(ctx, vr, req.RepoID, req.Epoch)
		if err != nil {
			r.logger.Debug("Failed to build search result", "error", err, "vector_key", vr.VectorKey, "stable_key", vr.StableKey, "item_type", vr.ItemType)
			errorCount++
			continue
		}
		r.logger.Debug("Built search result", "stable_key", result.StableKey, "content_len", len(result.Content), "file_path", result.FilePath, "score", result.Score)
		results = append(results, result)
	}
	r.logger.Info("Search result conversion completed", "total_vectors", len(vectorResults), "converted", len(results), "failed", errorCount)

	// Step 2: Re-rank results
	if r.reranker != nil && r.configFromCtx().RerankEnabled {
		reranked, rerankErr := r.reranker.Rerank(ctx, req.QueryText, results)
		if rerankErr != nil {
			r.logger.Warn("Reranker failed, falling back to ranker", "error", rerankErr)
			results = r.ranker.Rank(results, req)
		} else {
			results = reranked
		}
	} else {
		results = r.ranker.Rank(results, req)
	}

	// Limit to TopK
	if len(results) > req.TopK {
		results = results[:req.TopK]
	}

	processTime := time.Since(startTime)

	return &SearchResponse{
		Results:     results,
		TotalFound:  len(results),
		ProcessTime: processTime,
	}, nil
}

// searchFullPipeline executes the full 7-stage retrieval pipeline
func (r *HybridRetriever) searchFullPipeline(ctx context.Context, req SearchRequest, startTime time.Time) (*SearchResponse, error) {
	// Apply 2-second timeout
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	var timings StageTimings

	// ── Stage 1: Intent Detection ──────────────────────────────
	t1 := time.Now()
	intent, err := r.intentDetector.Detect(ctx, req.QueryText)
	if err != nil {
		return nil, fmt.Errorf("stage1 intent detection: %w", err)
	}

	// Allow TaskType override from request
	if req.TaskType != "" {
		if overrideIntent, err := ValidateSearchIntent(req.TaskType); err == nil {
			intent.Intent = overrideIntent
			intent.Confidence = 1.0
		}
	}

	timings.Stage1Ms = time.Since(t1).Milliseconds()
	r.logger.InfoContext(ctx, "stage1_intent",
		"intent", intent.Intent,
		"domain", intent.DomainHint,
		"confidence", intent.Confidence,
		"ms", timings.Stage1Ms,
	)

	// ── Stage 2: Metadata Filter ──────────────────────────────
	t2 := time.Now()
	activeEpoch := req.Epoch
	if activeEpoch <= 0 {
		activeEpoch = r.getActiveEpoch(ctx, req.RepoID)
	}

	symbolKeys, err := r.metadataFilter.Filter(ctx, intent, req.RepoID, activeEpoch)
	if err != nil {
		r.logger.Warn("Stage 2 metadata filter failed, continuing with empty keys", "error", err)
		symbolKeys = nil
	}

	timings.Stage2Ms = time.Since(t2).Milliseconds()
	r.logger.InfoContext(ctx, "stage2_filter",
		"symbols", len(symbolKeys),
		"ms", timings.Stage2Ms,
	)

	// ── Stage 3 + Stage 4: Concurrent ─────────────────────────
	t3 := time.Now()

	type s3result struct {
		hits []VectorSearchResult
		err  error
	}
	type s4result struct {
		nodes []ExpandedResult
		err   error
	}

	ch3 := make(chan s3result, 1)
	ch4 := make(chan s4result, 1)

	// Stage 3: Vector search
	go func() {
		hits, err := r.vectorSearch.Search(ctx, req)
		ch3 <- s3result{hits, err}
	}()

	// Stage 4: Graph expansion (no-op if no symbol keys)
	go func() {
		if len(symbolKeys) == 0 {
			ch4 <- s4result{nil, nil}
			return
		}
		seeds := symbolKeys
		if len(seeds) > 10 {
			seeds = seeds[:10]
		}
		depth := req.GraphDepth
		if depth <= 0 {
			depth = 1
		}
		// GraphExpander currently uses ExpandSymbols with GraphSymbol objects
		// Convert symbol keys to GraphSymbol objects for expansion
		graphSymbols := make([]GraphSymbol, 0, len(seeds))
		for _, key := range seeds {
			graphSymbols = append(graphSymbols, GraphSymbol{
				ID:            key,
				QualifiedName: key,
				Kind:          "unknown",
			})
		}
		nodes, err := r.graphTraversal.ExpandSymbols(ctx, graphSymbols)
		if err != nil {
			r.logger.Debug("Graph expansion returned no results or error", "error", err)
			ch4 <- s4result{nil, nil}
			return
		}
		ch4 <- s4result{nodes, nil}
	}()

	// Wait for both stages
	r3 := <-ch3
	r4 := <-ch4

	timings.Stage3Ms = time.Since(t3).Milliseconds()
	timings.Stage4Ms = time.Since(t3).Milliseconds() // approximate — they ran concurrently

	if r3.err != nil {
		return nil, fmt.Errorf("stage3 vector search: %w", r3.err)
	}

	// Merge vector results and graph results
	merged := r.mergeAndDedup(r3.hits, r4.nodes, req, activeEpoch)
	r.logger.InfoContext(ctx, "stage34_search",
		"vector", len(r3.hits),
		"graph", len(r4.nodes),
		"merged", len(merged),
		"ms", timings.Stage3Ms,
	)

	// ── Stage 5: Rerank ────────────────────────────────────────
	t5 := time.Now()
	var ranked []SearchResult
	if r.reranker != nil {
		var rerankErr error
		ranked, rerankErr = r.reranker.Rerank(ctx, req.QueryText, merged)
		if rerankErr != nil {
			r.logger.Warn("Stage 5 reranker failed, falling back to vector score sort", "error", rerankErr)
			ranked = r.ranker.Rank(merged, req)
		}
	} else {
		ranked = r.ranker.Rank(merged, req)
	}
	timings.Stage5Ms = time.Since(t5).Milliseconds()
	r.logger.InfoContext(ctx, "stage5_rerank",
		"candidates", len(merged),
		"ranked", len(ranked),
		"ms", timings.Stage5Ms,
	)

	// Limit to TopK
	if len(ranked) > req.TopK {
		ranked = ranked[:req.TopK]
	}

	// ── Stage 6: Hydration ─────────────────────────────────────
	t6 := time.Now()
	top5 := ranked
	if len(top5) > 5 {
		top5 = top5[:5]
	}
	hydrated, err := r.hydrator.Hydrate(ctx, top5, intent, activeEpoch)
	if err != nil {
		r.logger.Warn("Stage 6 hydration failed, proceeding without hydration", "error", err)
		hydrated = nil
	}
	timings.Stage6Ms = time.Since(t6).Milliseconds()
	r.logger.InfoContext(ctx, "stage6_hydrate",
		"hydrated", len(hydrated),
		"ms", timings.Stage6Ms,
	)

	// ── Stage 7: Context Packing ───────────────────────────────
	t7 := time.Now()
	budget := req.TokenBudget
	if budget <= 0 {
		budget = r.configFromCtx().TokenBudget
	}
	allocator := NewBudgetAllocator(budget, intent.Intent)

	// Build context items from hydrated results
	contextItems := make([]ContextItem, 0, len(hydrated))
	for _, hr := range hydrated {
		level := L3
		if hr.L4Loaded {
			level = L4
		}
		content := hr.L2Summary
		if len(hr.L3Facts) > 0 {
			content = strings.Join(hr.L3Facts, "; ")
		}
		if hr.KnowledgeDoc != "" {
			content = content + "\n" + hr.KnowledgeDoc
		}
		contextItems = append(contextItems, ContextItem{
			ID:      hr.StableKey,
			Level:   level,
			Content: content,
			Tokens:  hr.TokenCount,
		})
	}

	packed, err := r.contextPacker.PackContext(ctx, contextItems)
	if err != nil {
		r.logger.Warn("Stage 7 context packing failed", "error", err)
	}

	// Build token usage from allocator
	summary := allocator.Summary()
	usage := buildTokenUsage(intent.Intent, summary)
	logUsage(ctx, usage, budget)

	var llmCtx *LLMContext
	if packed != nil {
		// Build LLM context content
		contentParts := make([]string, 0, len(packed.Items))
		for _, item := range packed.Items {
			contentParts = append(contentParts, item.Content)
		}
		llmCtx = &LLMContext{
			Content:   strings.Join(contentParts, "\n\n"),
			TokenSize: packed.TotalTokens,
		}
	}

	timings.Stage7Ms = time.Since(t7).Milliseconds()
	r.logger.InfoContext(ctx, "stage7_pack",
		"tokens", usage.Total,
		"ms", timings.Stage7Ms,
	)

	totalMs := time.Since(startTime).Milliseconds()
	timings.TotalMs = totalMs
	r.logger.InfoContext(ctx, "search_complete",
		"total_ms", totalMs,
		"stages", []int64{timings.Stage1Ms, timings.Stage2Ms,
			timings.Stage3Ms, timings.Stage4Ms,
			timings.Stage5Ms, timings.Stage6Ms, timings.Stage7Ms},
	)

	return &SearchResponse{
		Results:      ranked,
		LLMContext:   llmCtx,
		TokenUsage:   &usage,
		StageTimings: &timings,
		TotalFound:   len(ranked),
		ProcessTime:  time.Since(startTime),
	}, nil
}

// mergeAndDedup merges vector search results with graph expansion results, dedup by symbol key
func (r *HybridRetriever) mergeAndDedup(vectorHits []VectorSearchResult, graphNodes []ExpandedResult, req SearchRequest, epoch int64) []SearchResult {
	seen := make(map[string]bool)
	results := make([]SearchResult, 0, len(vectorHits))

	// Add vector results first (they take priority)
	for _, vr := range vectorHits {
		if seen[vr.StableKey] {
			continue
		}
		seen[vr.StableKey] = true
		result, err := r.buildSearchResult(context.Background(), vr, req.RepoID, epoch)
		if err != nil {
			r.logger.Debug("Failed to build search result from vector hit", "error", err)
			continue
		}
		// Store vector score in metadata for reranking formula
		if result.Metadata == nil {
			result.Metadata = make(map[string]any)
		}
		result.Metadata["vector_score"] = result.Score
		results = append(results, result)
	}

	// Add graph expansion results not already present
	for _, gn := range graphNodes {
		if seen[gn.Symbol.ID] {
			continue
		}
		seen[gn.Symbol.ID] = true
		graphScore := float64(gn.Importance)
		result := SearchResult{
			Source:    "graph",
			StableKey: gn.Symbol.ID,
			Score:     graphScore,
			Content:   gn.Symbol.Summary,
			FilePath:  gn.Symbol.FilePath,
			Metadata: map[string]any{
				"graph_score": graphScore,
				"distance":    gn.Distance,
			},
		}
		results = append(results, result)
	}

	return results
}

// getActiveEpoch retrieves the active epoch for a repository
func (r *HybridRetriever) getActiveEpoch(ctx context.Context, repoID int64) int64 {
	repo, err := r.db.GetRepository(ctx, repoID)
	if err != nil || repo == nil {
		r.logger.Warn("Failed to get active epoch, using 0", "repo_id", repoID, "error", err)
		return 0
	}
	return repo.ActiveEpoch
}

// configFromCtx returns a Config-like structure from the existing HybridRetriever config
// This is a helper to access configuration values
func (r *HybridRetriever) configFromCtx() Config {
	return Config{
		DB:           r.db,
		VectorDB:     r.vectorDB,
		LLMRuntime:   r.llmRuntime,
		EmbedModelID: r.embedModelID,
		Logger:       r.logger,
	}
}

// validateRequest validates search request
func (r *HybridRetriever) validateRequest(req SearchRequest) error {
	if req.QueryText == "" {
		return fmt.Errorf("query text is required")
	}
	if req.TopK <= 0 {
		return fmt.Errorf("top_k must be positive")
	}
	if req.TopK > 100 {
		return fmt.Errorf("top_k cannot exceed 100")
	}
	if req.RepoID <= 0 {
		return fmt.Errorf("repo_id must be positive")
	}
	if req.Epoch < 0 {
		return fmt.Errorf("epoch cannot be negative")
	}
	if req.GraphDepth < 0 {
		req.GraphDepth = 2 // Default depth
	}
	if req.GraphDepth > 5 {
		return fmt.Errorf("graph_depth cannot exceed 5")
	}
	return nil
}

// buildSearchResult converts vector result to search result
func (r *HybridRetriever) buildSearchResult(ctx context.Context, vr VectorSearchResult, repoID, epoch int64) (SearchResult, error) {
	result := SearchResult{
		Source:    vr.ItemType,
		StableKey: vr.StableKey,
		Score:     vr.Score,
		Metadata:  make(map[string]any),
	}

	// Always set a default content to avoid empty results
	// Parse StableKey to extract readable content and file path
	displayContent, displayPath := r.parseStableKey(vr.StableKey, vr.ItemType)
	result.Content = displayContent
	result.FilePath = displayPath
	r.logger.Info("Initial parse", "stable_key", vr.StableKey, "content", displayContent, "file_path", displayPath)

	// Try to fetch metadata based on item type
	switch vr.ItemType {
	case "symbol":
		symbol, err := r.db.GetSymbol(ctx, repoID, epoch, vr.StableKey)
		if err != nil {
			r.logger.Debug("GetSymbol failed", "stable_key", vr.StableKey, "error", err)
			result.Metadata["symbol_key"] = vr.StableKey
			result.Metadata["fetch_error"] = err.Error()
			return result, nil
		}
		if symbol == nil {
			r.logger.Debug("Symbol not found", "stable_key", vr.StableKey)
			result.Metadata["symbol_key"] = vr.StableKey
			return result, nil
		}

		// Get file path
		file, err := r.db.GetFileByID(ctx, symbol.FileID)
		if err != nil {
			r.logger.Debug("GetFileByID failed", "file_id", symbol.FileID, "error", err)
			result.Content = fmt.Sprintf("%s\n%s", symbol.Name, symbol.Signature)
			result.StartLine = symbol.StartLine
			result.EndLine = symbol.EndLine
			result.Metadata["kind"] = symbol.Kind
			result.Metadata["visibility"] = symbol.Visibility
			result.Metadata["file_fetch_error"] = err.Error()
			return result, nil
		}

		result.Content = fmt.Sprintf("%s\n%s", symbol.Name, symbol.Signature)
		result.FilePath = file.Path
		result.StartLine = symbol.StartLine
		result.EndLine = symbol.EndLine
		result.Metadata["kind"] = symbol.Kind
		result.Metadata["visibility"] = symbol.Visibility

	case "chunk", "doc_chunk":
		chunk, err := r.db.GetChunk(ctx, repoID, epoch, vr.StableKey)
		if err != nil {
			r.logger.Debug("GetChunk failed", "stable_key", vr.StableKey, "error", err)
			result.Metadata["chunk_key"] = vr.StableKey
			result.Metadata["fetch_error"] = err.Error()
			return result, nil
		}
		if chunk == nil {
			r.logger.Debug("Chunk not found", "stable_key", vr.StableKey)
			result.Metadata["chunk_key"] = vr.StableKey
			return result, nil
		}

		result.Content = chunk.Text
		result.FilePath = chunk.DocPath
		result.Metadata["heading_path"] = chunk.HeadingPath

	default:
		r.logger.Warn("Unknown item type", "item_type", vr.ItemType)
		result.Metadata["item_type"] = vr.ItemType
	}

	return result, nil
}

// parseStableKey extracts readable content and file path from a StableKey
func (r *HybridRetriever) parseStableKey(stableKey, itemType string) (content, filePath string) {
	// For doc_chunk: ".claude/skills/speckit-clarify/SKILL.md:chunk:0"
	// For symbol: "com.example.Class.method"
	// For relation: "com.example.A->com.example.B"

	content = stableKey // Default fallback

	switch itemType {
	case "doc_chunk":
		// Extract file path and chunk index
		// Format: "path/to/file.md:chunk:0"
		parts := strings.Split(stableKey, ":")
		if len(parts) >= 1 {
			filePath = parts[0]
			if len(parts) >= 3 {
				content = fmt.Sprintf("[Chunk %s] %s", parts[2], filePath)
			} else {
				content = fmt.Sprintf("[Chunk] %s", filePath)
			}
		}

	case "symbol":
		// Extract qualified name
		// Keep as-is for now, will be enhanced by DB lookup
		filePath = stableKey
		content = stableKey

	case "relation":
		// Extract source and target
		// Keep as-is for now
		filePath = stableKey
		content = stableKey

	default:
		filePath = stableKey
		content = stableKey
	}

	return content, filePath
}
```

### src/Backend/internal/retriever/testhelpers.go
```
package retriever

// SetHydrator replaces the hydrator used by the pipeline.
// This is intentionally exported so integration tests can inject
// a mock Hydrator without touching the production NewHybridRetriever path.
func (r *HybridRetriever) SetHydrator(h Hydrator) {
	r.hydrator = h
}

// SetIntentDetector replaces the intent detector (for testing).
func (r *HybridRetriever) SetIntentDetector(d IntentDetector) {
	r.intentDetector = d
}

// SetMetadataFilter replaces the metadata filter (for testing).
func (r *HybridRetriever) SetMetadataFilter(f MetadataFilter) {
	r.metadataFilter = f
}

// SetReranker replaces the reranker (for testing).
func (r *HybridRetriever) SetReranker(rr Reranker) {
	r.reranker = rr
}
```

### src/Backend/internal/retriever/vector.go
```
package retriever

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/dungpd4/rad-system/internal/llm"
	"github.com/dungpd4/rad-system/internal/metadata"
	"github.com/dungpd4/rad-system/internal/vectordb"
)

// VectorSearcher performs vector similarity search
type VectorSearcher struct {
	vectorDB     vectordb.Client
	db           metadata.DB
	llmRuntime   llm.Runtime
	embedModelID string
	logger       *slog.Logger
}

// VectorSearchConfig configures vector searcher
type VectorSearchConfig struct {
	VectorDB     vectordb.Client
	DB           metadata.DB
	LLMRuntime   llm.Runtime
	EmbedModelID string
	Logger       *slog.Logger
}

// NewVectorSearcher creates a new vector searcher
func NewVectorSearcher(config VectorSearchConfig) *VectorSearcher {
	return &VectorSearcher{
		vectorDB:     config.VectorDB,
		db:           config.DB,
		llmRuntime:   config.LLMRuntime,
		embedModelID: config.EmbedModelID,
		logger:       config.Logger,
	}
}

// Search performs vector similarity search
func (vs *VectorSearcher) Search(ctx context.Context, req SearchRequest) ([]VectorSearchResult, error) {
	// Step 1: Convert query text to embedding
	vs.logger.Info("Generating query embedding", "query", req.QueryText)
	embeddings, err := vs.llmRuntime.Embed(ctx, []string{req.QueryText}, vs.embedModelID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}
	if len(embeddings) == 0 {
		return nil, fmt.Errorf("no embedding generated")
	}

	queryVector := embeddings[0]

	// Step 2: Build filters
	filters := make(map[string]string)
	filters["repo_id"] = fmt.Sprintf("%d", req.RepoID)
	filters["epoch"] = fmt.Sprintf("%d", req.Epoch)
	filters["embed_model_id"] = vs.embedModelID

	// Apply user-provided filters
	for k, v := range req.Filters {
		filters[k] = v
	}

	// Step 3: Search vector DB
	vs.logger.Info("Searching vector database",
		"top_k", req.TopK,
		"filters", filters,
	)

	searchReq := vectordb.SearchRequest{
		QueryVector:  queryVector,
		TopK:         req.TopK * 2, // Get more results for re-ranking
		RepoID:       req.RepoID,
		Epoch:        req.Epoch,
		EmbedModelID: vs.embedModelID,
		Filters:      filters,
	}

	searchResults, err := vs.vectorDB.Search(ctx, searchReq)
	if err != nil {
		return nil, fmt.Errorf("vector search failed: %w", err)
	}

	vs.logger.Info("Vector search completed", "results", len(searchResults))

	// Step 4: Convert to internal format
	results := make([]VectorSearchResult, 0, len(searchResults))
	for _, sr := range searchResults {
		// Parse stable_key and item_type from record
		result := VectorSearchResult{
			VectorKey:   sr.VectorKey,
			StableKey:   sr.Record.StableKey,
			Score:       float64(sr.Score),
			ItemType:    sr.Record.ItemType,
			ContentHash: sr.Record.ContentHash,
		}
		results = append(results, result)
	}

	return results, nil
}

// SearchByVector performs vector search with pre-computed embedding
func (vs *VectorSearcher) SearchByVector(ctx context.Context, queryVector []float32, topK int, filters map[string]string) ([]VectorSearchResult, error) {
	searchReq := vectordb.SearchRequest{
		QueryVector: queryVector,
		TopK:        topK,
		Filters:     filters,
	}

	searchResults, err := vs.vectorDB.Search(ctx, searchReq)
	if err != nil {
		return nil, fmt.Errorf("vector search failed: %w", err)
	}

	results := make([]VectorSearchResult, 0, len(searchResults))
	for _, sr := range searchResults {
		result := VectorSearchResult{
			VectorKey:   sr.VectorKey,
			StableKey:   sr.Record.StableKey,
			Score:       float64(sr.Score),
			ItemType:    sr.Record.ItemType,
			ContentHash: sr.Record.ContentHash,
		}
		results = append(results, result)
	}

	return results, nil
}
```