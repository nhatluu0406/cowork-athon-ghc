// +build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/api"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

// TestLLMConfigPostValidConfig tests POST /api/llm/config with valid configuration
func TestLLMConfigPostValidConfig(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	// Create test JWT auth
	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")

	// Generate valid JWT token
	token, err := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)
	if err != nil {
		t.Fatalf("Failed to generate JWT: %v", err)
	}

	// Prepare request
	reqBody := map[string]interface{}{
		"provider": "openai",
		"base_url": "https://api.openai.com/v1",
		"api_key":  "sk-test-key-12345",
		"model":    "gpt-4o-mini",
		"nlp_mode": 1,
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	// Execute handler
	handler := api.HandleLLMConfig(db, jwtAuth)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	// Assert response
	if recorder.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", recorder.Code, recorder.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if resp["ok"] != true {
		t.Errorf("Expected ok=true, got %v", resp["ok"])
	}

	// Verify config was stored in database
	var provider string
	err = db.QueryRow("SELECT provider FROM llm_config WHERE id = 1").Scan(&provider)
	if err != nil {
		t.Fatalf("Failed to query stored config: %v", err)
	}

	if provider != "openai" {
		t.Errorf("Expected provider='openai', got '%s'", provider)
	}
}

// TestLLMConfigPostInvalidProvider tests POST with invalid provider
func TestLLMConfigPostInvalidProvider(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	reqBody := map[string]interface{}{
		"provider": "invalid-provider",
		"api_key":  "sk-test",
		"model":    "test-model",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	handler := api.HandleLLMConfig(db, jwtAuth)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", recorder.Code)
	}

	if !strings.Contains(recorder.Body.String(), "Invalid provider") {
		t.Errorf("Expected 'Invalid provider' in response, got: %s", recorder.Body.String())
	}
}

// TestLLMConfigPostWithoutJWT tests POST without JWT token
func TestLLMConfigPostWithoutJWT(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")

	reqBody := map[string]interface{}{
		"provider": "openai",
		"api_key":  "sk-test",
		"model":    "gpt-4",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	// No Authorization header

	handler := api.HandleLLMConfig(db, jwtAuth)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", recorder.Code)
	}
}

// TestLLMConfigGetWithoutJWT tests GET without JWT token
func TestLLMConfigGetWithoutJWT(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")

	req := httptest.NewRequest("GET", "/api/llm/config/current", nil)
	// No Authorization header

	handler := api.HandleLLMConfigGet(db, jwtAuth)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", recorder.Code)
	}
}

// TestLLMConfigGetWithNoConfig tests GET when no config is stored
func TestLLMConfigGetWithNoConfig(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	// Ensure table is empty
	db.Exec("DELETE FROM llm_config WHERE id = 1")

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	req := httptest.NewRequest("GET", "/api/llm/config/current", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	handler := api.HandleLLMConfigGet(db, jwtAuth)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", recorder.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(recorder.Body.Bytes(), &resp)

	if resp["provider"] != "none" {
		t.Errorf("Expected provider='none' for empty config, got %v", resp["provider"])
	}
}

// TestLLMConfigUpsert tests updating existing configuration
func TestLLMConfigUpsert(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	handler := api.HandleLLMConfig(db, jwtAuth)

	// First insert
	reqBody1 := map[string]interface{}{
		"provider": "openai",
		"base_url": "https://api.openai.com/v1",
		"api_key":  "sk-first-key",
		"model":    "gpt-4",
		"nlp_mode": 1,
	}
	body1, _ := json.Marshal(reqBody1)
	req1 := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body1))
	req1.Header.Set("Authorization", "Bearer "+token)
	req1.Header.Set("Content-Type", "application/json")
	recorder1 := httptest.NewRecorder()
	handler.ServeHTTP(recorder1, req1)

	if recorder1.Code != http.StatusOK {
		t.Fatalf("First insert failed: %d", recorder1.Code)
	}

	// Second insert (upsert)
	reqBody2 := map[string]interface{}{
		"provider": "anthropic",
		"base_url": "https://api.anthropic.com",
		"api_key":  "sk-second-key",
		"model":    "claude-3-5-sonnet-20241022",
		"nlp_mode": 2,
	}
	body2, _ := json.Marshal(reqBody2)
	req2 := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body2))
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("Content-Type", "application/json")
	recorder2 := httptest.NewRecorder()
	handler.ServeHTTP(recorder2, req2)

	if recorder2.Code != http.StatusOK {
		t.Fatalf("Second insert (upsert) failed: %d", recorder2.Code)
	}

	// Verify only one row exists with updated values
	var count int
	var provider string
	db.QueryRow("SELECT COUNT(*), provider FROM llm_config GROUP BY provider").Scan(&count, &provider)

	if count != 1 {
		t.Errorf("Expected exactly 1 row in llm_config, got %d", count)
	}

	if provider != "anthropic" {
		t.Errorf("Expected provider='anthropic' after upsert, got '%s'", provider)
	}
}

// TestLLMConfigNLPModeValidation tests NLP_MODE range validation
func TestLLMConfigNLPModeValidation(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	testCases := []struct {
		nlpMode  int
		expected int
	}{
		{0, 1},  // Below range -> defaults to 1
		{1, 1},  // Valid
		{2, 2},  // Valid
		{3, 3},  // Valid
		{4, 1},  // Above range -> defaults to 1
		{-1, 1}, // Negative -> defaults to 1
	}

	for _, tc := range testCases {
		t.Run(string(rune(tc.nlpMode+'0')), func(t *testing.T) {
			reqBody := map[string]interface{}{
				"provider": "openai",
				"base_url": "https://api.openai.com/v1",
				"api_key":  "sk-test",
				"model":    "gpt-4",
				"nlp_mode": tc.nlpMode,
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")

			handler := api.HandleLLMConfig(db, jwtAuth)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)

			if recorder.Code != http.StatusOK {
				t.Fatalf("Expected status 200, got %d", recorder.Code)
			}

			// Verify stored value
			var storedMode int
			db.QueryRow("SELECT nlp_mode FROM llm_config WHERE id = 1").Scan(&storedMode)

			if storedMode != tc.expected {
				t.Errorf("nlp_mode=%d: expected stored value %d, got %d", tc.nlpMode, tc.expected, storedMode)
			}
		})
	}
}

