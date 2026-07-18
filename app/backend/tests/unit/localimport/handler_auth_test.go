package localimport_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// H3 regression: every /api/local/* route must be behind the JWT gate. Before the fix the
// handlers explicitly skipped auth ("For MVP, we'll skip auth check"), letting any caller of the
// loopback service create a source pointing at an arbitrary absolute path and read its files.

func TestLocalImport_NilJWT_Returns401(t *testing.T) {
	// A nil JWTAuth must fail CLOSED (401), never fall open to an unauthenticated handler.
	h := localimport.NewLocalImportHandler(&localimport.LocalImportDeps{JWTAuth: nil})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/local/sources", nil))
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestLocalImport_NoToken_Returns401(t *testing.T) {
	h := localimport.NewLocalImportHandler(&localimport.LocalImportDeps{JWTAuth: auth.NewJWTAuth("test-secret")})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/local/sources", nil))
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestLocalImport_InvalidToken_Returns401(t *testing.T) {
	h := localimport.NewLocalImportHandler(&localimport.LocalImportDeps{JWTAuth: auth.NewJWTAuth("test-secret")})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/local/sources", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-jwt")
	h.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestLocalImport_ValidToken_PassesAuthGate(t *testing.T) {
	// With a valid token the auth gate must let the request THROUGH. We POST an invalid
	// (relative) folder_path so the handler rejects it at path validation (400) BEFORE touching
	// any store — proving auth passed (not 401) without needing a live DB.
	jwtAuth := auth.NewJWTAuth("test-secret")
	token, err := jwtAuth.GenerateToken("user-1", "user-1@example.com", 3600)
	require.NoError(t, err)

	h := localimport.NewLocalImportHandler(&localimport.LocalImportDeps{JWTAuth: jwtAuth})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/local/sources",
		strings.NewReader(`{"name":"x","folder_path":"relative/not/absolute"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	h.ServeHTTP(rec, req)

	assert.NotEqual(t, http.StatusUnauthorized, rec.Code, "valid token must pass the auth gate")
	assert.Equal(t, http.StatusBadRequest, rec.Code, "relative path must be rejected at validation")
}
