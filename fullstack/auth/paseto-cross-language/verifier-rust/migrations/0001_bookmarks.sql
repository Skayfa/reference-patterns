-- The Rust server's OWN database: one owner per table. No other service
-- opens this file; they reach bookmarks through bookmark.v1.BookmarkService.
CREATE TABLE bookmarks (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX bookmarks_user ON bookmarks (user_id);
