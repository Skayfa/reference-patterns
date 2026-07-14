//! The agent loop, tested deterministically against a scripted mock LLM —
//! no network, no Ollama, no model download.

use std::cell::RefCell;
use std::collections::VecDeque;

use serde_json::{json, Value};

use ollama_tool_calling::{
    Agent, AgentError, ChatRequest, ChatResponse, FunctionCall, LlmClient, LlmError, Message, Role,
    Tool, ToolCall, ToolError, ToolRegistry,
};

/// Returns queued responses in order and records every request it received,
/// so a test can assert on what the agent sent back to the model.
struct MockClient {
    scripted: RefCell<VecDeque<ChatResponse>>,
    seen: RefCell<Vec<ChatRequest>>,
}

impl MockClient {
    fn new(responses: Vec<ChatResponse>) -> Self {
        Self {
            scripted: RefCell::new(responses.into()),
            seen: RefCell::new(Vec::new()),
        }
    }
}

impl LlmClient for MockClient {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse, LlmError> {
        self.seen.borrow_mut().push(request.clone());
        self.scripted
            .borrow_mut()
            .pop_front()
            .ok_or_else(|| LlmError("mock: no scripted response left".to_string()))
    }
}

fn assistant_text(text: &str) -> ChatResponse {
    ChatResponse {
        message: Message {
            role: Role::Assistant,
            content: text.to_string(),
            tool_calls: Vec::new(),
        },
    }
}

fn assistant_tool_call(name: &str, arguments: Value) -> ChatResponse {
    ChatResponse {
        message: Message {
            role: Role::Assistant,
            content: String::new(),
            tool_calls: vec![ToolCall {
                function: FunctionCall { name: name.to_string(), arguments },
            }],
        },
    }
}

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
            "properties": {
                "a": {"type": "integer"},
                "b": {"type": "integer"}
            },
            "required": ["a", "b"]
        })
    }
    fn call(&self, args: Value) -> Result<String, ToolError> {
        let a = args["a"].as_i64().ok_or_else(|| ToolError("missing integer a".into()))?;
        let b = args["b"].as_i64().ok_or_else(|| ToolError("missing integer b".into()))?;
        Ok((a + b).to_string())
    }
}

fn registry_with_add() -> ToolRegistry {
    let mut registry = ToolRegistry::new();
    registry.register(Box::new(Add));
    registry
}

#[test]
fn calls_tool_then_returns_final_answer() {
    let client = MockClient::new(vec![
        assistant_tool_call("add", json!({"a": 2, "b": 3})),
        assistant_text("The sum is 5."),
    ]);
    let agent = Agent::new("test-model", registry_with_add());

    let answer = agent.run(&client, "what is 2 + 3?").unwrap();
    assert!(answer.contains('5'), "answer was: {answer}");

    // Second request must carry a tool-role message with the computed result.
    let seen = client.seen.borrow();
    assert_eq!(seen.len(), 2);
    let tool_msg = seen[1]
        .messages
        .iter()
        .find(|m| m.role == Role::Tool)
        .expect("second request should include a tool result");
    assert_eq!(tool_msg.content, "5");
}

#[test]
fn returns_directly_when_no_tool_call() {
    let client = MockClient::new(vec![assistant_text("Paris.")]);
    let agent = Agent::new("test-model", registry_with_add());

    let answer = agent.run(&client, "capital of France?").unwrap();
    assert_eq!(answer, "Paris.");
    assert_eq!(client.seen.borrow().len(), 1);
}

#[test]
fn unknown_tool_is_reported_back_and_agent_recovers() {
    let client = MockClient::new(vec![
        assistant_tool_call("multiply", json!({"a": 2, "b": 3})), // not registered
        assistant_text("Sorry, I can only add."),
    ]);
    let agent = Agent::new("test-model", registry_with_add());

    let answer = agent.run(&client, "multiply 2 and 3").unwrap();
    assert!(answer.contains("add"));

    // The dispatch error was fed back as a tool result, not a panic or abort.
    let seen = client.seen.borrow();
    let tool_msg = seen[1].messages.iter().find(|m| m.role == Role::Tool).unwrap();
    assert!(tool_msg.content.contains("unknown tool"), "got: {}", tool_msg.content);
}

#[test]
fn caps_iterations_instead_of_looping_forever() {
    // A model that always asks for a tool and never concludes.
    let responses = std::iter::repeat_with(|| assistant_tool_call("add", json!({"a": 1, "b": 1})))
        .take(100)
        .collect();
    let client = MockClient::new(responses);
    let agent = Agent::new("test-model", registry_with_add()).with_max_steps(3);

    let err = agent.run(&client, "loop forever").unwrap_err();
    assert!(matches!(err, AgentError::MaxStepsExceeded { steps: 3 }));
    assert_eq!(client.seen.borrow().len(), 3);
}
