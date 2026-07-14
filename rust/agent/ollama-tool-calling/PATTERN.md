---
name: ollama-tool-calling
language: rust
category: agent
tags: [rust, ai-agent, tool-calling, ollama, llm, function-calling]
description: A minimal AI agent with tool-calling in Rust against a local (free) Ollama model — the tool-use loop behind a trait, tested deterministically with a scripted mock (no network, no model)
test: cargo test && cargo build --examples
---

# AI agent with tool-calling (Rust, local Ollama)

## Problem

"Let an LLM call my functions" needs an agent loop: send the model a prompt
plus tool definitions, it replies with a tool call, you run the tool, feed
the result back, and repeat until it answers. Two things usually go wrong in
a reference: it's pinned to a paid cloud API (needs a key, can't run in CI),
and the loop is untestable because it talks to a real model.

## Solution

Free and local: the model is **Ollama** (`ollama serve`, no API key). Its
`/api/chat` tool-calling shape *is* the OpenAI function-calling shape, so the
protocol is the canonical one.

- **`src/protocol.rs`** — serde types for the wire format (`Message`,
  `ToolCall`, `ToolSpec`, `ChatRequest`/`ChatResponse`).
- **`src/tool.rs`** — an object-safe `Tool` trait (`name` / `description` /
  `parameters` JSON Schema / `call`) and a `ToolRegistry`.
- **`src/client.rs`** — the LLM behind an `LlmClient` trait; `OllamaClient`
  is a thin blocking `ureq` POST.
- **`src/agent.rs`** — the loop: request → if the reply has `tool_calls`,
  dispatch each and push a `tool` message with the result, repeat; else
  return the text. Bounded by `max_steps`.
- **`tests/agent_loop.rs`** — a scripted `MockClient` (impl of `LlmClient`)
  drives the loop with **no network and no Ollama**: tool-call → result →
  final answer, the no-tool path, an unknown-tool recovery, and the
  step-cap.

## Key points

- **The trait is the seam.** `OllamaClient` runs it for real; a scripted
  `MockClient` makes the loop deterministic in tests — the HTTP client
  choice never touches test behavior. Same reason the client is pure
  transport (the agent owns the model and builds the request).
- **Bounded loop.** Never trust the model to stop: cap iterations and return
  `MaxStepsExceeded` rather than spinning forever.
- **Tool errors are fed back, not fatal.** A failed or unknown tool becomes
  a `tool` result message the model can read and retry from — one bad call
  doesn't kill the task. The step cap still bounds the recovery attempts.
- **Object-safe `Tool` trait, not an enum.** Apps register `Box<dyn Tool>`
  without editing a central enum; `parameters()` returns the JSON Schema the
  model sees.
- **Blocking `ureq`, no async runtime.** The loop reads top-to-bottom
  without `#[tokio::main]`/`.await`. Production wanting streaming or
  concurrency swaps `ureq` for `reqwest` + `tokio` — the `LlmClient` trait
  is unchanged.
- **No `-race` flag needed** (unlike the Go pattern): Rust's ownership model
  rules out data races at compile time.
- **Portable.** Ollama's shape mirrors OpenAI function-calling, so pointing
  `OllamaClient::with_base_url` (and the path) at another server reaches
  OpenAI-compatible backends.

## How to run

```bash
cargo test && cargo build --examples   # deterministic, no Ollama needed

# Real run: needs a tool-capable model
ollama pull llama3.1
cargo run --example calculator
```
