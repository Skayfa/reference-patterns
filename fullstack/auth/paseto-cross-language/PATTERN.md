---
name: paseto-cross-language
language: fullstack
category: auth
tags: [go, rust, typescript, react, paseto, ed25519, connectrpc, tonic, grpc-web, sqlite, sqlc, goose, protovalidate, connect-query, argon2id, refresh-tokens, rbac, proto-options, buf]
description: One proto contract owns API, per-RPC ACL and validation; PASETO v4.public tokens signed by a Go issuer verify locally in Rust and TS; schema+queries declared once (goose+sqlc); React front on generated hooks
origin: built in-repo, 2026-07
test: (cd issuer-go && go test ./...) && (cd verifier-rust && cargo test) && (cd verifier-ts && pnpm test) && (cd web && pnpm test) && (cd e2e && pnpm test)
---

# Cross-language auth: PASETO v4.public over one proto contract

## Problem

Services written in different languages each invent their own session/JWT
story. JWT's `alg` agility and second-guessable claim formats make "verify
the same token in three runtimes" a minefield, and validating tokens by
calling the issuer couples every request to it. You want: one API contract,
one key, tokens minted once and verified **locally** by any server in any
language.

## Solution

- `proto/` is the single contract (buf v2, committed codegen; one
  `buf.gen.*.yaml` per consumer + `Makefile` → `make generate` rebuilds every
  derived artifact): `auth.v1.AuthService` and `demo.v1.ProtectedService`,
  implemented by every server, with `buf.validate` rules on the requests.
- **Per-RPC permissions live in the contract**: `auth/v1/access.proto`
  declares the `Role` enum (the hierarchy is the enum numbers) and the
  `(auth.v1.access)` method option — `{minimum_role: ROLE_ADMIN}` or
  `{public: true}`. Every server's middleware enforces it; handlers never
  hand-check roles. **Default-deny**: a CI test
  (`internal/protected/acl_test.go`) fails if any RPC lacks an annotation.
- `issuer-go/` is the only place tokens are minted, and the only service
  with storage: connect-go, argon2id, SQLite. The schema is declared once in
  `internal/store/migrations/` (applied by goose on open), the queries once
  in `queries.sql` (compiled to typed Go by sqlc, committed). Opaque refresh
  tokens are rotated on use, reuse kills the whole family, logout revokes
  it. Access tokens are PASETO v4.public (Ed25519), 10-minute TTL.
- `verifier-rust/` (tonic + tonic-web) and `verifier-ts/` (connect-es) verify
  the token with **only the public key** — no call to the issuer — and apply
  the proto-declared ACL identically (`src/access.rs` + `src/service.rs`,
  `src/routes.ts`).
- The Rust server also **owns its own entity** (`bookmark.v1`, symmetric
  with the Go-owned `note.v1`): its own SQLite (`verifier-rust/migrations/`
  applied by sqlx on open, typed rows in `src/store.rs`), business logic in
  `src/bookmark.rs`. One owner per table — services never share a database;
  anyone needing another service's data calls its API.
- `web/` (Vite React) has no hand-written data layer: connect-query hooks on
  the generated schemas, one query per server column (keys include the
  transport), the token injected by a shared transport interceptor. Rust is
  reached over gRPC-web.
- `e2e/` boots the three real servers and proves the whole story on the wire
  (`flow.test.ts`); `keys/go-signed-admin.paseto` is the committed fixture
  that lets each language's unit tests prove interop without booting anything.

## Adding an entity (the walkthrough)

`note.v1` exists to show the flow. Adding it took exactly four hand-written
artifacts, all in one language:

1. `proto/note/v1/note.proto` — the ONLY place the fields are typed:
   messages, 3 RPCs, `(auth.v1.access)` on each, `buf.validate` rules
   (~45 lines with comments).
2. `issuer-go/internal/store/migrations/0002_notes.sql` — the table
   (~12 lines).
3. Four queries appended to `queries.sql` (~10 lines).
4. `issuer-go/internal/note/service.go` — pure business logic: notes scoped
   to the token's subject, owner-or-admin delete (~90 lines, most of it the
   connect signatures).

