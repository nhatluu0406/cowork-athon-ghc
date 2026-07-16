package api

import (
	"log/slog"
	"net/http"
)

type Router struct {
	mux *http.ServeMux
}

func NewRouter() *Router {
	return &Router{mux: http.NewServeMux()}
}

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
	r.mux.Handle(pattern, loggingMiddlewareHandler(h))
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// CORS middleware
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if req.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	r.mux.ServeHTTP(w, req)
}

func loggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slog.InfoContext(r.Context(), "request", "method", r.Method, "path", r.URL.Path)
		next(w, r)
	}
}

func loggingMiddlewareHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.InfoContext(r.Context(), "request", "method", r.Method, "path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
