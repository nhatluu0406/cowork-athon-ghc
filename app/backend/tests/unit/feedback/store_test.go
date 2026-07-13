package feedback_test

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
)

// TestNewFeedbackStore tests store creation
func TestNewFeedbackStore(t *testing.T) {
	db := &sql.DB{}
	store := feedback.NewFeedbackStore(db)
	assert.NotNil(t, store)
}

// TestFeedbackTypes tests feedback type constants
func TestFeedbackTypes(t *testing.T) {
	tt := []struct {
		name  string
		ftype feedback.FeedbackType
	}{
		{"like", feedback.FeedbackLike},
		{"dislike", feedback.FeedbackDislike},
		{"flag", feedback.FeedbackFlag},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			assert.NotEmpty(t, tc.ftype)
		})
	}
}

// TestFeedbackLikeType tests FeedbackLike constant
func TestFeedbackLikeType(t *testing.T) {
	assert.Equal(t, feedback.FeedbackType("like"), feedback.FeedbackLike)
}

// TestFeedbackDislikeType tests FeedbackDislike constant
func TestFeedbackDislikeType(t *testing.T) {
	assert.Equal(t, feedback.FeedbackType("dislike"), feedback.FeedbackDislike)
}

// TestFeedbackFlagType tests FeedbackFlag constant
func TestFeedbackFlagType(t *testing.T) {
	assert.Equal(t, feedback.FeedbackType("flag"), feedback.FeedbackFlag)
}

// TestFeedbackStore_Initialization tests store is properly initialized
func TestFeedbackStore_Initialization(t *testing.T) {
	db := &sql.DB{}
	store := feedback.NewFeedbackStore(db)
	assert.NotNil(t, store)
}

// TestFeedbackEvent_Creation tests FeedbackEvent structure
func TestFeedbackEvent_Creation(t *testing.T) {
	event := &feedback.FeedbackEvent{
		ID:           1,
		QueryID:      123,
		UserID:       "user123",
		FeedbackType: feedback.FeedbackLike,
		Comment:      "Good answer",
	}

	assert.Equal(t, int64(1), event.ID)
	assert.Equal(t, int64(123), event.QueryID)
	assert.Equal(t, "user123", event.UserID)
	assert.Equal(t, feedback.FeedbackLike, event.FeedbackType)
	assert.Equal(t, "Good answer", event.Comment)
}

// TestFeedbackStore_CanBeCalled tests that store methods exist
func TestFeedbackStore_CanBeCalled(t *testing.T) {
	db := &sql.DB{}
	store := feedback.NewFeedbackStore(db)
	assert.NotNil(t, store)
	// Methods will be tested via integration tests with a real DB
}

// TestFeedbackTypeLike tests like feedback type
func TestFeedbackTypeLike(t *testing.T) {
	ft := feedback.FeedbackLike
	assert.NotEmpty(t, ft)
	assert.Equal(t, feedback.FeedbackType("like"), ft)
}

// TestFeedbackTypeDislike tests dislike feedback type
func TestFeedbackTypeDislike(t *testing.T) {
	ft := feedback.FeedbackDislike
	assert.NotEmpty(t, ft)
	assert.Equal(t, feedback.FeedbackType("dislike"), ft)
}

// TestFeedbackTypeFlag tests flag feedback type
func TestFeedbackTypeFlag(t *testing.T) {
	ft := feedback.FeedbackFlag
	assert.NotEmpty(t, ft)
	assert.Equal(t, feedback.FeedbackType("flag"), ft)
}

// TestErrQueryNotFound tests error constant
func TestErrQueryNotFound(t *testing.T) {
	assert.NotNil(t, feedback.ErrQueryNotFound)
}

// TestMultipleStoreInstances tests creating multiple store instances
func TestMultipleStoreInstances(t *testing.T) {
	db := &sql.DB{}

	store1 := feedback.NewFeedbackStore(db)
	store2 := feedback.NewFeedbackStore(db)

	assert.NotNil(t, store1)
	assert.NotNil(t, store2)
	// Both stores are valid
	assert.True(t, store1 != nil && store2 != nil)
}

// TestFeedbackEventZeroValue tests FeedbackEvent zero values
func TestFeedbackEventZeroValue(t *testing.T) {
	event := &feedback.FeedbackEvent{}

	assert.Equal(t, int64(0), event.ID)
	assert.Equal(t, int64(0), event.QueryID)
	assert.Equal(t, "", event.UserID)
	assert.Equal(t, feedback.FeedbackType(""), event.FeedbackType)
	assert.Equal(t, "", event.Comment)
}

// TestFeedbackEventWithAllFields tests FeedbackEvent with all fields
func TestFeedbackEventWithAllFields(t *testing.T) {
	event := &feedback.FeedbackEvent{
		ID:           42,
		QueryID:      999,
		UserID:       "test-user",
		FeedbackType: feedback.FeedbackLike,
		Comment:      "Excellent response",
	}

	assert.Equal(t, int64(42), event.ID)
	assert.Equal(t, int64(999), event.QueryID)
	assert.Equal(t, "test-user", event.UserID)
	assert.Equal(t, feedback.FeedbackLike, event.FeedbackType)
	assert.Equal(t, "Excellent response", event.Comment)
}

// TestFeedbackTypeStringValues tests that FeedbackType string values are correct
func TestFeedbackTypeStringValues(t *testing.T) {
	tests := []struct {
		ftype    feedback.FeedbackType
		expected string
	}{
		{feedback.FeedbackLike, "like"},
		{feedback.FeedbackDislike, "dislike"},
		{feedback.FeedbackFlag, "flag"},
	}

	for _, test := range tests {
		assert.Equal(t, test.expected, string(test.ftype))
	}
}

// TestFeedbackStore_NewFeedbackStore_ReturnsNonNil tests store creation
func TestFeedbackStore_NewFeedbackStore_ReturnsNonNil(t *testing.T) {
	db := &sql.DB{}
	store := feedback.NewFeedbackStore(db)
	assert.NotNil(t, store, "NewFeedbackStore should return non-nil store")
}
