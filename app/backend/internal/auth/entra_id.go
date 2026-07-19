package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type EntraIDAuth struct {
	tenantID     string
	clientID     string
	clientSecret string
	httpClient   *http.Client
}

func NewEntraIDAuth(tenantID, clientID, clientSecret string) *EntraIDAuth {
	return &EntraIDAuth{
		tenantID:     tenantID,
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{},
	}
}

type EntraTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

type EntraUserInfo struct {
	ObjectID      string `json:"id"`
	UserID        string `json:"preferred_username"`
	Email         string `json:"email"`
	DisplayName   string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Oid           string `json:"oid"`
	Tid           string `json:"tid"`
}

const (
	tokenEndpointTemplate = "https://login.microsoftonline.com/%s/oauth2/v2.0/token"
	authorizeEndpoint     = "https://login.microsoftonline.com/%s/oauth2/v2.0/authorize"
	userInfoEndpoint      = "https://graph.microsoft.com/v1.0/me"
	defaultScopes         = "User.Read Mail.Read Mail.Read.Shared offline_access"
)

func (ea *EntraIDAuth) AuthorizeURL(redirectURI string) string {
	params := url.Values{}
	params.Set("client_id", ea.clientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	params.Set("scope", "openid profile email " + defaultScopes)
	params.Set("response_mode", "query")

	endpoint := fmt.Sprintf(authorizeEndpoint, ea.tenantID)
	return endpoint + "?" + params.Encode()
}

func (ea *EntraIDAuth) ExchangeCode(ctx context.Context, code, redirectURI string) (*EntraTokenResponse, error) {
	tokenURL := fmt.Sprintf(tokenEndpointTemplate, ea.tenantID)

	data := url.Values{}
	data.Set("client_id", ea.clientID)
	data.Set("client_secret", ea.clientSecret)
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	data.Set("scope", defaultScopes)

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("entra_id.ExchangeCode: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := ea.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("entra_id.ExchangeCode: http request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("entra_id.ExchangeCode: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("entra_id.ExchangeCode: status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp EntraTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("entra_id.ExchangeCode: parse response: %w", err)
	}

	return &tokenResp, nil
}

// ClientCredentialsToken acquires an app-only Microsoft Graph access token
// via the OAuth2 client-credentials grant (tenant/client ID + secret only,
// no user interaction). Used by the M365 connectors (onedrive.go/teams.go)
// for scheduled/triggered sync, as opposed to ExchangeCode/RefreshToken
// which are used for the user-delegated login flow (HandleLogin).
func (ea *EntraIDAuth) ClientCredentialsToken(ctx context.Context) (*EntraTokenResponse, error) {
	tokenURL := fmt.Sprintf(tokenEndpointTemplate, ea.tenantID)

	data := url.Values{}
	data.Set("client_id", ea.clientID)
	data.Set("client_secret", ea.clientSecret)
	data.Set("grant_type", "client_credentials")
	data.Set("scope", "https://graph.microsoft.com/.default")

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("entra_id.ClientCredentialsToken: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := ea.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("entra_id.ClientCredentialsToken: http request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("entra_id.ClientCredentialsToken: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("entra_id.ClientCredentialsToken: status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp EntraTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("entra_id.ClientCredentialsToken: parse response: %w", err)
	}

	return &tokenResp, nil
}

func (ea *EntraIDAuth) RefreshToken(ctx context.Context, refreshToken string) (*EntraTokenResponse, error) {
	tokenURL := fmt.Sprintf(tokenEndpointTemplate, ea.tenantID)

	data := url.Values{}
	data.Set("client_id", ea.clientID)
	data.Set("client_secret", ea.clientSecret)
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("entra_id.RefreshToken: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := ea.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("entra_id.RefreshToken: http request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("entra_id.RefreshToken: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("entra_id.RefreshToken: status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp EntraTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("entra_id.RefreshToken: parse response: %w", err)
	}

	return &tokenResp, nil
}

func (ea *EntraIDAuth) GetUserInfo(ctx context.Context, accessToken string) (*EntraUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", userInfoEndpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("entra_id.GetUserInfo: create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := ea.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("entra_id.GetUserInfo: http request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("entra_id.GetUserInfo: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("entra_id.GetUserInfo: status %d: %s", resp.StatusCode, string(body))
	}

	var userInfo EntraUserInfo
	if err := json.Unmarshal(body, &userInfo); err != nil {
		return nil, fmt.Errorf("entra_id.GetUserInfo: parse response: %w", err)
	}

	return &userInfo, nil
}

// TokenManager manages token lifecycle: caching, refresh, and expiry.
// Thread-safe token manager for use by M365 connectors.
type TokenManager struct {
	auth           *EntraIDAuth
	accessToken    string
	refreshToken   string
	expiresAt      int64 // Unix timestamp
	bufferSeconds  int64 // Refresh token if expiry is within this buffer
}

func NewTokenManager(auth *EntraIDAuth, bufferSeconds int64) *TokenManager {
	if bufferSeconds == 0 {
		bufferSeconds = 300 // 5 minutes default buffer
	}
	return &TokenManager{
		auth:          auth,
		bufferSeconds: bufferSeconds,
	}
}

// SetTokens sets initial token state (used after login)
func (tm *TokenManager) SetTokens(accessToken, refreshToken string, expiresIn int) {
	tm.accessToken = accessToken
	tm.refreshToken = refreshToken
	tm.expiresAt = getCurrentTimeUnix() + int64(expiresIn)
}

// GetToken returns a valid access token, refreshing if necessary.
// This is the primary method for M365 connectors to obtain a working token.
func (tm *TokenManager) GetToken(ctx context.Context) (string, error) {
	now := getCurrentTimeUnix()

	// Token still valid and not approaching expiry
	if tm.accessToken != "" && now < tm.expiresAt-tm.bufferSeconds {
		return tm.accessToken, nil
	}

	// Token expired or approaching expiry, refresh
	if tm.refreshToken != "" {
		tokenResp, err := tm.auth.RefreshToken(ctx, tm.refreshToken)
		if err != nil {
			return "", fmt.Errorf("TokenManager.GetToken: refresh failed: %w", err)
		}
		tm.SetTokens(tokenResp.AccessToken, tokenResp.RefreshToken, tokenResp.ExpiresIn)
		return tm.accessToken, nil
	}

	// No valid token and no refresh token available
	return "", fmt.Errorf("TokenManager.GetToken: no valid token and no refresh token")
}

// ClientCredentialsToken acquires a service-principal token (no refresh, used for daemon sync).
// Unlike GetToken, this doesn't cache or refresh—it's for one-time sync operations.
func (tm *TokenManager) ClientCredentialsToken(ctx context.Context) (string, error) {
	tokenResp, err := tm.auth.ClientCredentialsToken(ctx)
	if err != nil {
		return "", fmt.Errorf("TokenManager.ClientCredentialsToken: %w", err)
	}
	return tokenResp.AccessToken, nil
}

func getCurrentTimeUnix() int64 {
	return time.Now().Unix()
}
