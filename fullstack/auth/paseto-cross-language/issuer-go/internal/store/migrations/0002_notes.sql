-- +goose Up
CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX notes_user ON notes (user_id);

-- +goose Down
DROP TABLE notes;