Then `make generate` produced the rest: Go stubs + typed store methods, TS
types for the front and the e2e, and the front's data layer is generated
hooks (`web/src/notes-panel.tsx` is JSX only). Wiring: one mount line in
`newMux`, one `<NotesPanel/>` line, one file descriptor added to the
default-deny test.

**Cost in the other languages: zero.** Rust and the TS verifier never see
notes — only the Go service owns storage; they keep verifying tokens. The
front and the e2e consume `NoteService` fully typed without writing a type.
An RPC forgotten without its `(auth.v1.access)` option would have failed
`TestEveryRPCDeclaresAnAccessRule` before it could ship unprotected.

The same walkthrough exists **in Rust** to show the symmetry: `bookmark.v1`
is owned by the Rust server — `proto/bookmark/v1/bookmark.proto`, one sqlx
migration (`verifier-rust/migrations/`), typed rows (`src/store.rs`),
handlers (`src/bookmark.rs`) behind the same contract ACL (Rust has its own
default-deny test over the descriptor set). The front reaches it over
gRPC-web with the same generated hooks (`web/src/bookmarks-panel.tsx` —
only the transport changes). Per-language storage analogs: goose+sqlc in
Go ↔ sqlx migrations + `FromRow` in Rust.

**When two services need the same table**: they don't share it — ever.
Sharing a table couples their schemas, deployments and migrations, and
re-creates the double-declaration this architecture eliminates. In order of
preference: (1) the non-owner calls the owner's API (the contract is
already there — that's what proto is for); (2) if the coupling is read-only
and hot, the owner publishes changes (events) and the reader keeps its own
projection, in its own schema; (3) if two services fight over the same
writes, they are one service — merge them, or move the table's ownership.

## Path

- The plan said panva's `paseto` for TS — it turned out archived (no release
  since 2023). Switched to `paseto-ts`, which is ESM-only and refuses raw key
  bytes: keys must be PASERK-wrapped (`k4.public.<base64url>`), hence the
  `hexToPaserkPublic` helper.
- First cross-language run failed immediately: `pasetors`' default
  `ClaimsValidationRules` requires an `nbf` claim, and go-paseto doesn't emit
  one. Fixed in the issuer (`SetNotBefore`), not by relaxing the Rust rules —
  the token should carry `nbf` anyway.
- In a TS test, signing a deliberately expired fixture kept verifying:
  paseto-ts's `addExp` default silently replaces a past `exp` with now+1h.
  `addExp: false` is required when pinning `exp` in tests.
- The committed Rust codegen first failed to compile twice: the
  neoeinstein-prost output already `include!`s the `.tonic.rs` file (including
  both in `pb/mod.rs` redefines the module), and tonic 0.14 moved its codec
  into a separate `tonic-prost` crate the generated code references.
- Rust has no in-process transport test here (rejected: generating tonic
  client stubs just for tests would double the committed codegen);
  interceptor and handlers are unit-tested directly, the wire path is the
  e2e's job.
