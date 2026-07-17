package retrieval_test

import (
	"database/sql"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

func TestNewPermissionFilter(t *testing.T) {
	db := &sql.DB{} // mock
	pf := retrieval.NewPermissionFilter(db)
	if pf == nil {
		t.Fatal("expected permission filter, got nil")
	}
}
