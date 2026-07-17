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
