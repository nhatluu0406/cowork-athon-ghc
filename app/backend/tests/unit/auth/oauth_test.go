package auth_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

func TestJWTGenerateAndVerifyRoundTrip(t *testing.T) {
	tt := []struct {
		name        string
		userID      string
		email       string
		displayName string
		objectID    string
	}{
		{"basic claims", "user-1", "alice@example.com", "Alice", "obj-1"},
		{"empty display name/object id", "user-2", "bob@example.com", "", ""},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			ja := auth.NewJWTAuth("test-secret")

			token, err := ja.GenerateTokenWithClaims(tc.userID, tc.email, tc.displayName, tc.objectID, 3600)
			if err != nil {
				t.Fatalf("GenerateTokenWithClaims: %v", err)
			}
			if token == "" {
				t.Fatal("expected non-empty token")
			}

			claims, err := ja.VerifyToken(token)
			if err != nil {
				t.Fatalf("VerifyToken: %v", err)
			}
			if claims.UserID != tc.userID {
				t.Errorf("UserID = %q, want %q", claims.UserID, tc.userID)
			}
			if claims.Email != tc.email {
				t.Errorf("Email = %q, want %q", claims.Email, tc.email)
			}
			if claims.DisplayName != tc.displayName {
				t.Errorf("DisplayName = %q, want %q", claims.DisplayName, tc.displayName)
			}
			if claims.ObjectID != tc.objectID {
				t.Errorf("ObjectID = %q, want %q", claims.ObjectID, tc.objectID)
			}
			if claims.Issuer != "m365-knowledge-graph" {
				t.Errorf("Issuer = %q, want %q", claims.Issuer, "m365-knowledge-graph")
			}
		})
	}
}

func TestJWTGenerateTokenDefaultExpiry(t *testing.T) {
	ja := auth.NewJWTAuth("test-secret")

	token, err := ja.GenerateToken("user-1", "alice@example.com", 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	claims, err := ja.VerifyToken(token)
	if err != nil {
		t.Fatalf("VerifyToken: %v", err)
	}

	gotTTL := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	wantTTL := 24 * time.Hour
	if diff := gotTTL - wantTTL; diff < -time.Second || diff > time.Second {
		t.Errorf("default expiry TTL = %v, want ~%v", gotTTL, wantTTL)
	}
}

func TestJWTVerifyExpiredTokenRejected(t *testing.T) {
	secret := []byte("test-secret")

	now := time.Now()
	claims := auth.Claims{
		UserID: "user-1",
		Email:  "alice@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Hour)),
			NotBefore: jwt.NewNumericDate(now.Add(-2 * time.Hour)),
			Issuer:    "m365-knowledge-graph",
		},
	}

	expiredToken := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := expiredToken.SignedString(secret)
	if err != nil {
		t.Fatalf("sign expired token: %v", err)
	}

	ja := auth.NewJWTAuth("test-secret")
	if _, err := ja.VerifyToken(tokenString); err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
}

func TestJWTVerifyTamperedSignatureRejected(t *testing.T) {
	ja := auth.NewJWTAuth("test-secret")

	token, err := ja.GenerateToken("user-1", "alice@example.com", 3600)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3-part JWT, got %d parts", len(parts))
	}
	// Flip the last character of the signature segment.
	sig := []rune(parts[2])
	last := sig[len(sig)-1]
	if last == 'A' {
		sig[len(sig)-1] = 'B'
	} else {
		sig[len(sig)-1] = 'A'
	}
	tampered := parts[0] + "." + parts[1] + "." + string(sig)

	if _, err := ja.VerifyToken(tampered); err == nil {
		t.Fatal("expected error for tampered signature, got nil")
	}
}

func TestJWTVerifyWrongSecretRejected(t *testing.T) {
	issuer := auth.NewJWTAuth("secret-a")
	verifier := auth.NewJWTAuth("secret-b")

	token, err := issuer.GenerateToken("user-1", "alice@example.com", 3600)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	if _, err := verifier.VerifyToken(token); err == nil {
		t.Fatal("expected error verifying token signed with a different secret, got nil")
	}
}

func TestJWTVerifyMalformedTokenRejected(t *testing.T) {
	ja := auth.NewJWTAuth("test-secret")

	if _, err := ja.VerifyToken("not-a-valid-jwt"); err == nil {
		t.Fatal("expected error for malformed token, got nil")
	}
}

func TestEntraIDAuthorizeURL(t *testing.T) {
	ea := auth.NewEntraIDAuth("tenant-123", "client-456", "secret-789")

	redirectURI := "https://app.example.com/callback"
	rawURL := ea.AuthorizeURL(redirectURI)

	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("AuthorizeURL returned unparsable URL: %v", err)
	}

	wantPath := "/tenant-123/oauth2/v2.0/authorize"
	if parsed.Host != "login.microsoftonline.com" || parsed.Path != wantPath {
		t.Errorf("AuthorizeURL host/path = %s%s, want login.microsoftonline.com%s", parsed.Host, parsed.Path, wantPath)
	}

	q := parsed.Query()
	if got := q.Get("client_id"); got != "client-456" {
		t.Errorf("client_id = %q, want %q", got, "client-456")
	}
	if got := q.Get("redirect_uri"); got != redirectURI {
		t.Errorf("redirect_uri = %q, want %q", got, redirectURI)
	}
	if got := q.Get("response_type"); got != "code" {
		t.Errorf("response_type = %q, want %q", got, "code")
	}
	if got := q.Get("response_mode"); got != "query" {
		t.Errorf("response_mode = %q, want %q", got, "query")
	}
	scope := q.Get("scope")
	for _, want := range []string{"openid", "profile", "email", "User.Read", "offline_access"} {
		if !strings.Contains(scope, want) {
			t.Errorf("scope %q missing expected value %q", scope, want)
		}
	}
}

func TestEntraIDAuthorizeURLDifferentTenants(t *testing.T) {
	ea1 := auth.NewEntraIDAuth("tenant-a", "client-x", "secret-x")
	ea2 := auth.NewEntraIDAuth("tenant-b", "client-x", "secret-x")

	url1 := ea1.AuthorizeURL("https://app.example.com/callback")
	url2 := ea2.AuthorizeURL("https://app.example.com/callback")

	if !strings.Contains(url1, "/tenant-a/") {
		t.Errorf("expected tenant-a in URL: %s", url1)
	}
	if !strings.Contains(url2, "/tenant-b/") {
		t.Errorf("expected tenant-b in URL: %s", url2)
	}
	if url1 == url2 {
		t.Error("expected different URLs for different tenants")
	}
}
