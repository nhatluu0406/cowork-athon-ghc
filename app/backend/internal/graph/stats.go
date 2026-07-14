package graph

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type GraphStats struct {
	TotalNodes       int64
	TotalEdges       int64
	NodeCounts       map[string]int64
	AvgDegree        float64
	DensityPercentage float64
}

type StatsCalculator struct {
	driver neo4j.DriverWithContext
}

func NewStatsCalculator(driver neo4j.DriverWithContext) *StatsCalculator {
	return &StatsCalculator{driver: driver}
}

func (sc *StatsCalculator) GetStats(ctx context.Context) (*GraphStats, error) {
	session := sc.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	stats := &GraphStats{
		NodeCounts: make(map[string]int64),
	}

	totalNodesRes, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
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
		return nil, fmt.Errorf("GetStats total nodes: %w", err)
	}
	stats.TotalNodes = totalNodesRes.(int64)

	totalEdgesRes, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
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
		return nil, fmt.Errorf("GetStats total edges: %w", err)
	}
	stats.TotalEdges = totalEdgesRes.(int64)

	nodeCountsRes, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, `
			MATCH (n)
			WITH labels(n) as labels
			UNWIND labels as label
			RETURN label, count(*) as count
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
		return nil, fmt.Errorf("GetStats node counts: %w", err)
	}
	stats.NodeCounts = nodeCountsRes.(map[string]int64)

	if stats.TotalNodes > 0 {
		stats.AvgDegree = float64(stats.TotalEdges*2) / float64(stats.TotalNodes)
		maxPossibleEdges := stats.TotalNodes * (stats.TotalNodes - 1)
		if maxPossibleEdges > 0 {
			stats.DensityPercentage = (float64(stats.TotalEdges) / float64(maxPossibleEdges)) * 100
		}
	}

	return stats, nil
}

func (sc *StatsCalculator) GetNodeTypeStats(ctx context.Context, nodeType string) (map[string]interface{}, error) {
	session := sc.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	res, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := fmt.Sprintf(`
			MATCH (n:%s)
			WITH count(n) as count,
				 max(size((n)-->())+size((n)<--())] as maxDegree,
				 min(size((n)-->())+size((n)<--())] as minDegree,
				 avg(size((n)-->())+size((n)<--())] as avgDegree
			RETURN count, maxDegree, minDegree, avgDegree
		`, nodeType)

		result, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()
			count, _ := record.Get("count")
			maxDeg, _ := record.Get("maxDegree")
			minDeg, _ := record.Get("minDegree")
			avgDeg, _ := record.Get("avgDegree")

			return map[string]interface{}{
				"count":      count,
				"max_degree": maxDeg,
				"min_degree": minDeg,
				"avg_degree": avgDeg,
			}, nil
		}

		return map[string]interface{}{
			"count":      int64(0),
			"max_degree": 0,
			"min_degree": 0,
			"avg_degree": 0.0,
		}, nil
	})

	if err != nil {
		return nil, fmt.Errorf("GetNodeTypeStats: %w", err)
	}

	return res.(map[string]interface{}), nil
}
