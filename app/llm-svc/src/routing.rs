// routing.rs: NLP_MODE policy enforcement (local vs. cloud-proxy routing)

use std::time::Duration;
use tracing::{debug, warn};

/// NlpMode determines which path (local or cloud) to use for LLM operations.
/// This is the key policy for Brain integration (§3.4 of spec).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NlpMode {
    /// Mode 1: cloud_only — all LLM operations proxy to cloud provider
    CloudOnly = 1,

    /// Mode 2: cloud_with_local_preprocess (default) —
    /// pre-processing (DetectIntent, query NER, Compress) runs locally,
    /// extraction and generation proxy to cloud (with fallback to cloud on local error)
    CloudWithLocalPreprocess = 2,

    /// Mode 3: local_only —
    /// all LLM operations run locally (no cloud calls), fail-closed
    LocalOnly = 3,
}

impl NlpMode {
    /// Parse from integer (1, 2, 3) or string name
    pub fn from_env(val: &str) -> Result<Self, String> {
        match val.trim() {
            "1" | "cloud_only" => Ok(NlpMode::CloudOnly),
            "2" | "cloud_with_local_preprocess" => Ok(NlpMode::CloudWithLocalPreprocess),
            "3" | "local_only" => Ok(NlpMode::LocalOnly),
            _ => Err(format!("Invalid NLP_MODE: {}", val)),
        }
    }

    /// Check if this mode requires local models
    #[allow(dead_code)]
    pub fn requires_local_models(self) -> bool {
        matches!(self, NlpMode::CloudWithLocalPreprocess | NlpMode::LocalOnly)
    }

    /// Check if this mode allows cloud fallback
    #[allow(dead_code)]
    pub fn allows_cloud_fallback(self) -> bool {
        matches!(self, NlpMode::CloudWithLocalPreprocess)
    }

    /// Check if cloud is required in this mode
    #[allow(dead_code)]
    pub fn requires_cloud(self) -> bool {
        matches!(self, NlpMode::CloudOnly)
    }
}

impl Default for NlpMode {
    fn default() -> Self {
        NlpMode::CloudOnly
    }
}

/// RetryPolicy configures exponential backoff for transient failures
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// max_attempts: maximum number of retry attempts (default 3)
    pub max_attempts: u32,
    /// base_delay_ms: base delay in milliseconds (default 1000)
    pub base_delay_ms: u64,
    /// max_delay_ms: maximum delay in milliseconds (default 32000)
    pub max_delay_ms: u64,
    /// jitter: whether to add random jitter to delays
    pub jitter: bool,
}

impl RetryPolicy {
    /// Create a new retry policy with defaults
    pub fn new() -> Self {
        RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 1000,
            max_delay_ms: 32000,
            jitter: true,
        }
    }

    /// Get delay for attempt N (0-indexed)
    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        if attempt >= self.max_attempts {
            return Duration::ZERO;
        }

        // Exponential backoff: base_delay * 2^attempt
        let mut delay_ms = self.base_delay_ms * (1 << attempt);
        delay_ms = delay_ms.min(self.max_delay_ms);

        // Add jitter if enabled
        if self.jitter {
            let jitter_range = delay_ms / 4; // ±25%
            let jitter = (std::process::id() as u64 ^ attempt as u64) % jitter_range;
            delay_ms = (delay_ms - jitter_range / 2 + jitter).max(self.base_delay_ms / 2);
        }

        Duration::from_millis(delay_ms)
    }
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self::new()
    }
}

/// RouteDecision determines where to route an operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteDecision {
    /// Route to cloud LLM provider
    Cloud,
    /// Route to local model
    Local,
    /// Error: cannot route (e.g., local required but no local model configured)
    Error,
}

/// Router implements NLP_MODE routing logic
#[derive(Clone)]
pub struct Router {
    mode: NlpMode,
    retry_policy: RetryPolicy,
    has_local_models: bool,
    has_cloud_config: bool,
}

impl Router {
    /// Create a new router
    pub fn new(mode: NlpMode, has_local_models: bool, has_cloud_config: bool) -> Self {
        Router {
            mode,
            retry_policy: RetryPolicy::new(),
            has_local_models,
            has_cloud_config,
        }
    }

