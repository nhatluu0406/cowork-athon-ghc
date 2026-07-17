package localimport_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestValidateExtensionArrays tests extension validation.
func TestValidateExtensionArrays(t *testing.T) {
	tests := []struct {
		name       string
		includeExt []string
		excludeExt []string
		wantErr    bool
		errMsg     string
	}{
		{
			name:       "valid extensions with dot",
			includeExt: []string{".pdf", ".docx"},
			excludeExt: []string{".log"},
			wantErr:    false,
		},
		{
			name:       "empty arrays",
			includeExt: []string{},
			excludeExt: []string{},
			wantErr:    false,
		},
		{
			name:       "include without dot",
			includeExt: []string{"pdf"},
			excludeExt: []string{},
			wantErr:    true,
			errMsg:     "include_ext",
		},
		{
			name:       "exclude without dot",
			includeExt: []string{},
			excludeExt: []string{"log"},
			wantErr:    true,
			errMsg:     "exclude_ext",
		},
		{
			name:       "mixed valid and invalid in include",
			includeExt: []string{".pdf", "docx"},
			excludeExt: []string{},
			wantErr:    true,
			errMsg:     "include_ext",
		},
		{
			name:       "both arrays with mixed valid and invalid",
			includeExt: []string{".pdf"},
			excludeExt: []string{"log"},
			wantErr:    true,
			errMsg:     "exclude_ext",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := localimport.ValidateExtensionArrays(tt.includeExt, tt.excludeExt)
			if tt.wantErr {
				assert.Error(t, err)
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestHandleCreateSource_ExtensionValidation tests that POST /api/local/sources validates extensions.
func TestHandleCreateSource_ExtensionValidation(t *testing.T) {
	tests := []struct {
		name           string
		includeExt     []string
		excludeExt     []string
		expectedStatus int
		shouldFail     bool
	}{
		{
			name:           "valid include extensions",
			includeExt:     []string{".pdf", ".docx"},
			excludeExt:     []string{},
			expectedStatus: http.StatusCreated,
			shouldFail:     false,
		},
		{
			name:           "valid exclude extensions",
			includeExt:     []string{},
			excludeExt:     []string{".log", ".tmp"},
			expectedStatus: http.StatusCreated,
			shouldFail:     false,
		},
		{
			name:           "no extensions specified",
			includeExt:     []string{},
			excludeExt:     []string{},
			expectedStatus: http.StatusCreated,
			shouldFail:     false,
		},
		{
			name:           "invalid include extension without dot",
			includeExt:     []string{"pdf"},
			excludeExt:     []string{},
			expectedStatus: http.StatusBadRequest,
			shouldFail:     true,
		},
		{
			name:           "invalid exclude extension without dot",
			includeExt:     []string{},
			excludeExt:     []string{"log"},
			expectedStatus: http.StatusBadRequest,
			shouldFail:     true,
		},
		{
			name:           "multiple extensions with one invalid",
			includeExt:     []string{".pdf", "docx"},
			excludeExt:     []string{},
			expectedStatus: http.StatusBadRequest,
			shouldFail:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a mock database connection
			db, err := sql.Open("postgres", "user=postgres password=postgres dbname=test sslmode=disable")
			require.NoError(t, err)
			defer db.Close()

			// Create stores and dependencies
			sourceStore := localimport.NewLocalSourceStore(db)
			jobStore := localimport.NewImportJobStore(db)
			deps := &localimport.LocalImportDeps{
				SourceStore: sourceStore,
				JobStore:    jobStore,
				Dispatcher:  localimport.NewDispatcher(1),
			}

			// Create request
			reqBody := localimport.CreateSourceRequest{
				Name:       "Test Source",
				FolderPath: t.TempDir(),
				IncludeExt: tt.includeExt,
				ExcludeExt: tt.excludeExt,
			}

			bodyBytes, err := json.Marshal(reqBody)
			require.NoError(t, err)

			req := httptest.NewRequest(http.MethodPost, "/api/local/sources", bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			// Create handler and serve
			handler := localimport.NewLocalImportHandler(deps)
			handler.ServeHTTP(w, req)

			// Verify response status
			assert.Equal(t, tt.expectedStatus, w.Code, "response status mismatch")

			// If it should fail, verify error message contains validation error
			if tt.shouldFail {
				assert.Contains(t, w.Body.String(), "invalid extension array", "error message should mention extension validation")
			}
		})
	}
}

// TestHandleCreateSource_ValidPath tests basic path validation with extensions.
func TestHandleCreateSource_ValidPath(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a mock database connection
	db, err := sql.Open("postgres", "user=postgres password=postgres dbname=test sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	sourceStore := localimport.NewLocalSourceStore(db)
	jobStore := localimport.NewImportJobStore(db)
	deps := &localimport.LocalImportDeps{
		SourceStore: sourceStore,
		JobStore:    jobStore,
		Dispatcher:  localimport.NewDispatcher(1),
	}

	reqBody := localimport.CreateSourceRequest{
		Name:       "Test Source",
		FolderPath: tmpDir,
		IncludeExt: []string{".pdf"},
		ExcludeExt: []string{".log"},
		Recursive:  true,
		MaxDepth:   5,
	}

	bodyBytes, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/local/sources", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler := localimport.NewLocalImportHandler(deps)
	handler.ServeHTTP(w, req)

	// Valid path with valid extensions should succeed or fail at DB level, but not at validation
	assert.NotEqual(t, http.StatusBadRequest, w.Code, "valid path and extensions should not return 400")
}

// TestHandleCreateSource_InvalidJSON tests invalid JSON handling.
func TestHandleCreateSource_InvalidJSON(t *testing.T) {
	// Create a mock database connection
	db, err := sql.Open("postgres", "user=postgres password=postgres dbname=test sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	sourceStore := localimport.NewLocalSourceStore(db)
	jobStore := localimport.NewImportJobStore(db)
	deps := &localimport.LocalImportDeps{
		SourceStore: sourceStore,
		JobStore:    jobStore,
		Dispatcher:  localimport.NewDispatcher(1),
	}

	req := httptest.NewRequest(http.MethodPost, "/api/local/sources", bytes.NewReader([]byte("{invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler := localimport.NewLocalImportHandler(deps)
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "invalid request")
}

// TestHandleCreateSource_MixedCaseExtensions tests that various case extensions are handled correctly during validation.
func TestHandleCreateSource_MixedCaseExtensions(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a mock database connection
	db, err := sql.Open("postgres", "user=postgres password=postgres dbname=test sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	sourceStore := localimport.NewLocalSourceStore(db)
	jobStore := localimport.NewImportJobStore(db)
	deps := &localimport.LocalImportDeps{
		SourceStore: sourceStore,
		JobStore:    jobStore,
		Dispatcher:  localimport.NewDispatcher(1),
	}

	// Test that extensions like .PDF, .Pdf are valid (they have dots)
	// The scanner will normalize them to lowercase for matching
	reqBody := localimport.CreateSourceRequest{
		Name:       "Test Source",
		FolderPath: tmpDir,
		IncludeExt: []string{".PDF", ".Docx"},
		ExcludeExt: []string{".LOG"},
		Recursive:  true,
	}

	bodyBytes, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/local/sources", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler := localimport.NewLocalImportHandler(deps)
	handler.ServeHTTP(w, req)

	// Should not be a 400 for extension validation (they all have dots)
	assert.NotEqual(t, http.StatusBadRequest, w.Code, "mixed case extensions with dots should pass validation")
}

// TestHandleGetJob tests retrieving job status with correct fields.
func TestHandleGetJob(t *testing.T) {
	db, err := sql.Open("postgres", "user=postgres password=postgres dbname=test sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	jobStore := localimport.NewImportJobStore(db)
	sourceStore := localimport.NewLocalSourceStore(db)
	deps := &localimport.LocalImportDeps{
		SourceStore: sourceStore,
		JobStore:    jobStore,
		Dispatcher:  localimport.NewDispatcher(1),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/local/jobs/nonexistent", nil)
	w := httptest.NewRecorder()

	handler := localimport.NewLocalImportHandler(deps)
	handler.ServeHTTP(w, req)

	// Should return 404 for nonexistent job
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestHandleListJobs tests listing jobs.
func TestHandleListJobs(t *testing.T) {
	db, err := sql.Open("postgres", "user=postgres password=postgres dbname=test sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	jobStore := localimport.NewImportJobStore(db)
	sourceStore := localimport.NewLocalSourceStore(db)
	deps := &localimport.LocalImportDeps{
		SourceStore: sourceStore,
		JobStore:    jobStore,
		Dispatcher:  localimport.NewDispatcher(1),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/local/jobs", nil)
	w := httptest.NewRecorder()

	handler := localimport.NewLocalImportHandler(deps)
	handler.ServeHTTP(w, req)

	// Should return 200 for list
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Contains(t, response, "jobs")
}
