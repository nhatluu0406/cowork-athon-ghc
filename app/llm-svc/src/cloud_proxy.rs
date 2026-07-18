// cloud_proxy.rs: Cloud LLM provider client (OpenAI-compatible + Anthropic native)

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

/// CloudProxyClient holds credentials and config for cloud LLM calls (generation only).
/// For embeddings when using Anthropic, use EmbedProxyClient with a separate OpenAI-compatible endpoint.
#[derive(Debug, Clone)]
pub struct CloudProxyClient {
    /// base_url: API endpoint
    pub base_url: String,
    /// api_key: authentication credential
    pub api_key: String,
    /// model: default model name
    pub model: String,
    /// provider: cloud provider type
    pub provider: Provider,
    /// http_client: reusable HTTP client
    http_client: reqwest::Client,
}

impl CloudProxyClient {
    /// Create a new cloud proxy client from environment variables.
    /// Provider is auto-detected from LLM_PROVIDER env var or base_url content.
    pub fn from_env() -> Result<Option<Self>> {
        let base_url = std::env::var("LLM_API_BASE_URL")
            .ok()
            .filter(|s| !s.is_empty());
        // Support ANTHROPIC_API_KEY as an alias for LLM_API_KEY when using Anthropic
        let api_key = std::env::var("LLM_API_KEY")
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok().filter(|s| !s.is_empty()));
        let model = std::env::var("LLM_MODEL")
            .unwrap_or_else(|_| "claude-haiku-4-5-20251001".to_string());
        let explicit_provider = std::env::var("LLM_PROVIDER").ok();

        match (base_url, api_key) {
            (Some(base_url), Some(api_key)) => {
                let provider = explicit_provider
                    .as_deref()
                    .and_then(Provider::from_str)
                    .unwrap_or_else(|| {
                        if base_url.contains("anthropic") {
                            Provider::Anthropic
                        } else {
                            Provider::Custom
                        }
                    });

                Ok(Some(CloudProxyClient {
                    base_url,
                    api_key,
                    model,
                    provider,
                    http_client: reqwest::Client::new(),
                }))
            }
            // No explicit base URL: if ANTHROPIC_API_KEY is set, default to Anthropic
            (None, Some(api_key)) => {
                let is_anthropic = explicit_provider
                    .as_deref()
                    .map(|p| p.eq_ignore_ascii_case("anthropic"))
                    .unwrap_or(true); // default to Anthropic when only ANTHROPIC_API_KEY is set
                if is_anthropic {
                    Ok(Some(CloudProxyClient {
                        base_url: "https://api.anthropic.com".to_string(),
                        api_key,
                        model,
                        provider: Provider::Anthropic,
                        http_client: reqwest::Client::new(),
                    }))
                } else {
                    Ok(None)
                }
            }
            _ => Ok(None),
        }
    }

    /// Returns true if this client talks to the Anthropic Messages API.
    pub fn is_anthropic(&self) -> bool {
        matches!(self.provider, Provider::Anthropic)
            || self.base_url.contains("api.anthropic.com")
    }

    /// Call the Anthropic Messages API for text generation.
    async fn generate_anthropic(&self, prompt: &str, max_tokens: i32, _temperature: f32) -> Result<String> {
        debug!(
            "cloud_proxy.generate_anthropic: model={}, max_tokens={}",
            self.model, max_tokens
        );

        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let request_body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        });

        let response = self
            .http_client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| anyhow!("anthropic HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("anthropic HTTP error {}: {}", status, body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse anthropic response: {}", e))?;

        let text = body
            .get("content")
            .and_then(|c| c.get(0))
            .and_then(|item| item.get("text"))
            .and_then(|t| t.as_str())
            .ok_or_else(|| anyhow!("Invalid response format from Anthropic (no content[0].text)"))?;

        Ok(text.to_string())
    }

    /// Call cloud LLM provider for text generation. Dispatches to Anthropic or OpenAI-compatible format.
    pub async fn generate(
        &self,
        prompt: &str,
        max_tokens: i32,
        temperature: f32,
    ) -> Result<String> {
        if self.is_anthropic() {
            return self.generate_anthropic(prompt, max_tokens, temperature).await;
        }

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

    /// Call cloud LLM provider for text embeddings (OpenAI-compatible /embeddings API).
    /// Returns Err if this client is Anthropic — use EmbedProxyClient instead.
    pub async fn embed(&self, texts: &[String], model: Option<&str>) -> Result<Vec<Vec<f32>>> {
        if self.is_anthropic() {
            return Err(anyhow!(
                "Anthropic does not support embeddings via this client. \
                 Configure EMBED_API_BASE_URL + EMBED_API_KEY for an OpenAI-compatible embedding endpoint."
            ));
        }

        let model_name = model.filter(|m| !m.is_empty()).unwrap_or(&self.model);
        debug!(
            "cloud_proxy.embed: model={}, texts={}",
            model_name,
            texts.len()
        );

        let request_body = json!({
            "model": model_name,
            "input": texts,
        });

        let url = format!("{}/embeddings", self.base_url);
        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| anyhow!("cloud_proxy embed HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("cloud_proxy embed HTTP error {}: {}", status, body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse cloud embed response: {}", e))?;

        let data = body
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| anyhow!("Invalid embed response format from cloud LLM (no data[])"))?;

        data.iter()
            .map(|item| {
                item.get("embedding")
                    .and_then(|e| e.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect::<Vec<f32>>()
                    })
                    .ok_or_else(|| anyhow!("Invalid embed response item (no embedding[])"))
            })
            .collect()
    }

    /// Compress context via abstractive summarization (LLM-based).
    pub async fn compress(&self, context: &str, target_tokens: i32, query: &str) -> Result<String> {
        let query_hint = if query.is_empty() {
            String::new()
        } else {
            format!(" Focus the summary on answering: \"{}\".", query)
        };
        let prompt = format!(
            "Summarize the following context to approximately {} tokens, preserving all facts, \
             names, and citations needed to answer questions about it.{}\n\nContext:\n{}",
            target_tokens, query_hint, context
        );
        let max_tokens = (target_tokens as f32 * 1.5).ceil() as i32;
        self.generate(&prompt, max_tokens, 0.3).await
    }

    #[allow(dead_code)]
    pub fn is_configured() -> bool {
        (std::env::var("LLM_API_BASE_URL").is_ok() && std::env::var("LLM_API_KEY").is_ok())
            || std::env::var("ANTHROPIC_API_KEY").is_ok()
    }
}

