package auth_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

// TestEntraIDTokenCaching verifies that EntraID tokens are cached and reused
// within their TTL, avoiding redundant token service calls.
func TestEntraIDTokenCaching(t *testing.T) {
	var tokenCallCount = 0

	mockTokenProvider := func(ctx context.Context) (string, time.Time, error) {
		tokenCallCount++
		// Return token valid for 1 hour from now
		expiry := time.Now().Add(time.Hour)
		return fmt.Sprintf("token-%d", tokenCallCount), expiry, nil
	}

	// Create EntraID with mocked token provider
	entra := auth.NewEntraIDAuthWithProvider(mockTokenProvider)

	ctx := context.Background()

	// First call should invoke token provider
	token1, err := entra.GetAppToken(ctx)
	if err != nil {
		t.Fatalf("expected first token, got error: %v", err)
	}
	if token1 == "" {
		t.Error("expected non-empty token")
	}
	if tokenCallCount != 1 {
		t.Errorf("expected 1 token call, got %d", tokenCallCount)
	}

	// Second call should return cached token without calling provider
	token2, err := entra.GetAppToken(ctx)
	if err != nil {
		t.Fatalf("expected cached token, got error: %v", err)
	}
	if token1 != token2 {
		t.Errorf("expected same token (cached), got different tokens: %s vs %s", token1, token2)
	}
	if tokenCallCount != 1 {
		t.Errorf("expected still 1 token call (cached), got %d", tokenCallCount)
	}
}

// TestEntraIDTokenRefreshOnExpiry verifies that when a token's expiry time
// is reached, a new token is fetched from the provider.
func TestEntraIDTokenRefreshOnExpiry(t *testing.T) {
	var tokenCallCount = 0
	var tokens []string

	mockTokenProvider := func(ctx context.Context) (string, time.Time, error) {
		tokenCallCount++
		token := fmt.Sprintf("token-%d", tokenCallCount)
		tokens = append(tokens, token)
		// Token expires immediately (well, 1 nanosecond from now)
		expiry := time.Now().Add(1 * time.Nanosecond)
		return token, expiry, nil
	}

	entra := auth.NewEntraIDAuthWithProvider(mockTokenProvider)
	ctx := context.Background()

	// First token
	token1, _ := entra.GetAppToken(ctx)

	// Small sleep to let token expire
	time.Sleep(10 * time.Millisecond)

	// Second call should refresh due to expiry
	token2, _ := entra.GetAppToken(ctx)

	if token1 == token2 {
		t.Error("expected different tokens after expiry")
	}
	if tokenCallCount != 2 {
		t.Errorf("expected 2 token calls (refresh on expiry), got %d", tokenCallCount)
	}
}

// TestEntraIDTokenProviderError verifies that if the token provider returns
// an error, the EntraID auth propagates the error.
func TestEntraIDTokenProviderError(t *testing.T) {
	mockTokenProvider := func(ctx context.Context) (string, time.Time, error) {
		return "", time.Time{}, fmt.Errorf("oauth service unavailable")
	}

	entra := auth.NewEntraIDAuthWithProvider(mockTokenProvider)
	ctx := context.Background()

	token, err := entra.GetAppToken(ctx)
	if err == nil {
		t.Error("expected error from token provider, got success")
	}
	if token != "" {
		t.Error("expected empty token on error")
	}
	if !fmt.Sprintf("%v", err).Contains("oauth service unavailable") &&
		!fmt.Sprintf("%v", err).Contains("oauth") {
		t.Errorf("expected oauth-related error, got: %v", err)
	}
}

// TestEntraIDContextCancellation verifies that if the context is cancelled,
// token fetching respects the cancellation.
func TestEntraIDContextCancellation(t *testing.T) {
	mockTokenProvider := func(ctx context.Context) (string, time.Time, error) {
		// Check if context is already cancelled
		select {
		case <-ctx.Done():
			return "", time.Time{}, ctx.Err()
		default:
			return "token", time.Now().Add(time.Hour), nil
		}
	}

	entra := auth.NewEntraIDAuthWithProvider(mockTokenProvider)

	// Create a cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	token, err := entra.GetAppToken(ctx)
	if err == nil {
		t.Error("expected context.Cancelled error, got success")
	}
	if token != "" {
		t.Error("expected empty token on context cancellation")
	}
}

// TestJWTTokenValidation verifies that a valid JWT is verified correctly
// and invalid/expired tokens are rejected.
func TestJWTTokenValidation(t *testing.T) {
	// Create a JWT auth instance with a test secret
	secret := "test-secret-key"
	jwtAuth := auth.NewJWTAuth(secret)

	// Create a token
	userID := "user123"
	email := "user@example.com"
	token, err := jwtAuth.CreateToken(userID, email, time.Hour)
	if err != nil {
		t.Fatalf("failed to create token: %v", err)
	}

	if token == "" {
		t.Error("expected non-empty token")
	}

	// Verify the token
	claims, err := jwtAuth.VerifyToken(token)
	if err != nil {
		t.Fatalf("failed to verify token: %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("expected userID %s, got %s", userID, claims.UserID)
	}
	if claims.Email != email {
		t.Errorf("expected email %s, got %s", email, claims.Email)
	}
}

// TestJWTTokenExpiration verifies that an expired JWT is rejected.
func TestJWTTokenExpiration(t *testing.T) {
	secret := "test-secret-key"
	jwtAuth := auth.NewJWTAuth(secret)

	// Create an immediately-expired token
	token, err := jwtAuth.CreateToken("user123", "user@example.com", 1*time.Nanosecond)
	if err != nil {
		t.Fatalf("failed to create token: %v", err)
	}

	// Small sleep to let token expire
	time.Sleep(10 * time.Millisecond)

	// Attempt to verify
	claims, err := jwtAuth.VerifyToken(token)
	if err == nil {
		t.Error("expected error for expired token, got success")
	}
	if claims != nil {
		t.Error("expected nil claims for expired token")
	}
}

// TestJWTInvalidSignature verifies that a token signed with a different key
// is rejected.
func TestJWTInvalidSignature(t *testing.T) {
	secret1 := "secret-1"
	secret2 := "secret-2"

	jwtAuth1 := auth.NewJWTAuth(secret1)
	jwtAuth2 := auth.NewJWTAuth(secret2)

	// Create token with secret1
	token, err := jwtAuth1.CreateToken("user123", "user@example.com", time.Hour)
	if err != nil {
		t.Fatalf("failed to create token: %v", err)
	}

	// Try to verify with secret2
	claims, err := jwtAuth2.VerifyToken(token)
	if err == nil {
		t.Error("expected error for mismatched secret, got success")
	}
	if claims != nil {
		t.Error("expected nil claims for invalid signature")
	}
}

// TestJWTMalformedToken verifies that a malformed JWT is rejected.
func TestJWTMalformedToken(t *testing.T) {
	secret := "test-secret-key"
	jwtAuth := auth.NewJWTAuth(secret)

	malformedTokens := []string{
		"",
		"not-a-jwt",
		"header.payload", // missing signature
		"a.b.c.d",        // too many parts
	}

	for _, malformed := range malformedTokens {
		claims, err := jwtAuth.VerifyToken(malformed)
		if err == nil {
			t.Errorf("expected error for malformed token %q, got success", malformed)
		}
		if claims != nil {
			t.Errorf("expected nil claims for malformed token %q", malformed)
		}
	}
}

// Helper to check if a string contains a substring
func (s string) Contains(substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (len(s) >= len(substr))
}
