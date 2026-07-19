---
name: idempotent-create
language: go
category: storage
tags: [idempotency, sqlite, offline-first, constraint, race-safety, uuid]
description: Create-as-idempotent-upsert keyed by a client-generated UUID — the PRIMARY KEY constraint decides atomically inside the insert (no read-then-insert TOCTOU window); replaying a create returns the existing row unchanged, making at-least-once retries safe
origin: onepercent, 2026-07
test: go test ./...
---

# Idempotent create via the primary-key constraint

## Problem

Offline-first clients and at-least-once queues retry creates. If the server
treats create as strictly-insert, retries either error (client must
special-case "already exists" — but was it *my* create?) or duplicate rows.
Idempotency needs a key the client controls and a check that survives
concurrency.

## Solution

`store.go`:

- The **client generates the entity ID** (UUIDv4) — creation can complete
  offline, and the id doubles as the idempotency key.
- `CreateUser` just INSERTs. A duplicate id surfaces as the SQLite
  primary-key constraint violation (`modernc.org/sqlite` error code
  `SQLITE_CONSTRAINT_PRIMARYKEY`), mapped to "fetch and return the existing
  row unchanged, no error" — even when the retried payload differs (first
  write wins).
- The constraint decides **atomically inside the insert**: two concurrent
  creates with the same id cannot both insert; the loser takes the fetch
  branch. `TestConcurrentCreatesWithSameIDInsertExactlyOneRow` proves it with
  8 goroutines.

## Path

- First instinct was a read-then-insert pre-check (`GetUser` → insert if
  missing). Rejected: it leaves a TOCTOU window between the read and the
  write where two concurrent creates both pass the check — the constraint
  already does this test race-free, for free.
- Detecting the conflict took one discovery: `modernc.org/sqlite` (CGO-free
  driver) exposes typed errors — `errors.As` to `*sqlite.Error` and compare
  `.Code()` against `sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY` (1555), not string
  matching, and not the generic `SQLITE_CONSTRAINT` (19) which also covers
  NOT NULL/CHECK violations you do NOT want to swallow.
- In the source project the optional client id rode in over protovalidate:
  `string.uuid = true` + `ignore = IGNORE_IF_ZERO_VALUE`, so empty means "the
  server generates" and anything present must be a real UUID.

## Key points

- First-write-wins on replay is a deliberate choice: a retry with a different
  payload returns the ORIGINAL row. That is what an outbox retry wants (the
  payload difference is a bug upstream, not an intent to update).
- Map only the PRIMARY KEY constraint code to the idempotent branch; every
  other constraint stays a real error.
- When the entity has child rows (written in the same transaction), the PK
  conflict fires on the parent insert before any child insert runs — the
  fetch branch returns a complete, consistent entity.
- Companion client-side pattern: `swift/offline/op-outbox` (the outbox whose
  retries this makes safe).

## How to run

```bash
go test ./...
```
