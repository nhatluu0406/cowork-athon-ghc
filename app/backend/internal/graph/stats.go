package graph

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// GraphStats represents comprehensive statistics about the knowledge graph
type GraphStats struct {
	TotalNodes              int64                  `json:"total_nodes"`
	TotalEdges              int64                  `json:"total_edges"`
	NodesByType             map[string]int64       `json:"nodes_by_type"`
	EdgesByType             map[string]int64       `json:"edges_by_type"`
	AvgDegree               float64                `json:"avg_degree"`
	MaxDegree               int64                  `json:"max_degree"`
	MinDegree               int64                  `json:"min_degree"`
	GraphDensity            float64                `json:"graph_density"`
	AverageConfidence       float64                `json:"average_confidence"`
	ConnectedComponents     int64                  `json:"connected_components"`
	Timestamp               time.Time              `json:"timestamp"`
	NodeTypeStats           map[string]TypeStats   `json:"node_type_stats,omitempty"`
	EdgeTypeStats           map[string]TypeStats   `json:"edge_type_stats,omitempty"`
}

// TypeStats represents statistics for a specific node or edge type
type TypeStats struct {
	Count         int64   `json:"count"`
	AvgDegree     float64 `json:"avg_degree"`
	MaxDegree     int64   `json:"max_degree"`
	MinDegree     int64   `json:"min_degree"`
	AvgConfidence float64 `json:"avg_confidence"`
}

// StatsCalculator computes comprehensive graph statistics
type StatsCalculator struct {
	store *Neo4jStore
}

// NewStatsCalculator creates a new stats calculator
func NewStatsCalculator(store *Neo4jStore) *StatsCalculator {
	return &StatsCalculator{store: store}
}

// GetStats computes comprehensive statistics about the graph.
// This includes:
// - Node and edge counts by type
// - Degree statistics (avg, min, max)
// - Graph density
// - Average confidence scores
// - Per-type statistics for detailed analysis
//
// Runs multiple parallel queries for efficiency.
func (sc *StatsCalculator) GetStats(ctx context.Context) (*GraphStats, error) {
	stats := &GraphStats{
		NodesByType:   make(map[string]int64),
		EdgesByType:   make(map[string]int64),
		NodeTypeStats: make(map[string]TypeStats),
		EdgeTypeStats: make(map[string]TypeStats),
		Timestamp:     time.Now(),
	}

	// Run expensive queries in parallel
	var wg sync.WaitGroup
	errChan := make(chan error, 10)

	// 1. Total nodes
	wg.Add(1)
	go func() {
		defer wg.Done()
		count, err := sc.countNodes(ctx)
		if err != nil {
			errChan <- fmt.Errorf("count nodes: %w", err)
		}
		stats.TotalNodes = count
	}()

	// 2. Total edges
	wg.Add(1)
	go func() {
		defer wg.Done()
		count, err := sc.countEdges(ctx)
		if err != nil {
			errChan <- fmt.Errorf("count edges: %w", err)
		}
		stats.TotalEdges = count
	}()

	// 3. Nodes by type
	wg.Add(1)
	go func() {
		defer wg.Done()
		counts, err := sc.countNodesByType(ctx)
		if err != nil {
			errChan <- fmt.Errorf("count nodes by type: %w", err)
		}
		stats.NodesByType = counts
	}()

	// 4. Edges by type
	wg.Add(1)
	go func() {
		defer wg.Done()
		counts, err := sc.countEdgesByType(ctx)
		if err != nil {
			errChan <- fmt.Errorf("count edges by type: %w", err)
		}
		stats.EdgesByType = counts
	}()

	// 5. Degree statistics
	wg.Add(1)
	go func() {
		defer wg.Done()
		avg, max, min, err := sc.getDegreeStats(ctx)
		if err != nil {
			errChan <- fmt.Errorf("degree stats: %w", err)
			return
		}
		stats.AvgDegree = avg
		stats.MaxDegree = max
		stats.MinDegree = min
	}()

	// 6. Confidence statistics
	wg.Add(1)
	go func() {
		defer wg.Done()
		avgConf, err := sc.getAverageConfidence(ctx)
		if err != nil {
			errChan <- fmt.Errorf("average confidence: %w", err)
		}
		stats.AverageConfidence = avgConf
	}()

	wg.Wait()
	close(errChan)

	// Check for errors
	for err := range errChan {
		slog.WarnContext(ctx, "stats calculation warning", "error", err)
		// Continue with partial stats rather than fail completely
	}

	// Compute derived statistics
	if stats.TotalNodes > 0 {
		stats.GraphDensity = float64(stats.TotalEdges*2) / (float64(stats.TotalNodes) * float64(stats.TotalNodes-1))
		if stats.GraphDensity > 1.0 {
			stats.GraphDensity = 1.0
		}
	}

	slog.InfoContext(ctx, "graph statistics computed",
		"total_nodes", stats.TotalNodes,
		"total_edges", stats.TotalEdges,
		"avg_degree", stats.AvgDegree,
		"density", stats.GraphDensity,
	)

	return stats, nil
}

