//! A real run against a local Ollama server.
//!
//! Prerequisites: `ollama serve` running, and a tool-capable model pulled,
//! e.g. `ollama pull llama3.1`.
//!
//! Run: `cargo run --example calculator`
//!
//! This target is compiled by `cargo test` (so it can't rot) but never
//! executed by the test suite — it needs a live model.

use ollama_tool_calling::{Agent, OllamaClient, Tool, ToolError, ToolRegistry};
use serde_json::{json, Value};

struct Add;
impl Tool for Add {
    fn name(&self) -> &str {
        "add"
    }
    fn description(&self) -> &str {
        "Add two integers a and b."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
            "required": ["a", "b"]
        })
    }
    fn call(&self, args: Value) -> Result<String, ToolError> {
        let a = args["a"].as_i64().ok_or_else(|| ToolError("missing a".into()))?;
        let b = args["b"].as_i64().ok_or_else(|| ToolError("missing b".into()))?;
        Ok((a + b).to_string())
    }
}

struct Multiply;
impl Tool for Multiply {
    fn name(&self) -> &str {
        "multiply"
    }
    fn description(&self) -> &str {
        "Multiply two integers a and b."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
            "required": ["a", "b"]
        })
    }
    fn call(&self, args: Value) -> Result<String, ToolError> {
        let a = args["a"].as_i64().ok_or_else(|| ToolError("missing a".into()))?;
        let b = args["b"].as_i64().ok_or_else(|| ToolError("missing b".into()))?;
        Ok((a * b).to_string())
    }
}

fn main() {
    let mut registry = ToolRegistry::new();
    registry.register(Box::new(Add));
    registry.register(Box::new(Multiply));

    let agent = Agent::new("llama3.1", registry)
        .with_system("You are a calculator. Use the tools to compute exact results.");

    match agent.run(&OllamaClient::new(), "Take 2 plus 3, then multiply the result by 4.") {
        Ok(answer) => println!("{answer}"),
        Err(e) => eprintln!("agent error: {e}"),
    }
}
