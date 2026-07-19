// Package idempotentcreate shows create-as-idempotent-upsert keyed by a
// client-generated ID: replaying the same create (offline-first outbox
// retries, at-least-once queues) returns the existing row unchanged instead
// of erroring or duplicating.
//
// The idempotency check is the PRIMARY KEY constraint itself, detected inside
// the insert — not a read-then-insert pre-check, which leaves a window where
// two concurrent creates both pass the read and one blows up (or worse, both
// insert under weaker constraints).
package idempotentcreate

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"

	sqlite "modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

type User struct {
	ID    string
	Email string
}

var ErrNotFound = errors.New("not found")

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)", path))
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL)`); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// CreateUser is an idempotent upsert keyed by u.ID: the first create wins,
// any replay of the same id returns the EXISTING row unchanged (even if the
// retried payload differs) with no error.
func (s *Store) CreateUser(ctx context.Context, u User) (User, error) {
	_, err := s.db.ExecContext(ctx, `INSERT INTO users (id, email) VALUES (?, ?)`, u.ID, u.Email)
	if isPrimaryKeyConflict(err) {
		// The constraint decided atomically inside the insert; now the row is
		// guaranteed to exist — return it as the canonical result.
		return s.GetUser(ctx, u.ID)
	}
	if err != nil {
		return User{}, err
	}
	return u, nil
}

func (s *Store) GetUser(ctx context.Context, id string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `SELECT id, email FROM users WHERE id = ?`, id).Scan(&u.ID, &u.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// isPrimaryKeyConflict reports whether err is the SQLite primary-key
// constraint violation raised by modernc.org/sqlite on a duplicate id.
func isPrimaryKeyConflict(err error) bool {
	var se *sqlite.Error
	return errors.As(err, &se) && se.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY
}

// NewID returns a random UUIDv4 in canonical form — the CLIENT generates it,
// so creation can complete offline and retries stay idempotent.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
