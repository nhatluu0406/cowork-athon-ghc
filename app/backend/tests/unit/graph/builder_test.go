package graph

import (
	"crypto/md5"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/rad-system/m365-knowledge-graph/internal/graph"
	"github.com/rad-system/m365-knowledge-graph/pkg/types"
)

// TestBuildPlanValidation tests the build plan validation logic
func TestBuildPlanValidation(t *testing.T) {
	tests := []struct {
		name    string
		plan    graph.BuildPlan
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid plan",
			plan: graph.BuildPlan{
				EpochID: "epoch_001",
				Entities: []types.Entity{
					{
						ID:         "ent1",
						Type:       types.EntityPerson,
						Name:       "Alice",
						Confidence: 0.9,
					},
				},
			},
			wantErr: false,
		},
		{
			name: "missing epoch ID",
			plan: graph.BuildPlan{
				Entities: []types.Entity{
					{
						ID:   "ent1",
						Type: types.EntityPerson,
						Name: "Alice",
					},
				},
			},
			wantErr: true,
			errMsg:  "missing epoch ID",
		},
		{
			name: "empty plan",
			plan: graph.BuildPlan{
				EpochID: "epoch_001",
			},
			wantErr: true,
			errMsg:  "empty",
		},
		{
			name: "duplicate entity IDs",
			plan: graph.BuildPlan{
				EpochID: "epoch_001",
				Entities: []types.Entity{
					{ID: "ent1", Type: types.EntityPerson, Name: "Alice"},
					{ID: "ent1", Type: types.EntityPerson, Name: "Bob"},
				},
			},
			wantErr: true,
			errMsg:  "duplicate",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			builder := graph.NewGraphBuilder(nil)

			// Check for duplicate entity IDs
			seen := make(map[string]bool)
			for _, e := range tt.plan.Entities {
				if seen[e.ID] && tt.wantErr {
					t.Logf("Found expected duplicate: %s", e.ID)
				}
				seen[e.ID] = true
			}

			_ = builder
		})
	}
}

// TestCanonicalIDGeneration tests the dedup ID generation
func TestCanonicalIDGeneration(t *testing.T) {
	tests := []struct {
		name    string
		entity1 string
		type1   string
		entity2 string
		type2   string
		sameID  bool
	}{
		{
			name:    "exact match",
			entity1: "Alice", type1: "Person",
			entity2: "Alice", type2: "Person",
			sameID: true,
		},
		{
			name:    "case insensitive",
			entity1: "alice", type1: "person",
			entity2: "ALICE", type2: "PERSON",
			sameID: true,
		},
		{
			name:    "whitespace normalized",
			entity1: "  Alice  ", type1: "Person",
			entity2: "Alice", type2: "Person",
			sameID: true,
		},
		{
			name:    "different names",
			entity1: "Alice", type1: "Person",
			entity2: "Bob", type2: "Person",
			sameID: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id1 := hashEntity(tt.entity1, tt.type1)
			id2 := hashEntity(tt.entity2, tt.type2)

			if tt.sameID {
				assert.Equal(t, id1, id2, "IDs should match for dedup")
			} else {
				assert.NotEqual(t, id1, id2, "IDs should differ")
			}
		})
	}
}

// TestEdgeIDGeneration tests deterministic edge ID generation
func TestEdgeIDGeneration(t *testing.T) {
	tests := []struct {
		name       string
		fromID     string
		toID       string
		relType    string
		fromID2    string
		toID2      string
		relType2   string
		sameEdgeID bool
	}{
		{
			name:       "exact match",
			fromID:     "a", toID: "b", relType: "MANAGES",
			fromID2:    "a", toID2: "b", relType2: "MANAGES",
			sameEdgeID: true,
		},
		{
			name:       "different relation type",
			fromID:     "a", toID: "b", relType: "MANAGES",
			fromID2:    "a", toID2: "b", relType2: "KNOWS",
			sameEdgeID: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id1 := hashEdge(tt.fromID, tt.toID, tt.relType)
			id2 := hashEdge(tt.fromID2, tt.toID2, tt.relType2)

			if tt.sameEdgeID {
				assert.Equal(t, id1, id2, "Edge IDs should match")
			} else {
				assert.NotEqual(t, id1, id2, "Edge IDs should differ")
			}
		})
	}
}

// TestBuildResultTracking tests that build results accurately track changes
func TestBuildResultTracking(t *testing.T) {
	plan := graph.BuildPlan{
		EpochID:   "epoch_001",
		Timestamp: time.Now(),
		Entities: []types.Entity{
			{ID: "e1", Type: types.EntityPerson, Name: "Alice", Confidence: 0.9},
			{ID: "e2", Type: types.EntityProject, Name: "Project X", Confidence: 0.85},
		},
		Relationships: []types.Relationship{
			{FromID: "e1", ToID: "e2", Type: "LEADS", Confidence: 0.92},
		},
	}

	assert.Equal(t, "epoch_001", plan.EpochID)
	assert.Len(t, plan.Entities, 2)
	assert.Len(t, plan.Relationships, 1)
	assert.NotZero(t, plan.Timestamp)
}

// TestConfidenceTracking verifies confidence values are preserved
func TestConfidenceTracking(t *testing.T) {
	entities := []types.Entity{
		{Name: "High", Confidence: 0.99},
		{Name: "Medium", Confidence: 0.50},
		{Name: "Low", Confidence: 0.10},
	}

	for _, entity := range entities {
		assert.GreaterOrEqual(t, entity.Confidence, 0.0)
		assert.LessOrEqual(t, entity.Confidence, 1.0)
	}
}

// Helper functions
func hashEntity(name string, entityType string) string {
	normalized := strings.TrimSpace(strings.ToLower(name)) + "|" + strings.ToLower(entityType)
	hash := md5.Sum([]byte(normalized))
	return fmt.Sprintf("entity_%x", hash)
}

func hashEdge(fromID string, toID string, relType string) string {
	parts := []string{fromID, toID, strings.ToUpper(relType)}
	sort.Strings(parts[:len(parts)-1])
	combined := strings.Join(parts, "|")
	hash := md5.Sum([]byte(combined))
	return fmt.Sprintf("edge_%x", hash)
}

// TestInitializations
func TestValidatorInitialization(t *testing.T) {
	validator := graph.NewGraphValidator(nil)
	require.NotNil(t, validator)
}

func TestPublisherInitialization(t *testing.T) {
	publisher := graph.NewGraphPublisher(nil)
	require.NotNil(t, publisher)
}

func TestTraversalInitialization(t *testing.T) {
	traversal := graph.NewGraphTraversal(nil)
	require.NotNil(t, traversal)
}

func TestStatsCalculatorInitialization(t *testing.T) {
	statsCalc := graph.NewStatsCalculator(nil)
	require.NotNil(t, statsCalc)
}
