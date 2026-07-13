package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

type TeamsConnector struct {
	client *GraphClient
}

func NewTeamsConnector(client *GraphClient) *TeamsConnector {
	return &TeamsConnector{client: client}
}

type Team struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdDateTime"`
	WebURL      string `json:"webUrl"`
}

type TeamsListResponse struct {
	Value    []Team `json:"value"`
	NextLink string `json:"@odata.nextLink"`
}

type Channel struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Email       string `json:"email"`
	WebURL      string `json:"webUrl"`
}

type ChannelsListResponse struct {
	Value    []Channel `json:"value"`
	NextLink string    `json:"@odata.nextLink"`
}

type Message struct {
	ID              string                 `json:"id"`
	CreatedDateTime string                 `json:"createdDateTime"`
	From            map[string]interface{} `json:"from"`
	Body            map[string]interface{} `json:"body"`
	Subject         string                 `json:"subject"`
	WebLink         string                 `json:"webLink"`
}

type MessagesListResponse struct {
	Value    []Message `json:"value"`
	NextLink string    `json:"@odata.nextLink"`
}

func (tc *TeamsConnector) ListTeams(ctx context.Context) ([]Team, error) {
	var allTeams []Team
	nextLink := "/me/joinedTeams?$select=id,displayName,description,createdDateTime,webUrl"

	for nextLink != "" {
		resp, err := tc.client.GetWithContext(ctx, nextLink)
		if err != nil {
			return nil, fmt.Errorf("teams.ListTeams: request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			slog.Warn("teams.ListTeams: non-200 response", "status", resp.StatusCode)
			resp.Body.Close()
			break
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("teams.ListTeams: read body: %w", err)
		}

		var listResp TeamsListResponse
		if err := json.Unmarshal(body, &listResp); err != nil {
			return nil, fmt.Errorf("teams.ListTeams: parse response: %w", err)
		}

		allTeams = append(allTeams, listResp.Value...)
		nextLink = listResp.NextLink
	}

	return allTeams, nil
}

func (tc *TeamsConnector) ListChannels(ctx context.Context, teamID string) ([]Channel, error) {
	var allChannels []Channel
	nextLink := fmt.Sprintf("/teams/%s/channels?$select=id,displayName,description,email,webUrl", teamID)

	for nextLink != "" {
		resp, err := tc.client.GetWithContext(ctx, nextLink)
		if err != nil {
			return nil, fmt.Errorf("teams.ListChannels: request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			slog.Warn("teams.ListChannels: non-200 response", "status", resp.StatusCode)
			resp.Body.Close()
			break
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("teams.ListChannels: read body: %w", err)
		}

		var listResp ChannelsListResponse
		if err := json.Unmarshal(body, &listResp); err != nil {
			return nil, fmt.Errorf("teams.ListChannels: parse response: %w", err)
		}

		allChannels = append(allChannels, listResp.Value...)
		nextLink = listResp.NextLink
	}

	return allChannels, nil
}

func (tc *TeamsConnector) ListMessages(ctx context.Context, teamID, channelID string) ([]Message, error) {
	var allMessages []Message
	nextLink := fmt.Sprintf("/teams/%s/channels/%s/messages?$select=id,createdDateTime,from,body,subject,webLink", teamID, channelID)

	for nextLink != "" {
		resp, err := tc.client.GetWithContext(ctx, nextLink)
		if err != nil {
			return nil, fmt.Errorf("teams.ListMessages: request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			slog.Warn("teams.ListMessages: non-200 response", "status", resp.StatusCode)
			resp.Body.Close()
			break
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("teams.ListMessages: read body: %w", err)
		}

		var listResp MessagesListResponse
		if err := json.Unmarshal(body, &listResp); err != nil {
			return nil, fmt.Errorf("teams.ListMessages: parse response: %w", err)
		}

		allMessages = append(allMessages, listResp.Value...)
		nextLink = listResp.NextLink
	}

	return allMessages, nil
}
