// Package parallel runs work over a slice with bounded concurrency.
package parallel

import (
	"context"

	"golang.org/x/sync/errgroup"
)

// Map applies fn to every item concurrently, at most `limit` at a time,
// and returns the results in the same order as items. The first fn error
// cancels the remaining calls (through the shared context) and is
// returned; the partial results are discarded in that case.
//
// A limit <= 0 means unbounded — every item runs concurrently.
func Map[T, R any](
	ctx context.Context,
	limit int,
	items []T,
	fn func(context.Context, T) (R, error),
) ([]R, error) {
	results := make([]R, len(items))

	g, ctx := errgroup.WithContext(ctx)
	// SetLimit(0) would block every Go call forever, so treat any
	// non-positive limit as "no limit" and skip it.
	if limit > 0 {
		g.SetLimit(limit)
	}

	for i, item := range items {
		// Since Go 1.22 the loop variables are per-iteration, so the
		// closure captures this i/item — no `i := i` shadowing needed.
		g.Go(func() error {
			r, err := fn(ctx, item)
			if err != nil {
				return err
			}
			// Each goroutine owns a distinct index, so these writes never
			// race — no mutex required (verified by `go test -race`).
			results[i] = r
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, err
	}
	return results, nil
}
