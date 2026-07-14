---
name: connect-protovalidate-tanstack
language: fullstack
category: rpc
tags: [go, connectrpc, protobuf, protovalidate, buf, react, tanstack-form, tanstack-query, zod]
description: End-to-end typed RPC with a single validation source — protovalidate rules in the proto enforced by the Go server AND evaluated in the browser (protovalidate-es as a Standard Schema for TanStack Form), TanStack Query over HTTP GET for cacheable reads, and code-driven error handling (server violations mapped back onto form fields, transient-only retries, panic shield) — tested on both sides without a network
test: (cd server && go test ./...) && (cd web && pnpm test)
---

# Typed RPC + validation end to end (Connect, protovalidate, TanStack)

## Problem

A form posting to a Go API usually means three hand-written copies of the
same contract: the request shape (fetch payload), the server validation,
and the client validation — all drifting independently.

## Solution

The proto file is the single source of truth; everything else is generated
or mirrors it:

- **`proto/example/v1/newsletter.proto`** — the contract AND the rules:
  protovalidate annotations (`(buf.validate.field).string.email = true`,
  `min_len: 2`) live next to the fields.
- **`buf.gen.yaml`** — one `buf generate` produces the Go server stubs
  (`server/pb`, plugins `protocolbuffers/go` + `connectrpc/go`) and the
  typed TS client (`web/src/pb`, plugin `bufbuild/es`). Generated code is
  committed so the pattern runs as-is.
- **`server/main.go`** — a Connect server where validation is an
  interceptor (`connectrpc.com/validate`): invalid requests are rejected
  with `invalid_argument` + structured `Violations` details before any
  handler code runs. Handlers contain only business logic.
- **`web/src/form/`** — TanStack Form's recommended **composition**
  pattern: `createFormHookContexts` + `createFormHook` produce an
  app-wide `useAppForm` with pre-bound components (`Form`, `TextField`,
  `SubmitButton`) written once — the `<form>` submit wiring, value/blur/
  change handlers and error display live in the shared components, not in
  every form.
- **`web/src/subscribe-form.tsx`** — the write side, fully declarative:
  `<form.AppField name="email">` + `<field.TextField label="Email" />`.
  TanStack Form owns input state, TanStack Query owns the network state —
  through **connect-query** (`useMutation(NewsletterService.method.subscribe)`):
  no `mutationFn`, no client prop, the transport comes from
  `TransportProvider`. **Validation is unified**:
  `createStandardSchema(SubscribeRequestSchema)` (protovalidate-es)
  evaluates the proto's own CEL rules in the browser as a Standard Schema
  validator, and the form's values are the proto message itself
  (`defaultValues: create(SubscribeRequestSchema)`) — no hand-written
  mirror schema anywhere.
- **`web/src/subscription-status.tsx`** — the read side:
  `useQuery(NewsletterService.method.getSubscription, input)` —
  connect-query derives the cache key from the method descriptor + input,
  so there is no hand-written `queryKey` to keep unique. The proto declares
  the RPC `NO_SIDE_EFFECTS`, so a transport created with `useHttpGet: true`
  sends it as a plain **HTTP GET**, cacheable by browsers and CDNs. `server/main_test.go` proves the
  wire behavior: `Subscribe` travels as POST, `GetSubscription` as GET,
  and protovalidate rules apply to GET requests too.
- **Error handling is code-driven end to end** (`web/src/connect-errors.ts`):
  the RPC code is the error API. Server side, panics are shielded
  (`connect.WithRecover` → logged, generic `internal`) and handlers only
  return `connect.NewError` with deliberate codes. Client side, failures
  split by ownership: protovalidate `Violations` from the error details
  land **under their form fields** (`formApi.setFieldMeta` →
  `errorMap.onServer`), everything else stays in TanStack Query's mutation
  state and renders as one code-mapped user message (`userMessage`) — raw
  RPC messages never reach the DOM. `createQueryClient` retries transient
  codes only, queries only.
- **Tests on both sides, no network**:
  `server/main_test.go` drives the real handler stack through `httptest`
  and asserts the validation table; `web/tests/subscribe-form.test.tsx`
  swaps the transport for `createRouterTransport` — a real Connect service
  running in memory — so serialization and error semantics are exercised
  for real.

## Key points

