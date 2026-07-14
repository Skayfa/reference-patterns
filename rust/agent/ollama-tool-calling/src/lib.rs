//! A minimal AI agent with tool-calling, backed by a local (free) Ollama
//! model. The LLM sits behind the [`LlmClient`] trait, so the agent loop
//! is exercised in tests with a scripted mock — no network, no model.
//!
//! ```no_run
//! use ollama_tool_calling::{Agent, OllamaClient, ToolRegistry};
//!
//! let agent = Agent::new("llama3.1", ToolRegistry::new());
//! let answer = agent.run(&OllamaClient::new(), "Hello!")?;
//! println!("{answer}");
//! # Ok::<(), ollama_tool_calling::AgentError>(())
//! ```

pub mod agent;
pub mod client;
pub mod protocol;
pub mod tool;

pub use agent::{Agent, AgentError};
pub use client::{LlmClient, LlmError, OllamaClient};
pub use protocol::{ChatRequest, ChatResponse, FunctionCall, Message, Role, ToolCall};
pub use tool::{Tool, ToolError, ToolRegistry};