// TestLLMConfigAPIKeyNotInLogs tests that API key never appears in logs
// Note: This is a behavioral test - in real implementation, check slog output
func TestLLMConfigAPIKeyEncryption(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	apiKey := "sk-very-secret-key-12345"

	reqBody := map[string]interface{}{
		"provider": "openai",
		"base_url": "https://api.openai.com/v1",
		"api_key":  apiKey,
		"model":    "gpt-4",
		"nlp_mode": 1,
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	handler := api.HandleLLMConfig(db, jwtAuth)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	// Verify API key is encrypted in database (not plaintext)
	var storedKey []byte
	err := db.QueryRow("SELECT api_key FROM llm_config WHERE id = 1").Scan(&storedKey)
	if err != nil {
		t.Fatalf("Failed to query stored API key: %v", err)
	}

	// Encrypted value should not match plaintext
	if string(storedKey) == apiKey {
		t.Error("API key is stored in plaintext! Expected encrypted value")
	}

	// Verify it's PGP encrypted (starts with PGP header)
	if !bytes.Contains(storedKey, []byte("-----BEGIN PGP MESSAGE-----")) {
		t.Error("API key does not appear to be PGP encrypted")
	}
}

// TestLLMConfigAPIKeyNotReturnedInGET tests that API key is never returned by GET endpoint
func TestLLMConfigAPIKeyNotReturnedInGET(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	// First, insert a config
	postReqBody := map[string]interface{}{
		"provider": "openai",
		"base_url": "https://api.openai.com/v1",
		"api_key":  "sk-secret-key",
		"model":    "gpt-4",
		"nlp_mode": 1,
	}
	postBody, _ := json.Marshal(postReqBody)
	postReq := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(postBody))
	postReq.Header.Set("Authorization", "Bearer "+token)
	postReq.Header.Set("Content-Type", "application/json")
	postHandler := api.HandleLLMConfig(db, jwtAuth)
	postRecorder := httptest.NewRecorder()
	postHandler.ServeHTTP(postRecorder, postReq)

	// Now GET the config
	getReq := httptest.NewRequest("GET", "/api/llm/config/current", nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getHandler := api.HandleLLMConfigGet(db, jwtAuth)
	getRecorder := httptest.NewRecorder()
	getHandler.ServeHTTP(getRecorder, getReq)

	if getRecorder.Code != http.StatusOK {
		t.Fatalf("GET request failed: %d", getRecorder.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(getRecorder.Body.Bytes(), &resp)

	// Verify api_key field is NOT present
	if _, exists := resp["api_key"]; exists {
		t.Error("API key should NOT be returned in GET response")
	}

	// Verify other fields ARE present
	if resp["provider"] == nil {
		t.Error("Provider field missing from response")
	}
	if resp["model"] == nil {
		t.Error("Model field missing from response")
	}
}

// TestLLMConfigSSRFValidation tests SSRF protection for base_url
func TestLLMConfigSSRFValidation(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	jwtAuth := auth.NewJWTAuth("test-secret-key-for-testing")
	token, _ := jwtAuth.GenerateToken("test-user-id", "test-user@example.com", 3600)

	maliciousURLs := []string{
		"http://localhost:8080",           // HTTP not allowed
		"https://127.0.0.1",               // Loopback
		"https://10.0.0.1",                // Private IP (RFC1918)
		"https://172.16.0.1",              // Private IP (RFC1918)
		"https://192.168.1.1",             // Private IP (RFC1918)
		"https://169.254.169.254",         // Link-local (AWS metadata)
		"https://[::1]",                   // IPv6 loopback
		"https://[fe80::1]",               // IPv6 link-local
	}

	for _, url := range maliciousURLs {
		t.Run(url, func(t *testing.T) {
			reqBody := map[string]interface{}{
				"provider": "openai",
				"base_url": url,
				"api_key":  "sk-test",
				"model":    "gpt-4",
				"nlp_mode": 1,
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest("POST", "/api/llm/config", bytes.NewBuffer(body))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")

			handler := api.HandleLLMConfig(db, jwtAuth)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)

			if recorder.Code != http.StatusBadRequest {
				t.Errorf("Expected status 400 for malicious URL %s, got %d", url, recorder.Code)
			}

			if !strings.Contains(recorder.Body.String(), "Invalid base_url") {
				t.Errorf("Expected 'Invalid base_url' error for %s, got: %s", url, recorder.Body.String())
			}
		})
	}
}

// TestLLMConfigSingletonConstraint tests that only one config row exists (id=1)
func TestLLMConfigSingletonConstraint(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	ctx := context.Background()

	// Try to insert a second row with id=2
	_, err := db.ExecContext(ctx, `
		INSERT INTO llm_config (id, provider, base_url, api_key, model, nlp_mode, updated_at, updated_by)
		VALUES (2, 'openai', '', 'test', 'gpt-4', 1, NOW(), 'test')
	`)

	// Should fail due to CHECK constraint (id = 1)
	if err == nil {
		t.Error("Expected error when inserting row with id != 1, but got none")
	}

	// Verify error message mentions constraint
	if !strings.Contains(err.Error(), "check") {
		t.Errorf("Expected CHECK constraint error, got: %v", err)
	}
}
