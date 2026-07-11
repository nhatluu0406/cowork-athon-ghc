package common

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Host              string
	Port              int
	DBUrl             string
	Neo4jUri          string
	Neo4jUser         string
	Neo4jPass         string
	M365TenantID      string
	M365ClientID      string
	M365ClientSecret  string
	M365AuthMode      string
	LLMAPIBase        string
	LLMModel          string
	LLMEmbedModel     string
	LLMSvcAddr        string        // T175: gRPC address of llm-svc (e.g., "localhost:9090")
	LLMSvcTLS         bool          // T175: enable TLS for llm-svc connection
	LLMSvcCertFile    string        // T175: path to TLS certificate file for llm-svc
	JWTSecret         string
	AllowedOrigins    string
	DeltaSyncInterval time.Duration
	OAuthRedirectURI  string // T184: redirect_uri used for the Entra ID auth-code exchange
	DevLoginUsername  string // T184: optional username/password login fallback (dev/smoke-test only)
	DevLoginPassword  string
}

func LoadConfig() (*Config, error) {
	cfg := &Config{
		Host:              getEnv("HOST", "0.0.0.0"),
		Port:              getEnvInt("PORT", 8080),
		DBUrl:             getEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/m365kg"),
		Neo4jUri:          getEnv("NEO4J_URI", "bolt://localhost:7687"),
		Neo4jUser:         getEnv("NEO4J_USERNAME", "neo4j"),
		Neo4jPass:         getEnv("NEO4J_PASSWORD", ""),
		M365TenantID:      getEnv("M365_TENANT_ID", ""),
		M365ClientID:      getEnv("M365_CLIENT_ID", ""),
		M365ClientSecret:  getEnv("M365_CLIENT_SECRET", ""),
		M365AuthMode:      getEnv("M365_AUTH_MODE", "entra_id"),
		LLMAPIBase:        getEnv("LLM_API_BASE_URL", ""),
		LLMModel:          getEnv("LLM_MODEL", "gpt-4o-mini"),
		LLMEmbedModel:     getEnv("LLM_EMBED_MODEL", "text-embedding-3-small"),
		LLMSvcAddr:        getEnv("LLMSVC_ADDR", ""),           // T175: optional gRPC address
		LLMSvcTLS:         getEnv("LLMSVC_TLS", "false") == "true",
		LLMSvcCertFile:    getEnv("LLMSVC_CERT_FILE", ""),
		JWTSecret:         getEnv("JWT_SECRET", "dev-secret-key"),
		AllowedOrigins:    getEnv("ALLOWED_ORIGINS", "http://localhost:5173"),
		DeltaSyncInterval: getEnvDuration("DELTA_SYNC_INTERVAL", 5*time.Minute),
		OAuthRedirectURI:  getEnv("OAUTH_REDIRECT_URI", ""),
		DevLoginUsername:  getEnv("DEV_LOGIN_USERNAME", ""),
		DevLoginPassword:  getEnv("DEV_LOGIN_PASSWORD", ""),
	}
	return cfg, nil
}

func (c *Config) Validate() error {
	if c.DBUrl == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	if c.Neo4jUri == "" {
		return fmt.Errorf("NEO4J_URI is required")
	}
	// T175: Either LLM_API_BASE_URL or LLMSVC_ADDR should be configured
	// (both are optional, but at least one is needed for embedding/generation).
	if c.LLMAPIBase == "" && c.LLMSvcAddr == "" {
		// Both missing is OK for a development environment without embeddings
		// (semantic search and generation will gracefully degrade to nil/no-op)
	}
	return nil
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}