- Storage went through three shapes, in real history: hand-written SQL
  migrations over `database/sql` → GORM AutoMigrate ("an ORM is simpler,
  less code") → **goose + sqlc**, when the requirement became "many tables
  eventually, one consistent stack, no pattern mixing". GORM's AutoMigrate
  is additive-only and its per-query code is hand-written; goose+sqlc keeps
  exactly two hand-written artifacts per table (migration, queries) and
  generates the rest, with destructive migrations possible.
- v1 hand-checked `role == "admin"` in each handler; replaced first with a
  string option on the RPC, then with the `Role` enum + `minimum_role`
  hierarchy + default-deny gate once "how do I declare which permission a
  query needs" became the design driver. Go and TS read the option via
  their protobuf runtimes; **prost discards custom options at codegen**, so
  Rust reflects over a committed descriptor set (`buf build -o`) with
  prost-reflect. And tonic interceptors never see which RPC is called, so
  Rust enforces in a one-line handler guard instead of middleware.
- The web data layer was hand-wired clients + per-call bearer headers;
  replaced by connect-query hooks (queries keyed per transport — checked in
  the lib before trusting three same-method columns to the cache) and a
  token-injecting transport interceptor.
- The generated TS needed `import_extension=js` in `buf.gen.yaml`: the
  Node servers compile under `moduleResolution: nodenext`, which refuses
  the extensionless relative imports bufbuild/es emits by default.

## Key points

- PASETO claims are RFC 3339 **strings**, not epoch seconds. The proto echoes
  them verbatim (`string issued_at`, not `google.protobuf.Timestamp`), so no
  server converts timestamps at all.
- Footer and implicit assertion must be byte-identical at sign and verify
  time across all libraries — they are **empty everywhere** here; a mismatch
  fails with an unhelpful signature error.
- v4.public = Ed25519 only: there is no `alg` header to downgrade, one less
  JWT footgun.
- Verification is stateless, so logout cannot recall live access tokens —
  the mitigation is the 10-minute TTL plus refresh rotation with
  family-wide reuse revocation (see `RefreshToken.FamilyID`).
- The ACL has one source of truth: the proto annotation. Change
  `{minimum_role: ...}` in the contract, run `make generate`, and all three
  servers enforce the new rule — no handler edits. The hierarchy is just
  the enum numbers, so "admin passes user-level RPCs" costs one `<`.
  Default-deny means forgetting to annotate a new RPC is a failing test,
  not a silent hole.
- Public RPCs (`public: true` — the whole `AuthService`) are mounted on a
  handler **without** the auth interceptor; the interceptor always demands a
  token, so a public rule reaching it means the RPC was mounted in the wrong
  place, and all three servers refuse it rather than wave it through. The
  `public` flag still exists in the contract so the default-deny gate counts
  those RPCs as deliberately-open rather than un-annotated.
- Input validation is also contract-declared (`buf.validate` field rules) —
  the Go issuer enforces it with one interceptor; handlers assume shaped
  input. The Rust server has no first-party protovalidate runtime, so it
  re-checks the same rules by hand, counting Unicode characters (not bytes)
  to stay byte-for-byte compatible with protovalidate on non-ASCII input.
- What is hand-written per new entity, once this structure exists: the proto
  messages/RPCs (~15 lines), one goose migration, a handful of sqlc queries,
  and the business logic. Stores, stubs, TS types, front hooks and the ACL
  wiring are all generated or shared.
- The dev keypair in `keys/` is committed **on purpose** (deterministic
  tests, every language signs its own fixtures) and is therefore worthless
  as a secret; production generates at deploy time (`cmd/genkey`) and ships
  only the public key to verifiers. There is deliberately no JWKS endpoint —
  local verification is the whole point; fetch-once-at-startup is the
  production extension.
- Committed Rust codegen via buf remote plugins means no protoc/build.rs,
  but the `prost`/`tonic`/`tonic-prost` crate versions must match what the
  plugin emits — `cargo build` arbitrates; bumping tonic later means
  re-running `buf generate` with a newer plugin.
- tonic serves gRPC; browsers can't speak it. `tonic_web::GrpcWebLayer` +
  `accept_http1(true)` + permissive CORS is what lets connect-web's
  `createGrpcWebTransport` reach Rust directly, no proxy.
- The e2e global setup builds Go + Rust first: the **first** run pays the
  cold cargo build of the tonic tree (minutes); warm runs finish in seconds.

## How to run

```bash
# All tests (unit per language + cross-language e2e):
(cd issuer-go && go test ./...) && (cd verifier-rust && cargo test) && \
(cd verifier-ts && pnpm test) && (cd web && pnpm test) && (cd e2e && pnpm test)

# Run the demo by hand (four terminals, dev keys implicit):
cd issuer-go && SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='correct horse battery' go run .
cd verifier-rust && cargo run
cd verifier-ts && pnpm start
cd web && pnpm dev   # http://localhost:5173

# Regenerate every derived artifact (buf ×3 consumers, the descriptor set
# feeding Rust's option reflection, sqlc):
make generate
```
