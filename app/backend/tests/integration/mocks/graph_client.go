package mocks

// MockGraphClient implements a mock for the Graph API client
type MockGraphClient struct {
	deltaResponse map[string]interface{}
	hasMore       bool
	error         string
	permissions   map[string]string
}

// NewMockGraphClient creates a new mock Graph client
func NewMockGraphClient() *MockGraphClient {
	return &MockGraphClient{
		deltaResponse: make(map[string]interface{}),
		permissions:   make(map[string]string),
	}
}

// SetDeltaResponse sets the mock response for delta queries
func (m *MockGraphClient) SetDeltaResponse(files []map[string]interface{}, token string, hasMore bool) {
	m.deltaResponse = map[string]interface{}{
		"files":     files,
		"token":     token,
		"has_more":  hasMore,
	}
	m.hasMore = hasMore
}

// SetPermissionsResponse sets the mock response for permissions
func (m *MockGraphClient) SetPermissionsResponse(perms map[string]string) {
	m.permissions = perms
}

// SetError sets an error to be returned by API calls
func (m *MockGraphClient) SetError(err string) {
	m.error = err
}

// ClearError clears any set error
func (m *MockGraphClient) ClearError() {
	m.error = ""
}

// GetDelta is a mock implementation
func (m *MockGraphClient) GetDelta(driveID, token string) ([]map[string]interface{}, string, error) {
	if m.error != "" {
		return nil, "", NewError(m.error)
	}

	files, ok := m.deltaResponse["files"].([]map[string]interface{})
	if !ok {
		files = make([]map[string]interface{}, 0)
	}

	newToken, ok := m.deltaResponse["token"].(string)
	if !ok {
		newToken = ""
	}

	return files, newToken, nil
}

// GetPermissions is a mock implementation
func (m *MockGraphClient) GetPermissions(itemID string) (map[string]string, error) {
	if m.error != "" {
		return nil, NewError(m.error)
	}
	return m.permissions, nil
}

// MockError for testing
type MockError struct {
	msg string
}

// NewError creates a new mock error
func NewError(msg string) error {
	return &MockError{msg: msg}
}

// Error implements the error interface
func (e *MockError) Error() string {
	return e.msg
}
