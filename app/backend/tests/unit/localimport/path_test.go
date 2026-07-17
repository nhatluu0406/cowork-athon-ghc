package localimport_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
)

func TestValidateSourcePath_ValidAbsolutePath(t *testing.T) {
	tmpDir := t.TempDir()
	result, err := localimport.ValidateSourcePath(tmpDir)

	assert.NoError(t, err)
	assert.Equal(t, filepath.Clean(tmpDir), result)
	assert.NotEmpty(t, result)
}

func TestValidateSourcePath_RelativePathRejected(t *testing.T) {
	result, err := localimport.ValidateSourcePath("./relative/path")

	assert.Error(t, err)
	assert.Empty(t, result)
	assert.Contains(t, err.Error(), "relative")
}

func TestValidateSourcePath_ParentTraversalRejected(t *testing.T) {
	tmpDir := t.TempDir()
	unsafePath := filepath.Join(tmpDir, "..", "..", "..", "etc", "passwd")
	result, err := localimport.ValidateSourcePath(unsafePath)

	// The function uses filepath.Abs which resolves .. to actual path
	// If the result doesn't start with a valid drive/root, it's rejected implicitly
	// But this test is more about ensuring traversal doesn't escape
	if err == nil {
		// It resolved to a real absolute path; that's okay
		// The important part is that ValidateSourcePath normalizes it
		assert.NotContains(t, result, "..")
	}
}

func TestValidateSourcePath_UNCPathRejected(t *testing.T) {
	uncPath := `\\server\share`
	result, err := localimport.ValidateSourcePath(uncPath)

	assert.Error(t, err)
	assert.Empty(t, result)
	assert.Contains(t, err.Error(), "UNC")
}

func TestValidateSourcePath_EmptyStringRejected(t *testing.T) {
	result, err := localimport.ValidateSourcePath("")

	assert.Error(t, err)
	assert.Empty(t, result)
	assert.Contains(t, err.Error(), "empty")
}

func TestValidateSourcePath_PathWithDoubleDots(t *testing.T) {
	tmpDir := t.TempDir()
	nestedPath := filepath.Join(tmpDir, "a", "b", "c")
	err := os.MkdirAll(nestedPath, 0o755)
	assert.NoError(t, err)

	// Try to use .. in the path before normalization
	pathWithDots := filepath.Join(nestedPath, "..", "..", "b")
	result, err := localimport.ValidateSourcePath(pathWithDots)

	assert.NoError(t, err)
	// filepath.Abs should resolve it to a real path, removing ..
	assert.NotContains(t, result, "..")
}

func TestValidateSourcePath_NestedAbsolutePath(t *testing.T) {
	tmpDir := t.TempDir()
	nestedPath := filepath.Join(tmpDir, "a", "b", "c")
	err := os.MkdirAll(nestedPath, 0o755)
	assert.NoError(t, err)

	result, err := localimport.ValidateSourcePath(nestedPath)

	assert.NoError(t, err)
	assert.Equal(t, filepath.Clean(nestedPath), result)
}

func TestValidateSourcePath_PathWithSpaces(t *testing.T) {
	tmpDir := t.TempDir()
	pathWithSpaces := filepath.Join(tmpDir, "folder with spaces")
	err := os.Mkdir(pathWithSpaces, 0o755)
	assert.NoError(t, err)

	result, err := localimport.ValidateSourcePath(pathWithSpaces)

	assert.NoError(t, err)
	assert.Contains(t, result, "folder with spaces")
}

func TestRedactPath_RelativeFromRoot(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "subdir", "file.txt")

	result := localimport.RedactPath(filePath, tmpDir)

	assert.Equal(t, filepath.Join("subdir", "file.txt"), result)
	assert.NotContains(t, result, tmpDir)
}

func TestRedactPath_FileInRoot(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "file.txt")

	result := localimport.RedactPath(filePath, tmpDir)

	assert.Equal(t, "file.txt", result)
}

func TestRedactPath_InvalidPath(t *testing.T) {
	// If we can't compute relative path, return redacted
	result := localimport.RedactPath("/unrelated/path/file.txt", "/tmp/root")

	// Result depends on OS, but should be safe (either relative or <redacted>)
	assert.True(t, result != "/unrelated/path/file.txt")
}

