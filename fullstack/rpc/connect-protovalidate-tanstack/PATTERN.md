---
name: connect-protovalidate-tanstack
language: fullstack
category: rpc
tags: [go, connectrpc, protobuf, protovalidate, buf, react, tanstack-form, tanstack-query, zod]
description: End-to-end typed RPC with validation — Go Connect server enforcing protovalidate rules declared in the proto, React front with TanStack Form (writes) and TanStack Query over HTTP GET (cacheable reads), tested on both sides without a network
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
- **`web/src/subscribe-form.tsx`** — the write side: TanStack Form owns
  input state and instant feedback (zod schema mirroring the proto rules),
  TanStack Query owns the network state (`useMutation` on the generated
  client), and the generated types make the payload compile-time-checked.
- **`web/src/subscription-status.tsx`** — the read side: `useQuery` on
  `GetSubscription`, which the proto declares `NO_SIDE_EFFECTS` — so a
  transport created with `useHttpGet: true` sends it as a plain **HTTP
  GET**, cacheable by browsers and CDNs. `server/main_test.go` proves the
  wire behavior: `Subscribe` travels as POST, `GetSubscription` as GET,
  and protovalidate rules apply to GET requests too.
- **Tests on both sides, no network**:
  `server/main_test.go` drives the real handler stack through `httptest`
  and asserts the validation table; `web/tests/subscribe-form.test.tsx`
  swaps the transport for `createRouterTransport` — a real Connect service
  running in memory — so serialization and error semantics are exercised
  for real.

## Key points

- **The server is the source of truth**; the zod schema exists only for
  instant field-level UX. The last test proves the flow still works when a
  server rule is missing client-side: the ConnectError surfaces in the form.
- `createRouterTransport` beats mocking `fetch`: you test against actual
  Connect (de)serialization, codes and details, and the same client code
  runs in tests and production (the client is injected as a prop).
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
