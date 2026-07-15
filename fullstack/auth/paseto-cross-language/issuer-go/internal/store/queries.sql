-- The store's entire SQL surface. sqlc generates the typed Go methods in
-- internal/store/db (committed); store.go wraps them behind domain types.

-- name: CreateUser :exec
INSERT INTO users (id, email, password_hash, role, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: UserByEmail :one
SELECT * FROM users WHERE email = ?;

-- name: UserByID :one
SELECT * FROM users WHERE id = ?;

-- name: PromoteToAdmin :exec
UPDATE users SET role = 'admin' WHERE email = ?;

-- name: InsertRefreshToken :exec
INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, created_at, expires_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: RefreshTokenByHash :one
SELECT * FROM refresh_tokens WHERE token_hash = ?;

-- name: MarkRotated :exec
UPDATE refresh_tokens SET rotated_at = ? WHERE id = ?;

-- name: RevokeFamily :exec
UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL;

-- name: CreateNote :exec
INSERT INTO notes (id, user_id, text, created_at) VALUES (?, ?, ?, ?);

-- name: NotesByUser :many
SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC, id;

-- name: NoteByID :one
SELECT * FROM notes WHERE id = ?;

-- name: DeleteNote :exec
DELETE FROM notes WHERE id = ?;
