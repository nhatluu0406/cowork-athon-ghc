package types

import "time"

// FeedbackRequest represents user feedback on a query result
type FeedbackRequest struct {
	QueryID      int    `json:"query_id"`
	UserID       string `json:"user_id"`
	FeedbackType FeedbackType `json:"feedback_type"`
	Comment      string `json:"comment,omitempty"`
	Rating       int    `json:"rating,omitempty"` // 1-5 star rating
	FlaggedEntityID string `json:"flagged_entity_id,omitempty"` // If flagging an entity
	FlaggedSourceID int `json:"flagged_source_id,omitempty"` // If flagging a source
}

// FeedbackResponse represents stored feedback
type FeedbackResponse struct {
	ID         int          `json:"id"`
	QueryID    int          `json:"query_id"`
	UserID     string       `json:"user_id"`
	Type       FeedbackType `json:"type"`
	Comment    string       `json:"comment,omitempty"`
	Rating     int          `json:"rating,omitempty"`
	CreatedAt  time.Time    `json:"created_at"`
}

// FeedbackType represents the type of feedback
type FeedbackType string

const (
	FeedbackLike    FeedbackType = "like"
	FeedbackDislike FeedbackType = "dislike"
	FeedbackFlag    FeedbackType = "flag"
)

// FeedbackStats represents aggregate feedback statistics
type FeedbackStats struct {
	ByType      map[FeedbackType]int `json:"by_type"`
	TotalCount  int                  `json:"total_count"`
	LikeRate    float64              `json:"like_rate"`  // 0.0-1.0
	DislikeRate float64              `json:"dislike_rate"` // 0.0-1.0
	FlagCount   int                  `json:"flag_count"`
	AvgRating   float64              `json:"avg_rating"`
	TrendLine   []FeedbackPoint      `json:"trend_line,omitempty"` // Time-series feedback
}

// FeedbackPoint represents a single data point in feedback trends
type FeedbackPoint struct {
	Timestamp time.Time    `json:"timestamp"`
	Count     int          `json:"count"`
	Type      FeedbackType `json:"type"`
}

// ConfidenceScore represents the confidence of an extracted entity/relationship
type ConfidenceScore struct {
	EntityID      string    `json:"entity_id"`
	Relationship  string    `json:"relationship,omitempty"` // For relationship confidence
	TargetID      string    `json:"target_id,omitempty"` // For relationship confidence
	Confidence    float64   `json:"confidence"`
	FeedbackScore float64   `json:"feedback_score,omitempty"` // Derived from user feedback
	LastRevaluated time.Time `json:"last_reevaluated,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// ImprovalAction represents a scheduled action to improve low-confidence items
type ImprovementAction struct {
	ID            int       `json:"id"`
	EntityID      string    `json:"entity_id"`
	Relationship  string    `json:"relationship,omitempty"`
	ActionType    string    `json:"action_type"` // "re_extract", "re_evaluate"
	Status        string    `json:"status"` // "pending", "running", "completed", "failed"
	ScheduledAt   time.Time `json:"scheduled_at"`
	ExecutedAt    time.Time `json:"executed_at,omitempty"`
	Result        string    `json:"result,omitempty"`
}
