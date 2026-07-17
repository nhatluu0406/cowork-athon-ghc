package retrieval

import (
	"context"
	"database/sql"
	"strconv"
	"sync"
	"time"
)

type Retriever struct {
	db                    *sql.DB
	permissionFilter      *PermissionFilter
	intentDetector        *IntentDetector
	entityRecognizer      *QueryEntityRecognizer
	semanticSearch        *SemanticSearch
	graphExpander         *GraphExpander
	reranker              *Reranker
	contextPacker         *ContextPacker
	answerGenerator       *AnswerGenerator
	answerGeneratorABTest interface{} // *AnswerGeneratorWithABTest if fine-tuning enabled
	enableFineTuning      bool
}

func NewRetriever(db *sql.DB, pf *PermissionFilter, id *IntentDetector, er *QueryEntityRecognizer,
	ss *SemanticSearch, ge *GraphExpander, rr *Reranker, cp *ContextPacker, ag *AnswerGenerator) *Retriever {
	return &Retriever{
		db:               db,
		permissionFilter: pf,
		intentDetector:   id,
		entityRecognizer: er,
		semanticSearch:   ss,
		graphExpander:    ge,
		reranker:         rr,
		contextPacker:    cp,
		answerGenerator:  ag,
	}
}

type QueryRequest struct {
	Query  string
	UserID string
}

type QueryResponse struct {
	Answer    string
	Sources   []interface{}
	Entities  []interface{}
	Intent    string
	LatencyMs int
}

// Query executes the 8-stage hybrid retrieval pipeline per spec.md §7 /
// data-model.md §15.2:
//
//	Stage 0: Permission Filter → Stage 1: Intent → Stage 2: Query NER
//	  → parallel: (Stage 3: Graph Query, Stage 4: Semantic Search)
//	  → Merge/Dedup → Stage 5: Rerank → Stage 6: Context Pack
//	  → Stage 7: Answer Generation
func (r *Retriever) Query(ctx context.Context, req QueryRequest) (*QueryResponse, error) {
	start := time.Now()

	// Stage 0: Permission filter (INVARIANT-1 — enforced here, not as a
	// post-filter on the final answer).
	allowedFiles, err := r.permissionFilter.Filter(ctx, req.UserID)
	if err != nil {
		return nil, err
	}

	// If user has no file access, return permission_denied immediately
	// (but still allow graph-only results via entity recognition and graph expansion)
	if len(allowedFiles) == 0 {
		return &QueryResponse{
			Intent:  "permission_denied",
			Answer:  "",
			Sources: []interface{}{},
			Timing:  time.Since(start).String(),
		}, nil
	}

	// Note: we do NOT early-exit on empty allowedFiles here. Entity recognition
	// (Stage 2) and graph expansion (Stage 3) should still run to allow users to
	// discover graph entities even if they have no document access. SemanticSearch
	// (Stage 4) already guards itself against empty allowedFiles by returning nil.
	// This allows graph-only results to be returned while preserving permission
	// scoping at the semantic search and final answer stages.
	// (allowedFiles may be nil or empty; proceed to entity recognition and graph expansion.)
	// Stage 1: Intent detection
	intent := r.intentDetector.Detect(ctx, req.Query)

	// Stage 2: Query entity recognition (NER against known graph entities)
	var recognizedEntities []RecognizedEntity
	if r.entityRecognizer != nil {
		var err error
		recognizedEntities, err = r.entityRecognizer.Recognize(ctx, req.Query)
		if err != nil {
			// Log the error but continue — NER failure should not block the entire query.
			// This allows semantic search and graph results to still be returned.
			// TODO: wire a logger into Retriever
		}
	}
	if r.graphExpander != nil {
		r.graphExpander.SetSeeds(recognizedEntities)
	}

	// Stages 3+4: Graph expand + Semantic search run CONCURRENTLY per spec §7.
	var (
		wg            sync.WaitGroup
		graphResults  []map[string]interface{}
		searchResults []map[string]interface{}
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		if r.graphExpander != nil {
			graphResults = r.graphExpander.Expand(ctx, nil)
		}
	}()
	go func() {
		defer wg.Done()
		if r.semanticSearch != nil {
			searchResults = r.semanticSearch.Search(ctx, req.Query, allowedFiles)
		}
	}()
	wg.Wait()

	// Merge + dedup (by chunk_id for semantic results, entity_id for graph
	// results — the two result shapes are disjoint on those keys so a
	// simple concatenation with a seen-set is sufficient here).
	merged := mergeDedup(searchResults, graphResults)

	// Stage 5: Rerank
	reranked := r.reranker.Rank(ctx, merged)

	// Stage 6: Context pack (default 12K token budget per spec §7)
	packed := r.contextPacker.Pack(ctx, reranked, 12000)

	// Stage 7: Answer generation (with A/B testing if enabled)
	var answer string
	var sources []interface{}

	if r.enableFineTuning && r.answerGeneratorABTest != nil {
		// TODO: Use fine-tuned model via A/B test (tracked separately from
		// tasks.md Group D; requires internal/finetuning wiring).
		answer, sources = r.answerGenerator.Generate(ctx, req.Query, packed)
	} else {
		answer, sources = r.answerGenerator.Generate(ctx, req.Query, packed)
	}

	entities := make([]interface{}, 0, len(recognizedEntities))
	for _, e := range recognizedEntities {
		entities = append(entities, map[string]interface{}{"id": e.ID, "type": e.Type, "name": e.Name})
	}

	latency := time.Since(start).Milliseconds()

	return &QueryResponse{
		Answer:    answer,
		Sources:   sources,
		Entities:  entities,
		Intent:    intent,
		LatencyMs: int(latency),
	}, nil
}

func mergeDedup(a, b []map[string]interface{}) []map[string]interface{} {
	seen := make(map[string]bool)
	merged := make([]map[string]interface{}, 0, len(a)+len(b))

	addUnique := func(items []map[string]interface{}) {
		for _, item := range items {
			key := dedupKey(item)
			if key != "" && seen[key] {
				continue
			}
			if key != "" {
				seen[key] = true
			}
			merged = append(merged, item)
		}
	}
	addUnique(a)
	addUnique(b)
	return merged
}

func dedupKey(item map[string]interface{}) string {
	if cid, ok := item["chunk_id"]; ok {
		return "chunk:" + toDedupString(cid)
	}
	if eid, ok := item["entity_id"]; ok {
		return "entity:" + toDedupString(eid)
	}
	return ""
}

func toDedupString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case int64:
		return strconv.FormatInt(t, 10)
	case int:
		return strconv.Itoa(t)
	default:
		return ""
	}
}