    /// Decide where to route an operation
    pub fn route(&self, task: &str) -> RouteDecision {
        debug!("routing decision: mode={:?}, task={}", self.mode, task);

        match self.mode {
            NlpMode::CloudOnly => {
                if self.has_cloud_config {
                    RouteDecision::Cloud
                } else {
                    warn!("CloudOnly mode but no cloud config; returning error");
                    RouteDecision::Error
                }
            }

            NlpMode::CloudWithLocalPreprocess => {
                // Preprocess tasks (intent, NER, compress) prefer local;
                // generation/extraction prefer cloud with local fallback
                match task {
                    "detect_intent" | "query_ner" | "compress" => {
                        if self.has_local_models {
                            RouteDecision::Local
                        } else if self.has_cloud_config {
                            debug!("local not available for {}, falling back to cloud", task);
                            RouteDecision::Cloud
                        } else {
                            RouteDecision::Error
                        }
                    }
                    "extract_entities" | "generate" => {
                        if self.has_cloud_config {
                            RouteDecision::Cloud
                        } else if self.has_local_models {
                            debug!("cloud not available for {}, falling back to local", task);
                            RouteDecision::Local
                        } else {
                            RouteDecision::Error
                        }
                    }
                    "embed" | "rerank" => {
                        // Reranking/embedding prefer local (ONNX); fallback to cloud if available
                        if self.has_local_models {
                            RouteDecision::Local
                        } else if self.has_cloud_config {
                            debug!("local not available for {}, falling back to cloud", task);
                            RouteDecision::Cloud
                        } else {
                            RouteDecision::Error
                        }
                    }
                    _ => RouteDecision::Cloud, // Default to cloud
                }
            }

            NlpMode::LocalOnly => {
                if self.has_local_models {
                    RouteDecision::Local
                } else {
                    warn!("LocalOnly mode but no local models available; failing closed");
                    RouteDecision::Error
                }
            }
        }
    }

    /// Get the retry policy (for implementing exponential backoff)
    pub fn retry_policy(&self) -> &RetryPolicy {
        &self.retry_policy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nlp_mode_from_env() {
        assert_eq!(NlpMode::from_env("1").unwrap(), NlpMode::CloudOnly);
        assert_eq!(
            NlpMode::from_env("cloud_only").unwrap(),
            NlpMode::CloudOnly
        );
        assert_eq!(
            NlpMode::from_env("2").unwrap(),
            NlpMode::CloudWithLocalPreprocess
        );
        assert_eq!(
            NlpMode::from_env("cloud_with_local_preprocess").unwrap(),
            NlpMode::CloudWithLocalPreprocess
        );
        assert_eq!(NlpMode::from_env("3").unwrap(), NlpMode::LocalOnly);
        assert_eq!(NlpMode::from_env("local_only").unwrap(), NlpMode::LocalOnly);
        assert!(NlpMode::from_env("invalid").is_err());
    }

    #[test]
    fn test_requires_local_models() {
        assert!(!NlpMode::CloudOnly.requires_local_models());
        assert!(NlpMode::CloudWithLocalPreprocess.requires_local_models());
        assert!(NlpMode::LocalOnly.requires_local_models());
    }

    #[test]
    fn test_allows_cloud_fallback() {
        assert!(!NlpMode::CloudOnly.allows_cloud_fallback());
        assert!(NlpMode::CloudWithLocalPreprocess.allows_cloud_fallback());
        assert!(!NlpMode::LocalOnly.allows_cloud_fallback());
    }

    #[test]
    fn test_router_cloud_only() {
        let router = Router::new(NlpMode::CloudOnly, false, true);
        assert_eq!(router.route("detect_intent"), RouteDecision::Cloud);
        assert_eq!(router.route("generate"), RouteDecision::Cloud);

        let router_no_cloud = Router::new(NlpMode::CloudOnly, false, false);
        assert_eq!(router_no_cloud.route("detect_intent"), RouteDecision::Error);
    }

    #[test]
    fn test_router_local_only() {
        let router = Router::new(NlpMode::LocalOnly, true, false);
        assert_eq!(router.route("detect_intent"), RouteDecision::Local);
        assert_eq!(router.route("generate"), RouteDecision::Local);

        let router_no_local = Router::new(NlpMode::LocalOnly, false, false);
        assert_eq!(router_no_local.route("detect_intent"), RouteDecision::Error);
    }

    #[test]
    fn test_retry_policy() {
        let policy = RetryPolicy::new();
        // First attempt is base_delay_ms (1000) +/- 25% jitter, per delay_for_attempt's
        // `delay_ms - jitter_range/2 + jitter` formula — never exactly 1000 when jitter
        // is enabled (the default), so assert the intended range instead of equality.
        let delay_0 = policy.delay_for_attempt(0);
        assert!(delay_0.as_millis() >= 875 && delay_0.as_millis() <= 1125);
        // Second attempt should be ~2000ms (with jitter)
        let delay_1 = policy.delay_for_attempt(1);
        assert!(delay_1.as_millis() >= 1000 && delay_1.as_millis() <= 3000);
        // Max attempts should return 0
        assert_eq!(policy.delay_for_attempt(3), Duration::ZERO);
    }
}
