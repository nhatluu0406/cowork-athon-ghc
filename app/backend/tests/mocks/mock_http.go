package mocks

import (
	"bytes"
	"io"
	"net/http"
)

// MockResponseWriter is a mock implementation of http.ResponseWriter
type MockResponseWriter struct {
	StatusCode int
	Headers    http.Header
	Body       *bytes.Buffer
}

// NewMockResponseWriter creates a new MockResponseWriter
func NewMockResponseWriter() *MockResponseWriter {
	return &MockResponseWriter{
		StatusCode: http.StatusOK,
		Headers:    make(http.Header),
		Body:       new(bytes.Buffer),
	}
}

// Header returns the header map that will be sent by WriteHeader.
func (m *MockResponseWriter) Header() http.Header {
	return m.Headers
}

// Write writes the data to the connection as part of an HTTP reply.
func (m *MockResponseWriter) Write(b []byte) (int, error) {
	return m.Body.Write(b)
}

// WriteHeader sends an HTTP response header with the provided status code.
func (m *MockResponseWriter) WriteHeader(statusCode int) {
	m.StatusCode = statusCode
}

// GetBody returns the response body as a string
func (m *MockResponseWriter) GetBody() string {
	return m.Body.String()
}

// Reset resets the mock response writer for reuse
func (m *MockResponseWriter) Reset() {
	m.StatusCode = http.StatusOK
	m.Headers = make(http.Header)
	m.Body.Reset()
}

// MockRequest creates a mock HTTP request for testing
func NewMockRequest(method, path string, body io.Reader) *http.Request {
	req, _ := http.NewRequest(method, path, body)
	return req
}