// GetNodeTypeStats returns detailed statistics for a specific node type
func (sc *StatsCalculator) GetNodeTypeStats(ctx context.Context, nodeType string) (*TypeStats, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := fmt.Sprintf(`
			MATCH (n:%s)
			WITH count(n) as count,
				 max(size((n)-->())+size((n)<--()]) as maxDegree,
				 min(size((n)-->())+size((n)<--()]) as minDegree,
				 avg(size((n)-->())+size((n)<--()]) as avgDegree,
				 avg(COALESCE(n.confidence, 0.5)) as avgConfidence
			RETURN count, maxDegree, minDegree, avgDegree, avgConfidence
		`, nodeType)

		res, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			maxDeg, _ := record.Get("maxDegree")
			minDeg, _ := record.Get("minDegree")
			avgDeg, _ := record.Get("avgDegree")
			avgConf, _ := record.Get("avgConfidence")

			return &TypeStats{
				Count:         count.(int64),
				MaxDegree:     maxDeg.(int64),
				MinDegree:     minDeg.(int64),
				AvgDegree:     avgDeg.(float64),
				AvgConfidence: avgConf.(float64),
			}, nil
		}

		return &TypeStats{}, nil
	})

	if err != nil {
		return nil, fmt.Errorf("node type stats for %s: %w", nodeType, err)
	}

	return result.(*TypeStats), nil
}

// GetConfidenceDistribution returns a histogram of confidence scores
func (sc *StatsCalculator) GetConfidenceDistribution(ctx context.Context, buckets int) (map[string]int64, error) {
	if buckets < 1 {
		buckets = 10
	}

	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// Bucket confidence scores into histogram
		query := fmt.Sprintf(`
			MATCH (n)
			WHERE EXISTS(n.confidence)
			WITH n.confidence as conf
			WITH toInteger(conf * %d) as bucket, count(*) as count
			RETURN bucket, count
			ORDER BY bucket
		`, buckets)

		res, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		distribution := make(map[string]int64)
		for res.Next(ctx) {
			record := res.Record()
			bucket, _ := record.Get("bucket")
			count, _ := record.Get("count")

			label := fmt.Sprintf("%.1f-%d", float64(bucket.(int64))/float64(buckets), bucket)
			distribution[label] = count.(int64)
		}

		return distribution, nil
	})

	if err != nil {
		return nil, fmt.Errorf("confidence distribution: %w", err)
	}

	return result.(map[string]int64), nil
}

