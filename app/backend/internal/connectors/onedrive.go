package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

type OneDriveConnector struct {
	client *GraphClient
}

func NewOneDriveConnector(client *GraphClient) *OneDriveConnector {
	return &OneDriveConnector{client: client}
}

type FileItem struct {
	ID                string                 `json:"id"`
	Name              string                 `json:"name"`
	Size              int64                  `json:"size"`
	CreatedDateTime   string                 `json:"createdDateTime"`
	LastModifiedTime  string                 `json:"lastModifiedDateTime"`
	WebURL            string                 `json:"webUrl"`
	ParentReference   map[string]interface{} `json:"parentReference"`
	File              map[string]interface{} `json:"file"`
	Folder            map[string]interface{} `json:"folder"`
	DownloadURL       string                 `json:"@microsoft.graph.downloadUrl"`
}

type FileListResponse struct {
	Value    []FileItem `json:"value"`
	NextLink string     `json:"@odata.nextLink"`
}

type DeltaResponse struct {
	Value             []FileItem `json:"value"`
	NextLink          string     `json:"@odata.nextLink"`
	DeltaLink         string     `json:"@odata.deltaLink"`
	NextExpectedRanges []string   `json:"@odata.nextExpectedRanges"`
}

func (oc *OneDriveConnector) ListFiles(ctx context.Context, driveID string) ([]FileItem, error) {
	var allFiles []FileItem
	nextLink := fmt.Sprintf("/drives/%s/root/children?$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,parentReference,file,folder", driveID)

	for nextLink != "" {
		resp, err := oc.client.GetWithContext(ctx, nextLink)
		if err != nil {
			return nil, fmt.Errorf("onedrive.ListFiles: request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			slog.Warn("onedrive.ListFiles: non-200 response", "status", resp.StatusCode)
			resp.Body.Close()
			break
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("onedrive.ListFiles: read body: %w", err)
		}

		var listResp FileListResponse
		if err := json.Unmarshal(body, &listResp); err != nil {
			return nil, fmt.Errorf("onedrive.ListFiles: parse response: %w", err)
		}

		allFiles = append(allFiles, listResp.Value...)
		nextLink = listResp.NextLink
	}

	return allFiles, nil
}

func (oc *OneDriveConnector) DownloadFile(ctx context.Context, driveID, itemID string) ([]byte, error) {
	path := fmt.Sprintf("/drives/%s/items/%s/content", driveID, itemID)

	resp, err := oc.client.GetWithContext(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("onedrive.DownloadFile: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("onedrive.DownloadFile: status %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("onedrive.DownloadFile: read body: %w", err)
	}

	return content, nil
}

func (oc *OneDriveConnector) GetDelta(ctx context.Context, driveID, deltaToken string) ([]FileItem, string, error) {
	items, _, _, err := oc.GetDeltaWithState(ctx, driveID, deltaToken)
	if err != nil {
		return nil, "", err
	}
	// For backwards compatibility, return empty string for deltaLink
	return items, "", nil
}

// GetDeltaWithState performs a delta query and returns items, next delta link, and hasMore flag.
// The hasMore flag indicates whether more pages need to be fetched via pagination.
// deltaLink is the resumption token for the next delta cycle (stable across time).
func (oc *OneDriveConnector) GetDeltaWithState(ctx context.Context, driveID, deltaToken string) ([]FileItem, string, bool, error) {
	var allItems []FileItem
	var nextLink string
	var deltaLink string

	if deltaToken != "" {
		// Resume delta query from token
		nextLink = deltaToken
	} else {
		// Start new delta query
		nextLink = fmt.Sprintf("/drives/%s/root/delta?$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,parentReference,file,folder", driveID)
	}

	for nextLink != "" {
		resp, err := oc.client.GetWithContext(ctx, nextLink)
		if err != nil {
			return nil, "", false, fmt.Errorf("onedrive.GetDeltaWithState: request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, "", false, fmt.Errorf("onedrive.GetDeltaWithState: status %d", resp.StatusCode)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, "", false, fmt.Errorf("onedrive.GetDeltaWithState: read body: %w", err)
		}

		var deltaResp DeltaResponse
		if err := json.Unmarshal(body, &deltaResp); err != nil {
			return nil, "", false, fmt.Errorf("onedrive.GetDeltaWithState: parse response: %w", err)
		}

		allItems = append(allItems, deltaResp.Value...)

		// DeltaLink indicates end of delta query; store it for next cycle
		if deltaResp.DeltaLink != "" {
			deltaLink = deltaResp.DeltaLink
			break
		}

		// NextLink means more pages in current delta cycle
		nextLink = deltaResp.NextLink
	}

	// hasMore is true if we have a next page but haven't reached deltaLink yet
	hasMore := nextLink != "" && deltaLink == ""

	return allItems, deltaLink, hasMore, nil
}

// GetItemPermissions retrieves the sharing permissions for a specific item (file or folder).
// Returns a list of sharing identities (users/groups) who have access.
func (oc *OneDriveConnector) GetItemPermissions(ctx context.Context, driveID, itemID string) ([]map[string]interface{}, error) {
	path := fmt.Sprintf("/drives/%s/items/%s/permissions", driveID, itemID)

	resp, err := oc.client.GetWithContext(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("onedrive.GetItemPermissions: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Warn("onedrive.GetItemPermissions: non-200 response", "status", resp.StatusCode, "body", string(body))
		return nil, fmt.Errorf("onedrive.GetItemPermissions: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("onedrive.GetItemPermissions: read body: %w", err)
	}

	var permResp struct {
		Value []map[string]interface{} `json:"value"`
	}
	if err := json.Unmarshal(body, &permResp); err != nil {
		return nil, fmt.Errorf("onedrive.GetItemPermissions: parse response: %w", err)
	}

	return permResp.Value, nil
}
