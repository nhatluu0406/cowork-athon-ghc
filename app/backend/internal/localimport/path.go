package localimport

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ValidateSourcePath validates and normalizes a user-provided folder path.
// Returns the absolute, clean path if valid, or an error.
// Rejects relative paths, UNC paths, and empty paths.
func ValidateSourcePath(userInput string) (string, error) {
	if userInput == "" {
		return "", fmt.Errorf("path cannot be empty")
	}

	// Reject relative paths; only absolute paths are allowed
	if !filepath.IsAbs(userInput) {
		return "", fmt.Errorf("path must be absolute, not relative")
	}

	// Clean the path
	clean := filepath.Clean(userInput)

	// Reject UNC paths on Windows (e.g., \\server\share)
	if strings.HasPrefix(clean, `\\`) {
		return "", fmt.Errorf("UNC paths are not supported")
	}

	return clean, nil
}

// RedactPath returns a relative path from source root, for safe logging.
// Never returns the absolute path.
func RedactPath(absPath, sourceRoot string) string {
	rel, err := filepath.Rel(sourceRoot, absPath)
	if err != nil {
		return "<redacted>"
	}
	return rel
}

// IsInsideRoot checks if a path is inside the given root directory.
func IsInsideRoot(path, root string) bool {
	clean := filepath.Clean(path)
	cleanRoot := filepath.Clean(root)

	rel, err := filepath.Rel(cleanRoot, clean)
	if err != nil {
		return false
	}

	return !strings.HasPrefix(rel, "..")
}
