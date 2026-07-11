// cloud_proxy.rs: Cloud LLM provider client (OpenAI-compatible)

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tracing::debug;

/// CloudLlmProvider specifies the cloud LLM provider to use
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    Azure,
    Anthropic,
    Custom,
}

impl Provider {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "openai" => Some(Provider::OpenAi),
            "azure" => Some(Provider::Azure),
            "anthropic" => Some(Provider::Anthropic),
            "custom" => Some(Provider::Custom),
            _ => None,
        }
    }
}

/// CloudProxyClient holds credentials and config for cloud LLM calls
#[derive(Debug, Clone)]
pub struct CloudProxyClient {
    /// base_url: API endpoint (e.g., "https://mkp-api.fptcloud.com/v1")
    pub base_url: String,
    /// api_key: authentication credential
    pub api_key: String,
    /// model: default model name (e.g., "gpt-4o-mini")
    pub model: String,
    /// provider: cloud provider type
    pub provider: Provider,
    /// http_client: reusable HTTP client
    http_client: reqwest::Client,
}

impl CloudProxyClient {
    /// Create a new cloud proxy client from environment variables
    pub fn from_env() -> Result<Option<Self>> {
        let base_url = std::env::var("LLM_API_BASE_URL")
            .ok()
            .filter(|s| !s.is_empty());
        let api_key = std::env::var("LLM_API_KEY")
            .ok()
            .filter(|s| !s.is_empty());
        let model = std::env::var("LLM_MODEL")
            .unwrap_or_else(|_| "gpt-4o-mini".to_string());

        match (base_url, api_key) {
            (Some(base_url), Some(api_key)) => {
                let provider = Provider::from_str(&base_url)
                    .unwrap_or(Provider::Custom);

                Ok(Some(CloudProxyClient {
                    base_url,
                    api_key,
                    model,
                    provider,
                    http_client: reqwest::Client::new(),
                }))
            }
            _ => Ok(None),
        }
    }

    /// Call cloud LLM provider for text generation (OpenAI-compatible API)
    pub async fn generate(
        &self,
        prompt: &str,
        max_tokens: i32,
        temperature: f32,
    ) -> Result<String> {
        debug!(
            "cloud_proxy.generate: model={}, max_tokens={}",
            self.model, max_tokens
        );

        // OpenAI-compatible request format
        let request_body = json!({
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": false
        });

        let url = format!("{}/chat/completions", self.base_url);
        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| anyhow!("cloud_proxy HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "cloud_proxy HTTP error {}: {}",
                status,
                body
            ));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse cloud response: {}", e))?;

        // Extract answer from OpenAI-compatible response
        let answer = body
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|content| content.as_str())
            .ok_or_else(|| anyhow!("Invalid response format from cloud LLM"))?;

        Ok(answer.to_string())
    }

    /// Call cloud LLM provider for entity extraction
    pub async fn extract(&self, text: &str) -> Result<(Vec<String>, Vec<(String, String)>)> {
        let prompt = format!(
            "Extract named entities from the following text. \
             Return a JSON object with 'entities' (list of strings) and 'relationships' (list of [from, type, to] triples).\n\n{}",
            text
        );

        let response = self.generate(&prompt, 1024, 0.7).await?;

        // Try to parse as JSON, with fallback to simple parsing
        if let Ok(parsed) = serde_json::from_str::<Value>(&response) {
            let entities = parsed
                .get("entities")
                .and_then(|e| e.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            let relationships = parsed
                .get("relationships")
                .and_then(|r| r.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            if let Some(trip) = v.as_array() {
                                if trip.len() == 3 {
                                    let from = trip[0].as_str()?;
                                    let rel = trip[1].as_str()?;
                                    let to = trip[2].as_str()?;
                                    return Some((
                                        format!("{} {} {}", from, rel, to),
                                        rel.to_string(),
                                    ));
                                }
                            }
                            None
                        })
                        .collect()
                })
                .unwrap_or_default();

            return Ok((entities, relationships));
        }

        // Fallback: extract simple entity list from response text
        let entities: Vec<String> = response
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok((entities, vec![]))
    }

    /// Call cloud LLM provider for intent detection
    pub async fn detect_intent(&self, query: &str) -> Result<String> {
        let prompt = format!(
            "Classify the following query intent. \
             Respond with ONLY one of: find_expert, find_document, find_project_info, find_technology_usage, general_question\n\n{}",
            query
        );

        let response = self.generate(&prompt, 32, 0.7).await?;
        Ok(response.trim().to_string())
    }

    /// Detect if cloud proxy is configured
    pub fn is_configured() -> bool {
        std::env::var("LLM_API_BASE_URL").is_ok() && std::env::var("LLM_API_KEY").is_ok()
    }
}
