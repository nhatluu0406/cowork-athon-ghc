package localimport_test

import (
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
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
		{
			name:       "mixed case extensions with dots (valid)",
			includeExt: []string{".PDF", ".Docx"},
			excludeExt: []string{".LOG"},
			wantErr:    false,
		},
		{
			name:       "multiple extensions with one invalid",
			includeExt: []string{".pdf", ".docx", "xlsx"},
			excludeExt: []string{},
			wantErr:    true,
			errMsg:     "include_ext",
		},
		{
			name:       "exclude multiple with one invalid",
			includeExt: []string{},
			excludeExt: []string{".log", ".tmp", "bak"},
			wantErr:    true,
			errMsg:     "exclude_ext",
		},
		{
			name:       "single invalid include",
			includeExt: []string{"notadot"},
			excludeExt: []string{},
			wantErr:    true,
			errMsg:     "include_ext",
		},
		{
			name:       "single invalid exclude",
			includeExt: []string{},
			excludeExt: []string{"notadot"},
			wantErr:    true,
			errMsg:     "exclude_ext",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := localimport.ValidateExtensionArrays(tt.includeExt, tt.excludeExt)
			if tt.wantErr {
				assert.Error(t, err, "expected error for invalid extensions")
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg, "error message should mention the invalid field")
				}
			} else {
				assert.NoError(t, err, "expected no error for valid extensions")
			}
		})
	}
}

// TestPhase8_ValidateSourcePath tests the ValidateSourcePath function
func TestPhase8_ValidateSourcePath(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{
			name:    "valid Windows absolute path",
			input:   "C:\\Users\\Documents",
			wantErr: false,
		},
		{
			name:    "relative path should be rejected",
			input:   "documents",
			wantErr: true,
		},
		{
			name:    "relative path with parent directory",
			input:   "../../etc/passwd",
			wantErr: true,
		},
		{
			name:    "UNC path should be rejected",
			input:   "\\\\server\\share",
			wantErr: true,
		},
		{
			name:    "empty path",
			input:   "",
			wantErr: true,
		},
		{
			name:    "path with null bytes",
			input:   "C:\\Users\x00\\Documents",
			wantErr: true,
		},
		{
			name:    "whitespace-only path",
			input:   "   ",
			wantErr: true,
		},
		{
			name:    "Windows extended-length path",
			input:   "\\\\?\\C:\\Users\\Documents",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := localimport.ValidateSourcePath(tt.input)
			if tt.wantErr {
				assert.Error(t, err, "expected error")
			} else {
				assert.NoError(t, err, "expected no error")
				assert.NotEmpty(t, result, "result should not be empty")
			}
		})
	}
}

// TestPhase8_ImportJobStatus tests ImportJob status constants
func TestPhase8_ImportJobStatus(t *testing.T) {
	assert.Equal(t, localimport.JobStatus("queued"), localimport.JobQueued)
	assert.Equal(t, localimport.JobStatus("running"), localimport.JobRunning)
	assert.Equal(t, localimport.JobStatus("completed"), localimport.JobCompleted)
	assert.Equal(t, localimport.JobStatus("failed"), localimport.JobFailed)
	assert.Equal(t, localimport.JobStatus("stale"), localimport.JobStale)
}

// TestPhase8_DeltaActions tests DeltaAction constants
func TestPhase8_DeltaActions(t *testing.T) {
	// DeltaAction is an int type with iota constants
	assert.Equal(t, 0, int(localimport.DeltaAdded), "DeltaAdded should be 0")
	assert.Equal(t, 1, int(localimport.DeltaModified), "DeltaModified should be 1")
	assert.Equal(t, 2, int(localimport.DeltaUnchanged), "DeltaUnchanged should be 2")
	assert.Equal(t, 3, int(localimport.DeltaDeleted), "DeltaDeleted should be 3")
}
