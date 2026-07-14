---
name: react-call-confirm
language: typescript
category: react
tags: [react, react-call, dialogs, promises, testing-library, vitest]
description: Awaitable UI with react-call — a Confirm dialog you await like a function, and how to test promise-resolving components with Testing Library
test: pnpm install --silent && pnpm test
---

# Awaitable confirm dialog with react-call

Library: [react-call](https://react-call.desko.dev/) (1 KB, no dependencies).

## Problem

A confirm dialog forces every caller to own dialog state: an `isOpen`
boolean, a "pending action" ref, and callbacks wired through props or
context — for what is conceptually a single question with an answer.

## Solution

`createCallable` turns the component into a function you `await`:

- **`src/confirm.tsx`** — `createCallable<ConfirmProps, ConfirmResponse>`
  receives `{ call, ...props }`; the component answers with
  `call.end(true | false)`, which resolves the caller's promise.
- **Mounting** — the callable **is** the root component: render `<Confirm />`
  once near the app root. (`Confirm.Root` still exists but is a deprecated
  alias of the same function.)
- **`src/delete-button.tsx`** — imperative usage:
  `if (await Confirm.call({ message })) onDelete()`. No dialog state anywhere.
- **`tests/confirm.test.tsx`** — the testing pattern: render `<Confirm />`,
  trigger `Confirm.call()` inside `act()`, drive the dialog with
  `user-event`, then assert on the awaited promise value.

## Key points

- `Confirm.call()` updates the mounted root from outside React — in tests,
  wrap the call in `act()` or React warns and state updates are missed.
- Concurrent calls **stack**: each `.call()` renders its own instance
  (newer below), and each promise settles independently — the `call` prop
  exposes `index` / `stackSize` if the UI needs them.
- The caller can drive an open call: `Confirm.end(promise, false)`,
  `Confirm.update(promise, props)`, or `Toast.upsert(props)` for
  singleton-style callables.
- Exit animations: pass `unmountingDelay` (ms) as the second argument to
  `createCallable` and style on `call.ended` during that window.
- `Response` is enforced by types: `call.end()` requires a value of the
  declared response type, so a dialog cannot "close without answering"
  unless the type says so.
- Test setup worth copying: `environment: "jsdom"` + `globals: true` (gives
  Testing Library its auto-cleanup `afterEach`) + jest-dom matchers loaded
  via `setupFiles`.

## How to run

```bash
pnpm install && pnpm test
```
