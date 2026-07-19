package idempotentcreate

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestCreateUserIdempotent(t *testing.T) {
	t.Parallel()

	tests := map[string]struct {
		replayEmail string // "" = no replay
		wantEmail   string
	}{
		"first create wins":                     {},
		"replay with same payload is a no-op":   {replayEmail: "ada@example.com", wantEmail: "ada@example.com"},
		"replay with different payload ignored": {replayEmail: "other@example.com", wantEmail: "ada@example.com"},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			s := newStore(t)
			ctx := context.Background()
			id := NewID()

			first, err := s.CreateUser(ctx, User{ID: id, Email: "ada@example.com"})
			if err != nil {
				t.Fatalf("create: %v", err)
			}
			if first.ID != id {
				t.Errorf("id = %q, want client-provided %q", first.ID, id)
			}

			if tc.replayEmail != "" {
				replayed, err := s.CreateUser(ctx, User{ID: id, Email: tc.replayEmail})
				if err != nil {
					t.Fatalf("replayed create must not error: %v", err)
				}
				if replayed.Email != tc.wantEmail {
					t.Errorf("replay returned email %q, want existing %q", replayed.Email, tc.wantEmail)
				}
			}

			if n, _ := s.CountUsers(ctx); n != 1 {
				t.Errorf("row count = %d, want exactly 1", n)
			}
		})
	}
}

func TestConcurrentCreatesWithSameIDInsertExactlyOneRow(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	ctx := context.Background()
	id := NewID()

	// The race a read-then-insert pre-check cannot survive: every goroutine
	// must succeed, and exactly one row must exist.
	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = s.CreateUser(ctx, User{ID: id, Email: "ada@example.com"})
		}()
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: %v", i, err)
		}
	}
	if n, _ := s.CountUsers(ctx); n != 1 {
		t.Errorf("row count = %d, want exactly 1", n)
	}
}

func TestDistinctIDsInsertDistinctRows(t *testing.T) {
	t.Parallel()
	s := newStore(t)
	ctx := context.Background()

	if _, err := s.CreateUser(ctx, User{ID: NewID(), Email: "a@example.com"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(ctx, User{ID: NewID(), Email: "b@example.com"}); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.CountUsers(ctx); n != 2 {
		t.Errorf("row count = %d, want 2", n)
	}
}
