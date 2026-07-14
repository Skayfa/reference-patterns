package parallel_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/Skayfa/reference-patterns/go/concurrency/bounded-parallel-map/parallel"
)

func TestMapPreservesOrder(t *testing.T) {
	t.Parallel()

	items := []int{1, 2, 3, 4, 5}
	got, err := parallel.Map(context.Background(), 2, items,
		func(_ context.Context, n int) (int, error) {
			return n * n, nil
		})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Execution order is free; result order must mirror the input order.
	want := []int{1, 4, 9, 16, 25}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %d, want %d", i, got[i], want[i])
		}
	}
}

func TestMapRespectsLimit(t *testing.T) {
	t.Parallel()

	const limit = 3
	items := make([]int, 10)

	var current, peak atomic.Int64
	// A worker signals on `entered` once it is in-flight, then blocks on
	// `proceed`. The releaser waits for exactly `limit` workers to be
	// in-flight before unblocking them — no sleeps, fully deterministic.
	entered := make(chan struct{}, len(items))
	proceed := make(chan struct{})

	go func() {
		for i := 0; i < limit; i++ {
			<-entered
		}
		close(proceed)
	}()

	_, err := parallel.Map(context.Background(), limit, items,
		func(_ context.Context, _ int) (int, error) {
			c := current.Add(1)
			for p := peak.Load(); c > p && !peak.CompareAndSwap(p, c); p = peak.Load() {
			}
			entered <- struct{}{}
			<-proceed
			current.Add(-1)
			return 0, nil
		})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Reached the limit (proves it parallelizes) and never exceeded it
	// (proves SetLimit is enforced).
	if got := peak.Load(); got != limit {
		t.Errorf("peak concurrency = %d, want %d", got, limit)
	}
}

func TestMapCancelsOnFirstError(t *testing.T) {
	t.Parallel()

	sentinel := errors.New("boom")
	const n = 6
	items := make([]int, n)
	for i := range items {
		items[i] = i
	}

	var observedCancel atomic.Int64
	// Unbounded, so all n goroutines start. Item 0 fails immediately;
	// errgroup cancels the shared context, which unblocks every peer.
	_, err := parallel.Map(context.Background(), 0, items,
		func(ctx context.Context, i int) (int, error) {
			if i == 0 {
				return 0, sentinel
			}
			<-ctx.Done()
			observedCancel.Add(1)
			return 0, ctx.Err()
		})

	// Wait returns the FIRST error (the sentinel), not the peers' ctx.Err.
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want sentinel", err)
	}
	// Cancellation propagated to every other worker.
	if got := observedCancel.Load(); got != n-1 {
		t.Errorf("observed cancellations = %d, want %d", got, n-1)
	}
}
