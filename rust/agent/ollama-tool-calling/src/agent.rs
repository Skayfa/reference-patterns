//! The tool-calling loop: ask the model, run any tools it requests, feed
//! the results back, repeat until it answers — bounded by `max_steps`.

use std::fmt;

use crate::client::{LlmClient, LlmError};
use crate::protocol::{ChatRequest, Message};
use crate::tool::ToolRegistry;

#[derive(Debug)]
pub enum AgentError {
    Llm(LlmError),
    /// The model kept requesting tools past the step budget — a bounded
    /// loop is the guard against a model that never concludes.
    MaxStepsExceeded { steps: usize },
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentError::Llm(e) => write!(f, "llm error: {e}"),
            AgentError::MaxStepsExceeded { steps } => {
                write!(f, "agent did not finish within {steps} steps")
            }
        }
    }
}
impl std::error::Error for AgentError {}

impl From<LlmError> for AgentError {
    fn from(e: LlmError) -> Self {
        AgentError::Llm(e)
    }
}

pub struct Agent {
    model: String,
    system: Option<String>,
    registry: ToolRegistry,
    max_steps: usize,
}

impl Agent {
    pub fn new(model: impl Into<String>, registry: ToolRegistry) -> Self {
        Self { model: model.into(), system: None, registry, max_steps: 8 }
    }

    pub fn with_system(mut self, system: impl Into<String>) -> Self {
        self.system = Some(system.into());
        self
    }

    pub fn with_max_steps(mut self, max_steps: usize) -> Self {
        self.max_steps = max_steps;
        self
    }

    pub fn run(&self, client: &dyn LlmClient, user_prompt: &str) -> Result<String, AgentError> {
        let tools = self.registry.specs();
        let mut messages = Vec::new();
        if let Some(system) = &self.system {
            messages.push(Message::system(system.clone()));
        }
        messages.push(Message::user(user_prompt));

        for _ in 0..self.max_steps {
            let request = ChatRequest {
                model: self.model.clone(),
                messages: messages.clone(),
                tools: tools.clone(),
                stream: false,
            };
            let assistant = client.chat(&request)?.message;
            let tool_calls = assistant.tool_calls.clone();
            messages.push(assistant.clone());

            if tool_calls.is_empty() {
                return Ok(assistant.content);
            }

            for call in tool_calls {
                let result = match self
                    .registry
                    .dispatch(&call.function.name, call.function.arguments)
                {
                    Ok(output) => output,
                    // Hand the error back as a tool result: the model can
                    // read it and retry, rather than the whole task dying.
                    Err(e) => format!("error: {e}"),
                };
                messages.push(Message::tool(result));
            }
        }

        Err(AgentError::MaxStepsExceeded { steps: self.max_steps })
    }
}
