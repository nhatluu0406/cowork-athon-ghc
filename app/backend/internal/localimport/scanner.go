package localimport

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

// Scanner walks a filesystem directory and yields file entries.
type Scanner struct {
	Source LocalSource
}

// NewScanner creates a new Scanner for a source.
func NewScanner(source LocalSource) *Scanner {
	return &Scanner{Source: source}
}

// Walk traverses the source directory and yields ScanEntry results via a channel.
// Returns channels for entries and errors; caller should handle ctx.Done().
func (s *Scanner) Walk(ctx context.Context) (<-chan ScanEntry, <-chan error) {
	entryChan := make(chan ScanEntry, 100)
	errChan := make(chan error, 10)

	go func() {
		defer close(entryChan)
		defer close(errChan)

		err := filepath.WalkDir(s.Source.FolderPath, func(path string, d os.DirEntry, err error) error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			if err != nil {
				select {
				case <-ctx.Done():
				case errChan <- err:
				}
				return nil
			}

			// Skip the root directory itself
			if path == s.Source.FolderPath {
				return nil
			}

			// Check if it's a symlink
			isSymlink := false
			mode := d.Type()
			if mode&os.ModeSymlink != 0 {
				isSymlink = true
				if !s.Source.FollowSymlinks {
					return nil
				}
			}

			// Skip hidden files if configured
			if !s.Source.HiddenFiles {
				name := filepath.Base(path)
				if strings.HasPrefix(name, ".") {
					if d.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
			}

			// Check depth limit
			rel, _ := filepath.Rel(s.Source.FolderPath, path)
			depth := strings.Count(rel, string(filepath.Separator))
			if depth >= s.Source.MaxDepth && d.IsDir() {
				return filepath.SkipDir
			}

			// Skip directories; only process files
			if d.IsDir() {
				return nil
			}

			// Get file info
			info, err := d.Info()
			if err != nil {
				select {
				case <-ctx.Done():
				case errChan <- err:
				}
				return nil
			}

			// Apply extension filters
			if !s.matchesFilters(path) {
				return nil
			}

			// Build ScanEntry
			entry := ScanEntry{
				RelPath:   rel,
				FileName:  filepath.Base(path),
				Size:      info.Size(),
				Mtime:     info.ModTime(),
				IsDir:     false,
				IsSymlink: isSymlink,
				Mode:      info.Mode(),
			}

			select {
			case <-ctx.Done():
				return ctx.Err()
			case entryChan <- entry:
			}

			return nil
		})

		if err != nil && err != context.Canceled {
			select {
			case <-ctx.Done():
			case errChan <- err:
			}
		}
	}()

	return entryChan, errChan
}

// matchesFilters checks if a file matches include/exclude extension filters.
func (s *Scanner) matchesFilters(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))

	// Check exclude patterns first
	if len(s.Source.ExcludeExt) > 0 {
		for _, pattern := range s.Source.ExcludeExt {
			if strings.ToLower(pattern) == ext {
				return false
			}
		}
	}

	// Check include patterns
	if len(s.Source.IncludeExt) > 0 {
		for _, pattern := range s.Source.IncludeExt {
			if strings.ToLower(pattern) == ext {
				return true
			}
		}
		return false // Include list exists but file doesn't match
	}

	// No include list; file matches unless explicitly excluded
	return true
}
