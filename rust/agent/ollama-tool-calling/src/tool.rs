//! The tool abstraction: an object-safe `Tool` trait and a registry the
//! agent loop dispatches against.

use std::collections::HashMap;
use std::fmt;

use serde_json::Value;

use crate::protocol::{FunctionSpec, ToolSpec};

#[derive(Debug)]
pub struct ToolError(pub String);

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for ToolError {}

/// A callable the model can invoke. Object-safe on purpose: the registry
/// holds `Box<dyn Tool>`, so an app adds tools without touching an enum.
pub trait Tool {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    /// JSON Schema for the arguments object.
    fn parameters(&self) -> Value;
    fn call(&self, args: Value) -> Result<String, ToolError>;
}

#[derive(Default)]
pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) -> &mut Self {
        self.tools.insert(tool.name().to_string(), tool);
        self
    }

    /// The tool definitions sent to the model on every request.
    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools
            .values()
            .map(|t| ToolSpec {
                kind: "function",
                function: FunctionSpec {
                    name: t.name().to_string(),
                    description: t.description().to_string(),
                    parameters: t.parameters(),
                },
            })
            .collect()
    }

    pub fn dispatch(&self, name: &str, args: Value) -> Result<String, ToolError> {
        match self.tools.get(name) {
            Some(tool) => tool.call(args),
            None => Err(ToolError(format!("unknown tool: {name}"))),
        }
    }
}
