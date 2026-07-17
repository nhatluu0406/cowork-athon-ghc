package types

type FeedbackRequest struct {
	QueryID      int    `json:"query_id"`
	FeedbackType string `json:"feedback_type"`
	Comment      string `json:"comment,omitempty"`
}

type FeedbackStats struct {
	ByType map[string]int `json:"by_type"`
}

const (
	FeedbackLike    = "like"
	FeedbackDislike = "dislike"
	FeedbackFlag    = "flag"
)