// GetLowConfidenceNodes returns entities below a confidence threshold
// Useful for identifying entities that need re-evaluation (feedback loop)
func (sc *StatsCalculator) GetLowConfidenceNodes(ctx context.Context, threshold float64, limit int) ([]map[string]interface{}, error) {
	if threshold < 0.0 || threshold > 1.0 {
		threshold = 0.5
	}
	if limit < 1 {
		limit = 100
	}

	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (n)
			WHERE n.confidence < $threshold
			RETURN
				n.id as id,
				n.name as name,
				labels(n) as labels,
				n.confidence as confidence,
				size((n)-->())+size((n)<--()) as degree
			ORDER BY n.confidence ASC
			LIMIT $limit
		`

		res, err := tx.Run(ctx, query, map[string]interface{}{
			"threshold": threshold,
			"limit":     int64(limit),
		})
		if err != nil {
			return nil, err
		}

		var results []map[string]interface{}
		for res.Next(ctx) {
			record := res.Record()
			id, _ := record.Get("id")
			name, _ := record.Get("name")
			labels, _ := record.Get("labels")
			confidence, _ := record.Get("confidence")
			degree, _ := record.Get("degree")

			nodeType := "Entity"
			if labelList, ok := labels.([]interface{}); ok && len(labelList) > 0 {
				nodeType = labelList[0].(string)
			}

			results = append(results, map[string]interface{}{
				"id":         id,
				"name":       name,
				"type":       nodeType,
				"confidence": confidence,
				"degree":     degree,
			})
		}

		return results, nil
	})

	if err != nil {
		return nil, fmt.Errorf("low confidence nodes: %w", err)
	}

	return result.([]map[string]interface{}), nil
}

// GetRelationshipTypeStats returns statistics for a specific relationship type
func (sc *StatsCalculator) GetRelationshipTypeStats(ctx context.Context, relType string) (*TypeStats, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := fmt.Sprintf(`
			MATCH ()-[r:%s]->()
			WITH count(r) as count,
				 avg(COALESCE(r.confidence, 0.5)) as avgConfidence
			RETURN count, avgConfidence
		`, relType)

		res, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			avgConf, _ := record.Get("avgConfidence")

			return &TypeStats{
				Count:         count.(int64),
				AvgConfidence: avgConf.(float64),
			}, nil
		}

		return &TypeStats{}, nil
	})

	if err != nil {
		return nil, fmt.Errorf("relationship type stats for %s: %w", relType, err)
	}

	return result.(*TypeStats), nil
}

// Helper methods

func (sc *StatsCalculator) countNodes(ctx context.Context) (int64, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, "MATCH (n) RETURN count(n) as count", nil)
		if err != nil {
			return nil, err
		}
		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			return count.(int64), nil
		}
		return int64(0), nil
	})

	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (sc *StatsCalculator) countEdges(ctx context.Context) (int64, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, "MATCH ()-[r]->() RETURN count(r) as count", nil)
		if err != nil {
			return nil, err
		}
		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			return count.(int64), nil
		}
		return int64(0), nil
	})

	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (sc *StatsCalculator) countNodesByType(ctx context.Context) (map[string]int64, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, `
			MATCH (n)
			WITH labels(n) as labels
			UNWIND labels as label
			RETURN label, count(*) as count
			ORDER BY count DESC
		`, nil)
		if err != nil {
			return nil, err
		}

		counts := make(map[string]int64)
		for res.Next(ctx) {
			record := res.Record()
			label, _ := record.Get("label")
			count, _ := record.Get("count")
			counts[label.(string)] = count.(int64)
		}
		return counts, nil
	})

	if err != nil {
		return nil, err
	}
	return result.(map[string]int64), nil
}

func (sc *StatsCalculator) countEdgesByType(ctx context.Context) (map[string]int64, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, `
			MATCH ()-[r]->()
			RETURN type(r) as type, count(*) as count
			ORDER BY count DESC
		`, nil)
		if err != nil {
			return nil, err
		}

		counts := make(map[string]int64)
		for res.Next(ctx) {
			record := res.Record()
			relType, _ := record.Get("type")
			count, _ := record.Get("count")
			counts[relType.(string)] = count.(int64)
		}
		return counts, nil
	})

	if err != nil {
		return nil, err
	}
	return result.(map[string]int64), nil
}

func (sc *StatsCalculator) getDegreeStats(ctx context.Context) (float64, int64, int64, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, `
			MATCH (n)
			WITH size((n)-->())+size((n)<--()) as degree
			RETURN
				avg(degree) as avg_degree,
				max(degree) as max_degree,
				min(degree) as min_degree
		`, nil)
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			avgDeg, _ := record.Get("avg_degree")
			maxDeg, _ := record.Get("max_degree")
			minDeg, _ := record.Get("min_degree")

			avg := 0.0
			if avgDeg != nil {
				avg = avgDeg.(float64)
			}

			max := int64(0)
			if maxDeg != nil {
				max = maxDeg.(int64)
			}

			min := int64(0)
			if minDeg != nil {
				min = minDeg.(int64)
			}

			return map[string]interface{}{
				"avg": avg,
				"max": max,
				"min": min,
			}, nil
		}

		return map[string]interface{}{
			"avg": 0.0,
			"max": int64(0),
			"min": int64(0),
		}, nil
	})

	if err != nil {
		return 0.0, 0, 0, err
	}

	res := result.(map[string]interface{})
	return res["avg"].(float64), res["max"].(int64), res["min"].(int64), nil
}

func (sc *StatsCalculator) getAverageConfidence(ctx context.Context) (float64, error) {
	session := sc.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, `
			MATCH (n)
			WHERE EXISTS(n.confidence)
			RETURN avg(n.confidence) as avg_confidence
		`, nil)
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			avgConf, _ := record.Get("avg_confidence")
			if avgConf == nil {
				return 0.0, nil
			}
			return avgConf.(float64), nil
		}

		return 0.0, nil
	})

	if err != nil {
		return 0.0, err
	}

	return result.(float64), nil
}
