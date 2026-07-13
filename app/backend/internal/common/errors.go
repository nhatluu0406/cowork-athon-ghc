package common

import "fmt"

var (
	ErrAuthFailed       = fmt.Errorf("authentication failed")
	ErrNotFound         = fmt.Errorf("resource not found")
	ErrInvalidInput     = fmt.Errorf("invalid input")
	ErrPermissionDenied = fmt.Errorf("permission denied")
	ErrDatabaseError    = fmt.Errorf("database error")
	ErrNeo4jError       = fmt.Errorf("neo4j error")
)

func WrapError(err error, context string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", context, err)
}
