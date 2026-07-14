//! The LLM behind a trait: `OllamaClient` for real runs, and any mock in
//! tests. The client is pure transport — the agent decides the model and
//! builds the request.

use std::fmt;

use crate::protocol::{ChatRequest, ChatResponse};

#[derive(Debug)]
pub struct LlmError(pub String);

impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for LlmError {}

/// One blocking chat round-trip. The seam that makes the agent testable
/// without a network or a running model.
pub trait LlmClient {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse, LlmError>;
}

/// Talks to a local Ollama server (`ollama serve`, default port 11434).
/// Free, local, no API key. Blocking `ureq` keeps the call a single
/// expression; swap it for async `reqwest` in production — the trait is
/// unchanged.
pub struct OllamaClient {
    base_url: String,
}

impl OllamaClient {
    pub fn new() -> Self {
        Self { base_url: "http://localhost:11434".to_string() }
    }

    /// Point at another OpenAI-compatible-ish server (LM Studio, a remote
    /// Ollama, ...). The `/api/chat` path is Ollama-specific.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }
}

impl Default for OllamaClient {
    fn default() -> Self {
        Self::new()
    }
}

impl LlmClient for OllamaClient {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse, LlmError> {
        let url = format!("{}/api/chat", self.base_url);
        let mut response = ureq::post(&url)
            .send_json(request)
            .map_err(|e| LlmError(e.to_string()))?;
        response
            .body_mut()
            .read_json::<ChatResponse>()
            .map_err(|e| LlmError(e.to_string()))
    }
}
