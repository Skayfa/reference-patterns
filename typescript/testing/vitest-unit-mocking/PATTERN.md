---
name: vitest-unit-mocking
language: typescript
category: testing
tags: [vitest, mocking, fixtures, fake-timers, unit-tests]
description: Unit testing with Vitest — module mocks (vi.mock), injected mocks (vi.fn), fixture builders and fake timers
test: pnpm test
---

# Vitest unit testing with mocks

## Problem

A unit under test talks to collaborators (HTTP clients, clocks) that must not run
for real in tests. There are two distinct situations: dependencies imported at
module level, and dependencies passed in as arguments — each calls for a
different mocking style.

## Solution

`src/user-service.ts` has one of each:

- **Module dependency** (`fetchUser`): replaced wholesale with
  `vi.mock("../src/api-client.js")` in `tests/user-service.test.ts`, then typed
  per test with `vi.mocked(...)` + `mockResolvedValue` / `mockRejectedValue`.
- **Injected dependency** (`Clock`): a plain object built around `vi.fn()` —
  no module machinery, just a hand-rolled test double.
- **Fixture builder** (`aUser(overrides)`): one valid default object,
  overridden field-by-field per test, instead of copy-pasted literals.
- **Fake timers**: `vi.useFakeTimers()` + `vi.setSystemTime(...)` freeze
  `new Date()` inside the real `systemClock` implementation.

## Key points

- `vi.mock` is hoisted above imports — a factory must not capture file-level
  variables (use `vi.hoisted` if it has to).
- `vi.mocked(apiClient.fetchUser)` gives the mocked type without `as` casts.
- `vi.resetAllMocks()` in `beforeEach` clears call history AND
  implementations; `vi.clearAllMocks()` only clears history — resetting
  prevents one test's stub from leaking into the next.
- Prefer injecting small collaborators (like `Clock`) over module mocks:
  the test double is explicit and locally scoped. Reach for `vi.mock` when
  the import graph gives you no seam.
- `vi.spyOn(obj, "method")` is the middle ground: wraps a real method,
  records calls, restorable with `mockRestore()`.
- Business logic uses UTC (`getUTCHours`) so tests do not depend on the
  machine's timezone.

## How to run

```bash
pnpm install   # once, at the repo root (pnpm workspace)
pnpm test      # from this directory
```
