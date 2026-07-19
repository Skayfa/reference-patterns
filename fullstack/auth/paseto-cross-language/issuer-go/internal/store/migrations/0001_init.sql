-- +goose Up
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- argon2id PHC string, never the password.
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL
);

CREATE TABLE refresh_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id),
    -- Chain identity: rotation keeps the family, logout/reuse revokes it whole.
    family_id  TEXT NOT NULL,
    -- sha256 hex of the opaque token; the raw value is never stored.
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    -- Set when exchanged via Refresh; a rotated token presented again is
    -- reuse, and reuse revokes the family.
    rotated_at TEXT,
    revoked_at TEXT
);

CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);

-- +goose Down
DROP TABLE refresh_tokens;
DROP TABLE users;