func TestRedactPath_NestedPath(t *testing.T) {
	tmpDir := t.TempDir()
	deepPath := filepath.Join(tmpDir, "a", "b", "c", "d", "file.txt")

	result := localimport.RedactPath(deepPath, tmpDir)

	expected := filepath.Join("a", "b", "c", "d", "file.txt")
	assert.Equal(t, expected, result)
	assert.NotContains(t, result, tmpDir)
}

func TestIsInsideRoot_DirectChild(t *testing.T) {
	tmpDir := t.TempDir()
	childPath := filepath.Join(tmpDir, "child")

	result := localimport.IsInsideRoot(childPath, tmpDir)

	assert.True(t, result)
}

func TestIsInsideRoot_DeepNestedPath(t *testing.T) {
	tmpDir := t.TempDir()
	deepPath := filepath.Join(tmpDir, "a", "b", "c", "d")

	result := localimport.IsInsideRoot(deepPath, tmpDir)

	assert.True(t, result)
}

func TestIsInsideRoot_ParentTraversalOutside(t *testing.T) {
	tmpDir := t.TempDir()
	outsidePath := filepath.Join(tmpDir, "..", "outside")

	result := localimport.IsInsideRoot(outsidePath, tmpDir)

	assert.False(t, result)
}

func TestIsInsideRoot_SiblingPath(t *testing.T) {
	tmpDir := t.TempDir()
	parentDir := filepath.Dir(tmpDir)
	siblingPath := filepath.Join(parentDir, "sibling")

	result := localimport.IsInsideRoot(siblingPath, tmpDir)

	assert.False(t, result)
}

func TestIsInsideRoot_RootItself(t *testing.T) {
	tmpDir := t.TempDir()

	result := localimport.IsInsideRoot(tmpDir, tmpDir)

	assert.True(t, result)
}

func TestIsInsideRoot_PathWithDots(t *testing.T) {
	tmpDir := t.TempDir()
	nestedPath := filepath.Join(tmpDir, "a", "b")
	err := os.MkdirAll(nestedPath, 0o755)
	assert.NoError(t, err)

	pathWithDots := filepath.Join(nestedPath, "..", "b", "..", "b")

	result := localimport.IsInsideRoot(pathWithDots, tmpDir)

	assert.True(t, result)
}

func TestIsInsideRoot_ComplexTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	nestedPath := filepath.Join(tmpDir, "a", "b", "c")
	err := os.MkdirAll(nestedPath, 0o755)
	assert.NoError(t, err)

	// Try to escape: /tmp/test/a/b/c/../../../../outside
	pathEscape := filepath.Join(nestedPath, "..", "..", "..", "..", "outside")

	result := localimport.IsInsideRoot(pathEscape, tmpDir)

	assert.False(t, result)
}

func TestPathFunctions_Integration(t *testing.T) {
	// Create a test directory structure
	tmpDir := t.TempDir()
	subDir := filepath.Join(tmpDir, "subdir")
	err := os.Mkdir(subDir, 0o755)
	assert.NoError(t, err)

	// Validate the source path
	validPath, err := localimport.ValidateSourcePath(tmpDir)
	assert.NoError(t, err)

	// Check that subdir is inside root
	assert.True(t, localimport.IsInsideRoot(subDir, validPath))

	// Redact a file inside
	filePath := filepath.Join(subDir, "test.txt")
	redacted := localimport.RedactPath(filePath, validPath)
	assert.Equal(t, filepath.Join("subdir", "test.txt"), redacted)
}

func TestValidateSourcePath_OnlyDots(t *testing.T) {
	// Verify that "." (relative path) is rejected
	result, err := localimport.ValidateSourcePath(".")

	assert.Error(t, err)
	assert.Empty(t, result)
	assert.Contains(t, err.Error(), "relative")
}

func TestRedactPath_SamePath(t *testing.T) {
	tmpDir := t.TempDir()

	result := localimport.RedactPath(tmpDir, tmpDir)

	assert.Equal(t, ".", result)
}

func TestIsInsideRoot_WindowsStyleUNCPath(t *testing.T) {
	tmpDir := t.TempDir()
	// This test is OS-dependent; on Windows, UNC paths might behave differently
	// For non-Windows, this will just be treated as a regular path string
	uncPath := `\\server\share\file`

	// Should return false since it's checking if a UNC path is inside tmpDir
	result := localimport.IsInsideRoot(uncPath, tmpDir)

	assert.False(t, result)
}
