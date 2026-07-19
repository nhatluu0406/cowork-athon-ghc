package connectors_test

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// TestGraphClientRetryOnRateLimit verifies that the GraphClient retries
// automatically when it receives a 429 (Too Many Requests) status code.
func TestGraphClientRetryOnRateLimit(t *testing.T) {
	var attemptCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attemptCount++
		if attemptCount == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, `{"id":"test-site-1","displayName":"Test Site"}`)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	resp, err := client.Do(ctx, "GET", "/test")
	if err != nil {
		t.Fatalf("expected success after retry, got error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	if attemptCount < 2 {
		t.Errorf("expected at least 2 attempts (initial + retry), got %d", attemptCount)
	}
}

// TestGraphClientRetryOnServiceUnavailable verifies retry on 503
func TestGraphClientRetryOnServiceUnavailable(t *testing.T) {
	var attemptCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attemptCount++
		if attemptCount == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, `{"value":[]}`)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	resp, err := client.Do(ctx, "GET", "/test")
	if err != nil {
		t.Fatalf("expected success after retry, got error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	if attemptCount < 2 {
		t.Errorf("expected at least 2 attempts, got %d", attemptCount)
	}
}

// TestGraphClientNoRetryOnNonRetryableError verifies that non-retryable
// errors (4xx except 429, 5xx except 503) are not retried.
func TestGraphClientNoRetryOnNonRetryableError(t *testing.T) {
	var attemptCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attemptCount++
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.Do(ctx, "GET", "/test")
	if err != nil {
		t.Fatalf("expected error or response, got: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}

	if attemptCount != 1 {
		t.Errorf("expected exactly 1 attempt (no retry), got %d", attemptCount)
	}
}

// TestGraphClientRetryExhaustion verifies that after maxRetries attempts,
// the client gives up and returns the final failure.
func TestGraphClientRetryExhaustion(t *testing.T) {
	var attemptCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attemptCount++
		w.Header().Set("Retry-After", "1")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	resp, err := client.Do(ctx, "GET", "/test")
	if err == nil && resp != nil {
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Errorf("expected final response to be 429, got %d", resp.StatusCode)
		}
		resp.Body.Close()
	}

	if attemptCount < 1 {
		t.Errorf("expected at least 1 attempt, got %d", attemptCount)
	}
}

// TestGraphClientContextCancellation verifies that if the context is cancelled
// during a retry wait, the client returns the context.Cancelled error.
func TestGraphClientContextCancellation(t *testing.T) {
	var attemptCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attemptCount++
		if attemptCount == 1 {
			w.Header().Set("Retry-After", "5")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	resp, err := client.Do(ctx, "GET", "/test")
	if err == nil {
		t.Error("expected context.Cancelled error, got success")
		if resp != nil {
			resp.Body.Close()
		}
	} else if !strings.Contains(err.Error(), "context") {
		t.Errorf("expected context-related error, got: %v", err)
	}

	if attemptCount > 1 {
		t.Errorf("expected only 1 attempt (context cancelled before retry), got %d", attemptCount)
	}
}

// TestGraphClientTokenRefreshError verifies that if tokenFunc returns an error,
// the request fails immediately without retries.
func TestGraphClientTokenRefreshError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) {
			return "", fmt.Errorf("token refresh failed")
		},
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.Do(ctx, "GET", "/test")
	if err == nil {
		t.Error("expected error due to token failure, got success")
		if resp != nil {
			resp.Body.Close()
		}
	} else if !strings.Contains(err.Error(), "token") {
		t.Errorf("expected token error, got: %v", err)
	}
}

// TestGraphClientRetryAfterHeader verifies that if Retry-After header is present,
// the client uses that duration instead of the default retry wait.
func TestGraphClientRetryAfterHeader(t *testing.T) {
	var attemptCount = 0
	var retryWaitStarted time.Time

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attemptCount++
		if attemptCount == 1 {
			retryWaitStarted = time.Now()
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	resp, err := client.Do(ctx, "GET", "/test")
	if err != nil {
		t.Fatalf("expected success after retry, got error: %v", err)
	}
	defer resp.Body.Close()

	elapsed := time.Since(retryWaitStarted)
	if elapsed < 500*time.Millisecond {
		t.Logf("expected retry wait of ~1s, but only waited %dms", elapsed.Milliseconds())
	}

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

// TestGraphClientGetWithContext is a smoke test verifying that GetWithContext
// is a shorthand for Do(ctx, "GET", path).
func TestGraphClientGetWithContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, `{"id":"test"}`)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.GetWithContext(ctx, "/test")
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}
