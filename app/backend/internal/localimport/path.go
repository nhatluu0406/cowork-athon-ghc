package localimport

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ValidateSourcePath validates and normalizes a user-provided folder path.
// Returns the absolute, clean path if valid, or an error.
// Rejects relative paths, UNC paths, empty paths, and dangerous paths.
func ValidateSourcePath(userInput string) (string, error) {
	if userInput == "" {
		return "", fmt.Errorf("path cannot be empty")
	}

	// Reject paths with null bytes (security check)
	if strings.Contains(userInput, "\x00") {
		return "", fmt.Errorf("path cannot contain null bytes")
	}

	// Reject paths that are only spaces (security check)
	if strings.TrimSpace(userInput) == "" {
		return "", fmt.Errorf("path cannot contain only whitespace")
	}

	// Reject relative paths; only absolute paths are allowed
	if !filepath.IsAbs(userInput) {
		return "", fmt.Errorf("path must be absolute, not relative")
	}

	// Clean the path
	clean := filepath.Clean(userInput)

	// Reject UNC paths on Windows (e.g., \\server\share)
	if strings.HasPrefix(clean, `\\`) && !strings.HasPrefix(clean, `\\?`) {
		return "", fmt.Errorf("UNC paths are not supported")
	}

	// Reject Windows long path syntax \\?\C:\... (extended-length path prefix)
	if strings.HasPrefix(clean, `\\?`) {
		return "", fmt.Errorf("Windows extended-length paths (\\\\?\\) are not supported")
	}

	// Reject paths pointing to /proc or /sys (Linux security)
	if strings.HasPrefix(clean, "/proc") || strings.HasPrefix(clean, "/sys") {
		return "", fmt.Errorf("paths to system directories (/proc, /sys) are not supported")
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
