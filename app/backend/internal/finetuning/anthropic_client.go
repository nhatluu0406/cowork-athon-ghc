package finetuning

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type AnthropicClient struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewAnthropicClient(apiKey string) *AnthropicClient {
	return &AnthropicClient{
		apiKey:  apiKey,
		baseURL: "https://api.anthropic.com",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func NewAnthropicClientWithBaseURL(apiKey, baseURL string) *AnthropicClient {
	return &AnthropicClient{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type TrainingData struct {
	System    string `json:"system"`
	UserQuery string `json:"user_query"`
	Answer    string `json:"answer"`
	Positive  bool   `json:"positive"`
}

type FineTuningJobRequest struct {
	Model         string          `json:"model"`
	TrainingData  []*TrainingData `json:"training_data"`
	ValidationPct float64         `json:"validation_pct,omitempty"`
}

type FineTuningJobResponse struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	ModelID      string `json:"model_id"`
	Error        string `json:"error,omitempty"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
	CompletedAt  string `json:"completed_at,omitempty"`
	TrainingCost string `json:"training_cost,omitempty"`
}

func (ac *AnthropicClient) CreateFineTuningJob(ctx context.Context, req FineTuningJobRequest) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("anthropic_client.CreateFineTuningJob: marshal: %w", err)
	}

	url := ac.baseURL + "/v1/beta/model-ids/models/claude-opus-4-8/fine_tuning_jobs"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(body))
	if err != nil {
		return "", fmt.Errorf("anthropic_client.CreateFineTuningJob: new request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+ac.apiKey)
	httpReq.Header.Set("anthropic-beta", "token-counting-2024-11-01")

	resp, err := ac.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("anthropic_client.CreateFineTuningJob: http: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("anthropic_client.CreateFineTuningJob: read body: %w", err)
	}

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", fmt.Errorf("anthropic_client.CreateFineTuningJob: status %d: %s", resp.StatusCode, string(respBody))
	}

	var jobResp FineTuningJobResponse
	if err := json.Unmarshal(respBody, &jobResp); err != nil {
		return "", fmt.Errorf("anthropic_client.CreateFineTuningJob: unmarshal: %w", err)
	}

	slog.InfoContext(ctx, "fine-tuning job created", "job_id", jobResp.ID, "model", req.Model, "pairs", len(req.TrainingData))
	return jobResp.ID, nil
}

func (ac *AnthropicClient) PollFineTuningJob(ctx context.Context, jobID string) (*FineTuningJobResponse, error) {
	url := ac.baseURL + "/v1/beta/fine_tuning_jobs/" + jobID
	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("anthropic_client.PollFineTuningJob: new request: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+ac.apiKey)
	httpReq.Header.Set("anthropic-beta", "token-counting-2024-11-01")

	resp, err := ac.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("anthropic_client.PollFineTuningJob: http: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("anthropic_client.PollFineTuningJob: read body: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("anthropic_client.PollFineTuningJob: status %d: %s", resp.StatusCode, string(respBody))
	}

	var jobResp FineTuningJobResponse
	if err := json.Unmarshal(respBody, &jobResp); err != nil {
		return nil, fmt.Errorf("anthropic_client.PollFineTuningJob: unmarshal: %w", err)
	}

	slog.DebugContext(ctx, "fine-tuning job polled", "job_id", jobID, "status", jobResp.Status)
	return &jobResp, nil
}

func (ac *AnthropicClient) WaitForCompletion(ctx context.Context, jobID string, maxWait time.Duration) (*FineTuningJobResponse, error) {
	deadline := time.Now().Add(maxWait)
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Until(deadline)):
			return nil, fmt.Errorf("anthropic_client.WaitForCompletion: timeout after %v", maxWait)
		case <-ticker.C:
			job, err := ac.PollFineTuningJob(ctx, jobID)
			if err != nil {
				return nil, err
			}

			if job.Status == "completed" {
				slog.InfoContext(ctx, "fine-tuning job completed", "job_id", jobID, "model_id", job.ModelID)
				return job, nil
			}

			if job.Status == "failed" {
				return nil, fmt.Errorf("anthropic_client.WaitForCompletion: job failed: %s", job.Error)
			}

			if job.Status == "queued" || job.Status == "running" {
				slog.InfoContext(ctx, "fine-tuning job in progress", "job_id", jobID, "status", job.Status)
				continue
			}

			return nil, fmt.Errorf("anthropic_client.WaitForCompletion: unexpected status: %s", job.Status)
		}
	}
}
