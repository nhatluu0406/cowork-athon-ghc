package common

import (
	"context"
	"log/slog"
	"os"
)

var logger *slog.Logger

func InitLogger(environment string) {
	level := slog.LevelInfo
	if environment == "development" {
		level = slog.LevelDebug
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	// Use JSON handler for structured logging
	handler := slog.NewJSONHandler(os.Stdout, opts)
	logger = slog.New(handler)
	slog.SetDefault(logger)
}

func GetLogger() *slog.Logger {
	return logger
}

func LogInfo(ctx context.Context, msg string, args ...any) {
	if logger != nil {
		logger.InfoContext(ctx, msg, args...)
	}
}

func LogError(ctx context.Context, msg string, err error, args ...any) {
	if logger != nil {
		logArgs := append([]any{"error", err.Error()}, args...)
		logger.ErrorContext(ctx, msg, logArgs...)
	}
}

func LogDebug(ctx context.Context, msg string, args ...any) {
	if logger != nil {
		logger.DebugContext(ctx, msg, args...)
	}
}

func LogWarn(ctx context.Context, msg string, args ...any) {
	if logger != nil {
		logger.WarnContext(ctx, msg, args...)
	}
}
