// Package store is the issuer's SQLite persistence: users and the
// refresh-token families that make revocation work.
//
// One stack, declared once each: the schema lives in migrations/*.sql
// (applied by goose on Open), the queries in queries.sql (compiled to typed
// Go by sqlc into db/, committed). This file only translates the generated
// rows into domain types and driver errors into domain errors.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"time"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite" // pure-Go driver, no CGO

	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/store/db"
)

var (
	ErrEmailTaken = errors.New("store: email already registered")
	ErrNotFound   = errors.New("store: not found")
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type User struct {
	ID           string
	Email        string
	PasswordHash string
	Role         string
}

type RefreshToken struct {
	ID        string
	UserID    string
	FamilyID  string
	ExpiresAt time.Time
	RotatedAt *time.Time
	RevokedAt *time.Time
}

type Note struct {
	ID        string
	UserID    string
	Text      string
	CreatedAt string // RFC 3339, echoed verbatim to the API
}

type Store struct {
	sqlDB *sql.DB
	q     *db.Queries
}

func Open(path string) (*Store, error) {
	// modernc.org/sqlite is single-writer: one *sql.DB with WAL and a busy
	// timeout is the whole concurrency story.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)",
		path,
	)
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}

	migrations, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("store: migrations fs: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, migrations)
	if err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("store: goose provider: %w", err)
	}
	if _, err := provider.Up(context.Background()); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("store: migrate: %w", err)
	}

	return &Store{sqlDB: sqlDB, q: db.New(sqlDB)}, nil
}

func (s *Store) Close() error { return s.sqlDB.Close() }

// NewID returns a random 128-bit hex id.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return hex.EncodeToString(b[:])
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func (s *Store) CreateUser(ctx context.Context, email, passwordHash, role string) (User, error) {
	id := NewID()
	err := s.q.CreateUser(ctx, db.CreateUserParams{
		ID: id, Email: email, PasswordHash: passwordHash, Role: role, CreatedAt: now(),
	})
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return User{}, ErrEmailTaken
		}
		return User{}, fmt.Errorf("store: create user: %w", err)
	}
	return User{ID: id, Email: email, PasswordHash: passwordHash, Role: role}, nil
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	return userFrom(s.q.UserByEmail(ctx, email))
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	return userFrom(s.q.UserByID(ctx, id))
}

func userFrom(row db.User, err error) (User, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("store: load user: %w", err)
	}
	return User{ID: row.ID, Email: row.Email, PasswordHash: row.PasswordHash, Role: row.Role}, nil
}

// PromoteToAdmin is used by the SEED_ADMIN_* startup seed (idempotent).
func (s *Store) PromoteToAdmin(ctx context.Context, email string) error {
	if err := s.q.PromoteToAdmin(ctx, email); err != nil {
		return fmt.Errorf("store: promote admin: %w", err)
	}
	return nil
}

func (s *Store) InsertRefreshToken(
	ctx context.Context, userID, familyID, tokenHash string, expiresAt time.Time,
) error {
	err := s.q.InsertRefreshToken(ctx, db.InsertRefreshTokenParams{
		ID: NewID(), UserID: userID, FamilyID: familyID, TokenHash: tokenHash,
		CreatedAt: now(), ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return fmt.Errorf("store: insert refresh token: %w", err)
	}
	return nil
}

func (s *Store) RefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error) {
	row, err := s.q.RefreshTokenByHash(ctx, tokenHash)
	if errors.Is(err, sql.ErrNoRows) {
		return RefreshToken{}, ErrNotFound
	}
	if err != nil {
		return RefreshToken{}, fmt.Errorf("store: load refresh token: %w", err)
	}
	expiresAt, err := time.Parse(time.RFC3339, row.ExpiresAt)
	if err != nil {
		return RefreshToken{}, fmt.Errorf("store: parse expires_at: %w", err)
	}
	return RefreshToken{
		ID: row.ID, UserID: row.UserID, FamilyID: row.FamilyID, ExpiresAt: expiresAt,
		RotatedAt: parseNullTime(row.RotatedAt), RevokedAt: parseNullTime(row.RevokedAt),
	}, nil
}

func parseNullTime(v sql.NullString) *time.Time {
	if !v.Valid {
		return nil
	}
	t, err := time.Parse(time.RFC3339, v.String)
	if err != nil {
		return nil
	}
	return &t
}

func (s *Store) MarkRotated(ctx context.Context, id string) error {
	err := s.q.MarkRotated(ctx, db.MarkRotatedParams{
		RotatedAt: sql.NullString{String: now(), Valid: true}, ID: id,
	})
	if err != nil {
		return fmt.Errorf("store: mark rotated: %w", err)
	}
	return nil
}

func noteFrom(row db.Note) Note {
	return Note{ID: row.ID, UserID: row.UserID, Text: row.Text, CreatedAt: row.CreatedAt}
}

func (s *Store) CreateNote(ctx context.Context, userID, text string) (Note, error) {
	params := db.CreateNoteParams{ID: NewID(), UserID: userID, Text: text, CreatedAt: now()}
	if err := s.q.CreateNote(ctx, params); err != nil {
		return Note{}, fmt.Errorf("store: create note: %w", err)
	}
	return Note(params), nil
}

func (s *Store) NotesByUser(ctx context.Context, userID string) ([]Note, error) {
	rows, err := s.q.NotesByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("store: list notes: %w", err)
	}
	notes := make([]Note, len(rows))
	for i, row := range rows {
		notes[i] = noteFrom(row)
	}
	return notes, nil
}

func (s *Store) NoteByID(ctx context.Context, id string) (Note, error) {
	row, err := s.q.NoteByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if err != nil {
		return Note{}, fmt.Errorf("store: load note: %w", err)
	}
	return noteFrom(row), nil
}

func (s *Store) DeleteNote(ctx context.Context, id string) error {
	if err := s.q.DeleteNote(ctx, id); err != nil {
		return fmt.Errorf("store: delete note: %w", err)
	}
	return nil
}

// RevokeFamily kills every token in the chain — logout, or reuse detection.
func (s *Store) RevokeFamily(ctx context.Context, familyID string) error {
	err := s.q.RevokeFamily(ctx, db.RevokeFamilyParams{
		RevokedAt: sql.NullString{String: now(), Valid: true}, FamilyID: familyID,
	})
	if err != nil {
		return fmt.Errorf("store: revoke family: %w", err)
	}
	return nil
}
