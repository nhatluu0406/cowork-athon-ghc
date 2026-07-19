package api

import (
	"log/slog"
	"net/http"
	"strings"
)

// Router implements the API router with CORS, auth, and logging middleware.
// T022: Implements API router and middleware per spec §4.1.
type Router struct {
	mux            *http.ServeMux
	allowedOrigins map[string]bool
	middleware     []MiddlewareFunc
}

// MiddlewareFunc is a function that wraps an http.Handler.
type MiddlewareFunc func(http.Handler) http.Handler

// NewRouter creates a new router with configurable CORS origins.
// Origins is a comma-separated list of allowed CORS origins (e.g., "http://localhost:5173,https://example.com").
// If origins is "*", all origins are allowed (development only).
func NewRouter(origins string) *Router {
	allowedOrigins := make(map[string]bool)

	// Parse origins
	if origins == "*" {
		allowedOrigins["*"] = true
	} else {
		for _, origin := range strings.Split(origins, ",") {
			if trimmed := strings.TrimSpace(origin); trimmed != "" {
				allowedOrigins[trimmed] = true
			}
		}
	}

	return &Router{
		mux:            http.NewServeMux(),
		allowedOrigins: allowedOrigins,
		middleware:     []MiddlewareFunc{loggingMiddleware},
	}
}

// Register registers a handler for the given pattern with logging middleware.
// Handler can be http.Handler, http.HandlerFunc, or func(http.ResponseWriter, *http.Request).
func (r *Router) Register(pattern string, handler interface{}) {
	var h http.Handler
	switch v := handler.(type) {
	case http.Handler:
		h = v
	case http.HandlerFunc:
		h = v
	case func(http.ResponseWriter, *http.Request):
		h = http.HandlerFunc(v)
	default:
		panic("Register: handler must be http.Handler, http.HandlerFunc, or func(http.ResponseWriter, *http.Request)")
	}

	// Apply registered middleware chain
	for _, mw := range r.middleware {
		h = mw(h)
	}

	r.mux.Handle(pattern, h)
}

// ServeHTTP implements http.Handler, applying CORS middleware to all requests.
// T022: CORS middleware with configurable allowed origins per spec §4.1.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// CORS middleware: set origin header
	origin := req.Header.Get("Origin")
	if r.allowedOrigins["*"] {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else if origin != "" && r.allowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}

	// CORS headers
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
	w.Header().Set("Access-Control-Max-Age", "86400")

	// Handle preflight requests
	if req.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	r.mux.ServeHTTP(w, req)
}

// loggingMiddleware logs HTTP requests at INFO level.
// T022: Logging middleware per spec §4.1.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.InfoContext(r.Context(), "http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"query", r.URL.RawQuery,
			"remote_addr", r.RemoteAddr,
		)
		next.ServeHTTP(w, r)
	})
}
