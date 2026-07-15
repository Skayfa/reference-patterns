---
name: verify-loop
language: rust
category: agent
tags: [rust, ai-agent, verification, self-correction, reliability, retry]
description: Verify-then-retry combinator — check an output against ground truth, feed failures back and retry until it passes or a budget runs out; agent-agnostic, no dependencies
test: cargo test
---

# Verify-then-retry (self-correction against ground truth)

## Problem

An LLM agent (or any fallible generator) confidently returns a wrong answer.
"It looks right" is not "it is right" — and you can't tell the difference by
reading the output. Trusting the producer to check itself doesn't work: it is
exactly as wrong about its verification as about its answer.

## Solution

`src/lib.rs` puts the check in the **caller's harness**, outside the thing
being checked:

- `Verifier` trait + `CommandVerifier` — the ground-truth check (run the
  tests, run the linter, grep the output). Exit 0 = pass; otherwise the
  command's output is the failure detail.
- `solve_verified(attempt, verifier, budget)` — run `attempt`, then verify;
  on failure, feed the check's output into the next `attempt` and retry,
  bounded by `budget`. Returns the answer once the check passes, or
  `NotConverged` — an **honest** failure, not a false success.

`attempt(feedback)` is any closure — a code generator, an agent's run, a data
job — so this composes with anything that has a checkable result.

## Key points

- **The check must live in the harness, not the producer.** A "please verify
  your work" instruction to the producer is not verification — the loop and
  the source of truth for "done" are the caller's.
- **Feed the failure back.** Passing the check's output (compiler error,
  failing assertion) into the next attempt is what turns a retry into a
  *self-correction* instead of a blind re-roll.
- **Bound it.** A producer that never converges must fail honestly
  (`NotConverged`) rather than loop forever — a budget converts "confidently
  wrong" into "did not pass in N tries", which is strictly more useful.
- **Agent-agnostic by design.** `attempt: FnMut(Option<&str>) -> String`
  means the same loop wraps an LLM agent, a codegen step, or an ETL job.
- This is the single biggest reliability lever for agents: don't make the
  model more trustworthy, make its output *checkable*.

## How to run

```bash
cargo test
```
