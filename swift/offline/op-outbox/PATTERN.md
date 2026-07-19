---
name: op-outbox
language: swift
category: offline
tags: [offline-first, actor, outbox, sync, coalescing, idempotency]
description: Offline-first op outbox as a Swift actor — durable queue with per-entity FIFO (create flushes before edits), value-aware coalescing (latest-wins vs merge), transient/terminal flush semantics, and a materializing merge so unsent creations render in every list
origin: onepercent, 2026-07
test: swift test
---

# Offline-first op outbox (Swift actor)

## Problem

An offline-first app must treat the device as the primary source of truth:
every mutation (create, edit, toggle) succeeds locally and instantly, then
syncs when the network allows. A naive "retry the request later" queue fails
in four ways: an entity edited before its creation reached the server 404s;
retrying a create duplicates the entity; naive coalescing of queued edits
silently drops data; and entities created offline are invisible to any screen
that renders server data.

## Solution

One actor owns a durable queue of typed ops (`OpOutbox.swift`), persisted via
a tiny atomic-file store (`DiskStore.swift`), over a gateway seam
(`Domain.swift`):

- **Client-generated IDs + server idempotent upsert** are the enabling
  contract: `create` carries a client UUIDv4 and the server returns the
  existing entity on replay — retries can never duplicate.
- **FIFO per entity**: a create always flushes before that entity's edits. A
  *transient* create failure blocks its followers for the pass (kept, retried
  on the next trigger); a *terminal* create failure drops them — reported in
  the flush outcome, never silent.
- **Value-aware coalescing** on enqueue: latest-wins ops (rename) replace
  their queued predecessor; set-toggle ops (tags) merge per key, so two
  toggles made offline both flush.
- **Materializing merge**: `merging(into:)` builds full entity values from
  pending creates and applies pending edits on top of server data — offline
  creations appear in every list with all their attributes.
- The outbox **never flushes autonomously**: the composition root wires event
  triggers (post-mutation, network path satisfied, app foregrounded) to one
  reconciliation point that calls `flush()` and applies acks/rollbacks.

## Path

- Started as a log-only outbox (single op kind, replace-by-(entity, day)
  coalescing). The offline-first requirement — "the device is the primary
  truth" — forced the generalization to all mutations, which surfaced the
  per-entity ordering problem (create before edits) that a single-kind queue
  never has.
- First coalescing was replace-only. Reviewing against the product spec caught
  that checking two project milestones offline the same day silently dropped
  the first toggle — hence the split into latest-wins vs merge semantics per
  op kind.
- An adversarial review pass caught the embarrassing one: nothing ever
  *triggered* the flush — offline creations stayed on device forever. The fix
  became a rule: the outbox exposes `flush()` and nothing else; triggers are
  the composition root's job, all routed through a single reconciliation
  point (otherwise post-sync effects get orphaned).
- Applying UI state before `await enqueue(...)` let a concurrent
  merge-and-overwrite hide a fresh create from the snapshot; enqueue now
  happens before the optimistic state write in the calling store.
- Server side, read-then-insert idempotency was rejected for its TOCTOU
  window — see the companion Go pattern `idempotent-create` (PK-constraint
  detection inside the insert transaction).

## Key points

- Typed throws (`throws(SyncError)`) keeps the transient/terminal split
  compiler-checked through the gateway seam.
- `blocked` (transient) vs `dropped` (terminal) sets during flush are the
  whole per-entity FIFO story — no priority queue, no dependency graph.
- Rollback of optimistic UI state on terminal rejects is the CALLER's job:
  the outbox reports outcomes, it never decides UI.
- Deliberately left out (the real app adds them on top): attempts-based
  backoff (event triggers are enough), dead-letter storage, a generic
  entity-type parameter (one concrete domain per app keeps it flat).
- Tests need no network and no mocking library: a struct gateway with
  `@Sendable` closures + a lock-guarded call recorder, temp-dir DiskStores,
  and actor re-instantiation over the same file to prove durability.

## How to run

```bash
swift test
```
