---
name: bounded-parallel-map
language: go
category: concurrency
tags: [concurrency, errgroup, context, generics, bounded-parallelism]
description: Bounded parallel fan-out in Go — a generic Map with errgroup, context cancellation on first error, order-preserving results, and deterministic concurrency tests (no sleeps)
test: go test -race ./...
---

# Bounded parallel fan-out in Go

## Problem

"Run this over N items concurrently, but at most K at a time, stop on the
first failure, and give me the results in order" is the everyday concurrency
task (parallel API calls, file processing). Hand-rolled with `sync.WaitGroup`
plus a channel for the first error plus a semaphore, it is a dozen fiddly
lines every time — and its tests are usually flaky `time.Sleep`s.

## Solution

`parallel/parallel.go` is one generic primitive:

```go
func Map[T, R any](ctx context.Context, limit int, items []T,
    fn func(context.Context, T) (R, error)) ([]R, error)
```

- **`errgroup.WithContext`** gives first-error-cancels-the-rest and the
  error collection for free; `g.SetLimit(limit)` bounds the parallelism.
- **Order preserved without a mutex**: each goroutine writes its own
  `results[i]`; disjoint indices never race.
- **First error wins**: `g.Wait()` returns the first non-nil error, and the
  derived context it cancels unblocks every peer.

`parallel/parallel_test.go` shows how to test this **deterministically**:
- *Respects the limit*: a channel barrier releases workers only once
  exactly `limit` are in-flight, then asserts the observed peak equals the
  limit — reached it, never exceeded it.
- *Cancels on first error*: peers block on `<-ctx.Done()` (the sync signal,
  not a sleep) and the test asserts both the sentinel error surfaces and
  every peer observed the cancellation.

## Key points

- **`SetLimit(0)` is a trap**: a zero limit blocks every `Go` call forever
  (deadlock). `Map` treats `limit <= 0` as unbounded and skips `SetLimit`.
- **errgroup over hand-rolled WaitGroup+channel**: the same cancel-on-error
  and bounding would be ~12 error-prone lines; the point of the pattern is
  to reach for the idiomatic tool.
- **`g.Wait()` returns the *first* error**; the peers returning `ctx.Err()`
  afterwards are ignored — so callers get the root cause, not the fallout.
- **No mutex by construction**: index-owned writes only. `go test -race`
  is the `test:` command precisely to keep that guarantee honest.
- **Go 1.22+ per-iteration loop vars** — no `i := i` copy before `g.Go`.
- **Test concurrency with barriers, never `time.Sleep`**: coordinate with
  channels/atomics and use `ctx.Done()` as the synchronization signal.
- **Scope**: this is fan-out/collect. Streaming pipelines, long-lived
  worker pools and fan-in are different shapes — separate patterns, not
  bolted on here.

## How to run

```bash
go test -race ./...
```
