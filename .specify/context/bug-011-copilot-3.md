# BUG-011 (Part 3/3): TASK-BUG-011-07 → TASK-BUG-011-07

> **Copilot instructions:**
> - Do NOT use @workspace or @codebase — all context is in this file.
> - ⚠️  **First message only**: include `#file:` — remove it from ALL replies.
> - Implement tasks **in order**, one at a time.
> - After EACH task: reply `TASK-ID done` (no #file:) before proceeding.
> - Mark each completed task `[x]` in tasks.md.
> - Context: ~614 tokens | 1 tasks | Part 3/3

---


## Task 1/1: TASK-BUG-011-07
**[P]**


### ACCEPTANCE CRITERIA

- [ ] `TestGetRunningJobNullColumns`: seed DB with job that has NULL user_email/config_json and status='running' → `getRunningJobForRepo` returns job without error
- [ ] `TestGetR

### CODE SCOPE

// 1 files, max 80 lines each

### src/Backend/internal/api/handlers_index_test.go
```
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockDBForIndex extends MinimalMockDB for index handler testing
type MockDBForIndex struct {
	MinimalMockDB
	jobs map[int64]map[string]interface{}
}

// Test: handleTriggerIndex POST endpoint
func TestHandleTriggerIndex_Success(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/repos/1/index", bytes.NewBufferString(`{
		"force": false,
		"incremental": true
	}`))
	req.Header.Set("Content-Type", "application/json")

	// Add path parameters
	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	// Create mock server
	server := &Server{
		db:                &MockDBForIndex{},
		indexOrchestrator: nil, // Will be nil for test
	}

	server.handleTriggerIndex(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response IndexTriggerResponse
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response.JobID)
	assert.Equal(t, "queued", response.Status)
	assert.Equal(t, int64(1), response.RepoID)
	assert.NotEmpty(t, response.Message)
}

// Test: handleTriggerIndex with invalid repo ID
func TestHandleTriggerIndex_InvalidRepoID(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/repos/invalid/index", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")

	vars := map[string]string{"id": "invalid"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleTriggerIndex(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// Test: handleTriggerIndex with invalid JSON
func TestHandleTriggerIndex_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/repos/1/index", bytes.NewBufferString(`{invalid json}`))
	req.Header.Set("Content-Type", "application/json")

	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()
// ... (252 more lines — read full file if needed)
```

> Reply `TASK-BUG-011-07 done` (without #file:) to continue.

---