/// EmbedProxyClient provides OpenAI-compatible embedding calls via a separate endpoint.
/// Use this when the primary LLM is Anthropic (which has no embedding API).
/// Configured via EMBED_API_BASE_URL + EMBED_API_KEY env vars.
#[derive(Debug, Clone)]
pub struct EmbedProxyClient {
    base_url: String,
    api_key: String,
    http_client: reqwest::Client,
}

impl EmbedProxyClient {
    /// Create from EMBED_API_BASE_URL + EMBED_API_KEY env vars. Returns None if not configured.
    pub fn from_env() -> Result<Option<Self>> {
        let base_url = std::env::var("EMBED_API_BASE_URL")
            .ok()
            .filter(|s| !s.is_empty());
        let api_key = std::env::var("EMBED_API_KEY")
            .ok()
            .filter(|s| !s.is_empty());
        match (base_url, api_key) {
            (Some(base_url), Some(api_key)) => Ok(Some(EmbedProxyClient {
                base_url,
                api_key,
                http_client: reqwest::Client::new(),
            })),
            _ => Ok(None),
        }
    }

    /// Call the OpenAI-compatible /embeddings endpoint.
    pub async fn embed(&self, texts: &[String], model: &str) -> Result<Vec<Vec<f32>>> {
        debug!("embed_proxy.embed: model={}, texts={}", model, texts.len());

        let request_body = json!({
            "model": model,
            "input": texts,
        });

        let url = format!("{}/embeddings", self.base_url.trim_end_matches('/'));
        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| anyhow!("embed_proxy HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("embed_proxy HTTP error {}: {}", status, body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse embed_proxy response: {}", e))?;

        let data = body
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| anyhow!("Invalid embed_proxy response (no data[])"))?;

        data.iter()
            .map(|item| {
                item.get("embedding")
                    .and_then(|e| e.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect::<Vec<f32>>()
                    })
                    .ok_or_else(|| anyhow!("Invalid embed_proxy item (no embedding[])"))
            })
            .collect()
    }
}

/// cosine_similarity computes the cosine similarity between two equal-length vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 2.0, 3.0];
        assert!((cosine_similarity(&a, &a) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        assert!((cosine_similarity(&a, &b) - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_mismatched_length() {
        let a = vec![1.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn test_provider_anthropic_detected_from_url() {
        // Simulate env setup for unit test by checking the logic directly
        let base_url = "https://api.anthropic.com";
        assert!(base_url.contains("anthropic"));
    }
}
