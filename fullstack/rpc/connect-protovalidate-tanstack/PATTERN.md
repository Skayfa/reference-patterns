---
name: connect-protovalidate-tanstack
language: fullstack
category: rpc
tags: [go, connectrpc, protobuf, protovalidate, buf, react, tanstack-form, tanstack-query, zod]
description: End-to-end typed RPC with a single validation source — protovalidate rules in the proto enforced by the Go server AND evaluated in the browser (protovalidate-es as a Standard Schema for TanStack Form), TanStack Query over HTTP GET for cacheable reads, and code-driven error handling caught at the right place (Suspense + error boundary for reads, server violations onto form fields via onSubmitAsync, transient-only retries, panic shield) — tested on both sides without a network
origin: built in-repo, 2026-07
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
- **`server/`** — business logic and wiring are separate packages:
  `internal/newsletter` implements the service and knows nothing about
  transport; `main.go` is the **composition root** — the shared
  `defaultHandlerOptions()` (validate interceptor + panic recover) that
  every future service mounts with, the mux, and an `http.Server` with
  `ReadHeaderTimeout` + graceful shutdown (`signal.NotifyContext` →
  `Shutdown`). Validation is an interceptor (`connectrpc.com/validate`):
  invalid requests are rejected with `invalid_argument` + structured
  `Violations` details before any handler code runs.
- **Business errors target fields too** (`internal/newsletter`,
  `fieldViolation`): a rule protovalidate cannot express — email
  uniqueness — answers `already_exists` carrying the same `Violations`
  detail shape, pointing at the `email` field. The frontend maps it onto
  the form field with zero extra code, because business rejections reuse
  the exact channel rule violations travel on.
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
  return `connect.NewError` with deliberate codes. Client side, each kind
  of failure is caught at its intended place, following the official
  TanStack patterns:
  - **Reads** (`web/src/rpc-boundary.tsx`): components use
    `useSuspenseQuery` and render only the happy path — loading surfaces
    at `<Suspense>`, failures at the error boundary. `RpcBoundary` is the
    documented composition (`QueryErrorResetBoundary` +
    `react-error-boundary`, `onReset={reset}` so Retry actually
    refetches), written once for the whole app.
  - **Writes** (`web/src/form/use-form-mutation.ts`): `useFormMutation`
    binds any Connect mutation to TanStack Form's submit validator, once
    for the whole app — the mutation runs at submit time, and RPC
    failures come back as the documented `{ form, fields }` error shape
    (built by `serverErrorMap` from the `Violations` details, dotted
    field paths included). The framework distributes field entries onto
    the fields; `<form.FormError />` renders the form-level part. A form
    contains zero error-handling code:
    `validators: { onChange, onSubmitAsync }`.
  - Raw RPC messages never reach the DOM (`userMessage` maps codes to
    copy), and `createQueryClient` retries transient codes only, queries
    only.
- **Tests on both sides, no network**:
  `server/main_test.go` drives the real handler stack through `httptest`
  and asserts the validation table; `web/tests/subscribe-form.test.tsx`
  swaps the transport for `createRouterTransport` — a real Connect service
  running in memory — so serialization and error semantics are exercised
  for real.

## Path

Built iteratively in-repo; the rejected steps (all in git history) are the
lesson:

- **Client validation started as a zod schema mirroring the proto rules** —
  worked, but every rule existed twice and drifted silently. Replaced by
  protovalidate-es (`createStandardSchema`) evaluating the proto's own CEL
  rules in the browser: the mirror is deleted, form values become the proto
  message itself.
- **Server violations were first mapped onto fields by hand** — an
  escape-hatch cast, then `formApi.setFieldMeta` (`errorMap.onServer` +
  `errorSourceMap`), which typed correctly and auto-cleared on edit. Both
  were plumbing the framework already ships: `onSubmitAsync` returning the
  documented `{ form, fields }` shape lets TanStack Form distribute field
  errors itself — the whole mapping layer got deleted.
- **Error handling started inside each form** (try/catch + manual error
  state) — extracted into `useFormMutation` in the composition layer, so a
  form declares `validators` and nothing else; reads moved from manual
  loading/error branches to `useSuspenseQuery` + `RpcBoundary`.
- **The submit button was hard-`disabled`** — which deadlocked
  resubmit-after-rejection. `aria-disabled` (the docs' a11y guidance) is
  what makes the recovery flow possible at all.
- **Duplicate-email was first simulated in web tests** — made real by giving
  the server business violations that reuse the exact `Violations` detail
  shape protovalidate uses, so the frontend maps them with zero extra code.

## Key points

- **Error boundaries are for reads, not forms**: a boundary unmounts the
  subtree it guards — on a form that means losing the user's input, and a
  boundary can never place a violation next to its field. So queries throw
  declaratively (suspense + `RpcBoundary`), while submit errors stay local
  through the documented `onSubmitAsync` → `{ form, fields }` channel.
- **`aria-disabled`, not `disabled`, on the submit button** (per the
  TanStack Form docs: disabled buttons are not accessible). This is also
  what makes the server-error flow sound: submit-cause errors only refresh
  on the next submit, and the button staying clickable is what allows that
  next submit — a hard-disabled button would deadlock behind
  `canSubmit === false`.
- **`useSuspenseQuery` degrades gracefully**: its default `throwOnError`
  only throws to the boundary when there is no cached data — with a
  previous success in cache, a failed refetch keeps rendering the stale
  data instead of nuking the page.
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
- **Deliberately not done, to stay proportionate**: no repository
  interface or DI container (the in-memory map is a stand-in — introduce
  persistence at the composition root when it becomes real, and an
  interface only once there are two implementations), no config layer
  (one `ADDR` env var), no logging/metrics interceptors (out of scope
  here), no CORS middleware (documented above, add `connectrpc.com/cors`
  when a browser origin actually calls the server).
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
