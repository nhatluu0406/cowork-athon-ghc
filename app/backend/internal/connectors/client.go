package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type GraphClient struct {
	baseURL    string
	httpClient *http.Client
	tokenFunc  func() (string, error)
}

func NewGraphClient(tokenFunc func() (string, error)) *GraphClient {
	return &GraphClient{
		baseURL: "https://graph.microsoft.com/v1.0",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		tokenFunc: tokenFunc,
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
	}
}

func (c *GraphClient) Do(method, path string, body interface{}) (*http.Response, error) {
	token, err := c.tokenFunc()
	if err != nil {
		return nil, fmt.Errorf("failed to get token: %w", err)
	}

	req, err := http.NewRequest(method, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		slog.WarnContext(nil, "graph api error", "status", resp.StatusCode, "path", path)
	}

	return resp, nil
}

func (c *GraphClient) GetWithContext(ctx context.Context, path string) (*http.Response, error) {
	token, err := c.tokenFunc()
	if err != nil {
		return nil, fmt.Errorf("graphclient.GetWithContext: get token: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("graphclient.GetWithContext: create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graphclient.GetWithContext: http request: %w", err)
	}

	if resp.StatusCode >= 400 {
		slog.WarnContext(ctx, "graph api error", "status", resp.StatusCode, "path", path)
	}

	return resp, nil
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
