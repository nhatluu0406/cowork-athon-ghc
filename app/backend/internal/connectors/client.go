package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"time"
)

const (
	// Retry configuration
	maxRetries           = 3
	initialBackoffMs     = 1000      // 1 second
	maxBackoffMs         = 32000     // 32 seconds
	backoffMultiplier    = 2.0
	jitterFraction       = 0.1 // 10% jitter
	rateLimitRetryAfter  = 60 * time.Second

	// Throttle/rate-limit detection
	tooManyRequestsCode = 429
	serviceUnavailable  = 503
)

type GraphClient struct {
	baseURL    string
	httpClient *http.Client
	tokenFunc  func() (string, error)
	logger     *slog.Logger
}

// RateLimiter tracks rate-limit state across calls
type RateLimiter struct {
	retryAfter time.Time
	remaining  int
	limit      int
}

func NewGraphClient(tokenFunc func() (string, error)) *GraphClient {
	return &GraphClient{
		baseURL: "https://graph.microsoft.com/v1.0",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		tokenFunc: tokenFunc,
		logger:    slog.Default(),
	}
}

// NewGraphClientWithBaseURL constructs a GraphClient pointed at a custom base
// URL (e.g. an httptest.Server) instead of the real MS Graph endpoint. Used by
// integration tests (see tests/integration/connectors/permissions_test.go) to
// exercise ExtractAndCache/RefreshCache against a fake Graph API without
// making real network calls.
func NewGraphClientWithBaseURL(tokenFunc func() (string, error), baseURL string) *GraphClient {
	return &GraphClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		tokenFunc: tokenFunc,
		logger:    slog.Default(),
	}
}

// exponentialBackoff calculates backoff with jitter per Azure retry guidance
func exponentialBackoff(attempt int) time.Duration {
	// Calculate base backoff: min(initialBackoff * (multiplier ^ attempt), maxBackoff)
	baseMs := float64(initialBackoffMs) * math.Pow(backoffMultiplier, float64(attempt))
	if baseMs > float64(maxBackoffMs) {
		baseMs = float64(maxBackoffMs)
	}

	// Add jitter: ±10%
	jitterMs := baseMs * jitterFraction * (2*rand.Float64() - 1)
	totalMs := baseMs + jitterMs
	if totalMs < 0 {
		totalMs = baseMs / 2
	}

	return time.Duration(totalMs) * time.Millisecond
}

// isRetryable checks if a response status code indicates a retryable error
func isRetryable(statusCode int) bool {
	// Retry on rate-limit (429) and service unavailable (503)
	return statusCode == tooManyRequestsCode || statusCode == serviceUnavailable
}

func (c *GraphClient) do(ctx context.Context, method, path string, attempt int) (*http.Response, error) {
	token, err := c.tokenFunc()
	if err != nil {
		return nil, fmt.Errorf("graphclient.do: get token: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("graphclient.do: create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Network error: retry if attempts remain
		if attempt < maxRetries {
			backoff := exponentialBackoff(attempt)
			c.logger.WarnContext(ctx, "graphclient: network error, retrying",
				"path", path, "attempt", attempt+1, "backoff_ms", backoff.Milliseconds(), "err", err)
			select {
			case <-time.After(backoff):
				return c.do(ctx, method, path, attempt+1)
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return nil, fmt.Errorf("graphclient.do: http request failed after %d retries: %w", maxRetries, err)
	}

	// Check for retryable status codes (429, 503)
	if isRetryable(resp.StatusCode) && attempt < maxRetries {
		// Extract Retry-After header if present
		retryAfter := rateLimitRetryAfter
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if d, err := time.ParseDuration(ra + "s"); err == nil {
				retryAfter = d
			}
		}
		_, _ = io.ReadAll(resp.Body)
		resp.Body.Close()

		c.logger.WarnContext(ctx, "graphclient: rate-limited or unavailable, retrying",
			"path", path, "status", resp.StatusCode, "attempt", attempt+1, "retry_after_sec", retryAfter.Seconds())

		select {
		case <-time.After(retryAfter):
			return c.do(ctx, method, path, attempt+1)
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	// Non-retryable error status codes (4xx except 429, 5xx except 503)
	if resp.StatusCode >= 400 {
		c.logger.WarnContext(ctx, "graphclient: non-retryable error",
			"status", resp.StatusCode, "path", path)
	}

	return resp, nil
}

func (c *GraphClient) Do(ctx context.Context, method, path string) (*http.Response, error) {
	return c.do(ctx, method, path, 0)
}

func (c *GraphClient) GetWithContext(ctx context.Context, path string) (*http.Response, error) {
	return c.Do(ctx, "GET", path)
}

// Site represents a SharePoint site returned by MS Graph's /sites endpoint.
type Site struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Name        string `json:"name"`
	WebURL      string `json:"webUrl"`
	CreatedAt   string `json:"createdDateTime"`
}

type sitesListResponse struct {
	Value    []Site `json:"value"`
	NextLink string `json:"@odata.nextLink"`
}

// GetSites enumerates SharePoint sites visible to the authenticated
// application, following @odata.nextLink pagination, per the pattern
// established in onedrive.go/teams.go.
func (c *GraphClient) GetSites(ctx context.Context) ([]Site, error) {
	var allSites []Site
	nextLink := "/sites?search=*&$select=id,displayName,name,webUrl,createdDateTime"

	for nextLink != "" {
		resp, err := c.GetWithContext(ctx, nextLink)
		if err != nil {
			return nil, fmt.Errorf("graphclient.GetSites: request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			slog.WarnContext(ctx, "graphclient.GetSites: non-200 response", "status", resp.StatusCode)
			resp.Body.Close()
			break
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("graphclient.GetSites: read body: %w", err)
		}

		var listResp sitesListResponse
		if err := json.Unmarshal(body, &listResp); err != nil {
			return nil, fmt.Errorf("graphclient.GetSites: parse response: %w", err)
		}

		allSites = append(allSites, listResp.Value...)
		nextLink = listResp.NextLink
	}

	return allSites, nil
}

// GetSiteDrive resolves a SharePoint site's default document library drive
// via GET /sites/{siteId}/drive.
func (c *GraphClient) GetSiteDrive(ctx context.Context, siteID string) (map[string]interface{}, error) {
	path := fmt.Sprintf("/sites/%s/drive", siteID)

	resp, err := c.GetWithContext(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("graphclient.GetSiteDrive: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("graphclient.GetSiteDrive: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("graphclient.GetSiteDrive: read body: %w", err)
	}

	var drive map[string]interface{}
	if err := json.Unmarshal(body, &drive); err != nil {
		return nil, fmt.Errorf("graphclient.GetSiteDrive: parse response: %w", err)
	}

	return drive, nil
}