- **Split server failures by ownership — fully typed, no deadlock**:
  field violations go on each field's `errorMap.onServer` via
  `formApi.setFieldMeta`, together with `errorSourceMap: "form"` — that
  source marker is what lets TanStack Form's validation cycle auto-clear
  the error (and recover `canSubmit`) on the user's next edit. Non-field
  failures stay in the mutation state, which never gates `canSubmit`. The
  violation path is narrowed with a runtime predicate backed by the proto
  descriptor (`SubscribeRequestSchema.fields`), so no cast anywhere.
  Rejected alternatives: `onSubmitAsync` returns only re-validate on the
  next submit (a deadlock behind a `disabled={!canSubmit}` button), and
  `form.setErrorMap({ onServer })` distributes `{form, fields}` at runtime
  but form-core types that slot after a validator that cannot be declared.
- **Retry what is transient, nothing else**: network failures surface as
  `Code.Unknown` in connect-es, so transient = `Unavailable`,
  `DeadlineExceeded`, `ResourceExhausted`, `Unknown` — retried twice, for
  queries only (reads are idempotent; a `Subscribe` is not). `not_found`
  and `invalid_argument` fail fast, which also keeps the error-path tests
  fast with the production QueryClient.
- **Go: a bare `error` returned from a handler reaches the client as code
  `unknown` WITH its message** — always wrap with `connect.NewError` and a
  deliberate code, and keep `WithRecover` so a panic answers a generic
  `internal` instead of leaking internals.
- **Form composition scales, render props don't**: one `TextField` bound
  via `useFieldContext` replaces the per-field boilerplate in every form.
  New forms only declare fields and labels; growing the app's form
  vocabulary means adding a component to `createFormHook`, nothing else.
  The contexts live in their own file (`form-context.ts`) to avoid
  circular imports; `withForm` (exported alongside `useAppForm`) splits
  large forms into typed fragments.

- **One rule set, two runtimes**: the browser evaluates the exact rules
  (and produces the same messages) the Go interceptor enforces, because
  both read them from the proto. The server remains authoritative — the
  last form test proves a server-side rejection still surfaces cleanly
  when the client didn't catch it (rules can drift only until the next
  `buf generate`).
- The unification costs a CEL evaluator in the bundle
  (`@bufbuild/protovalidate`); for tiny forms a hand-written schema may be
  lighter, but every rule then exists twice. Custom error messages belong
  in the proto rules, so both sides stay in sync there too.
- `createRouterTransport` beats mocking `fetch`: you test against actual
  Connect (de)serialization, codes and details, and the same component code
  runs in tests and production — only the `TransportProvider` value changes
  (see `tests/test-utils.tsx`, which also passes partial service impls:
  each test provides only the methods it needs).
- No generated query hooks needed: connect-es v2 service descriptors carry
  their methods (`NewsletterService.method.subscribe`), which connect-query
  consumes directly — one less codegen plugin.
- `mutateAsync` + `.catch(() => undefined)` in `onSubmit`: TanStack Query
  owns the error state (rendered from `mutation.isError`), while awaiting
  keeps `isSubmitting` accurate — without the catch, every server rejection
  is an unhandled promise rejection.
- `include_imports: true` on the `es` plugin generates
  `buf/validate/validate_pb.ts` too — the generated schema imports it. On
  the Go side the managed-mode `disable` keeps the protovalidate dep
  resolving to its published SDK instead.
- **Reads as GET, writes as POST**: mark side-effect-free RPCs with
  `option idempotency_level = NO_SIDE_EFFECTS` and opt in on the client
  (`useHttpGet: true` web-side, `connect.WithHTTPGet()` in Go). connect-go
  serves GET for those methods with no extra server code; methods with
  side effects keep travelling as POST regardless of the option.
- Serving a real browser (not tests) requires CORS on the Go server —
  `connectrpc.com/cors` — and h2c only if plaintext gRPC clients connect.
- Field paths in the `Violations` error details allow mapping server
  rejections back onto individual form fields (left as an extension).

## How to run

```bash
pnpm install                      # once, at the repo root
(cd server && go test ./...)      # server: validation table through httptest
(cd web && pnpm test)             # form: in-memory Connect service
(cd server && go run .)           # real server on localhost:8080
buf generate                      # regenerate server/pb + web/src/pb after proto changes
```
