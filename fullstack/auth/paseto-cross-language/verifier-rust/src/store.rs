//! The Rust server's own persistence, symmetric with the Go issuer's
//! goose+sqlc setup: sqlx embedded migrations (migrations/) apply on open,
//! rows map to one typed struct. One owner per table — nobody else opens
//! this database.

use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Bookmark {
    pub id: String,
    pub user_id: String,
    pub url: String,
    pub title: String,
    /// RFC 3339, echoed verbatim to the API.
    pub created_at: String,
}

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    pub async fn open(path: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        // SQLite is single-writer: one connection is the whole concurrency story.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn create(
        &self,
        user_id: &str,
        url: &str,
        title: &str,
    ) -> Result<Bookmark, sqlx::Error> {
        let bookmark = Bookmark {
            id: uuid::Uuid::new_v4().simple().to_string(),
            user_id: user_id.to_owned(),
            url: url.to_owned(),
            title: title.to_owned(),
            created_at: now_rfc3339(),
        };
        sqlx::query("INSERT INTO bookmarks (id, user_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&bookmark.id)
            .bind(&bookmark.user_id)
            .bind(&bookmark.url)
            .bind(&bookmark.title)
            .bind(&bookmark.created_at)
            .execute(&self.pool)
            .await?;
        Ok(bookmark)
    }

    pub async fn list_by_user(&self, user_id: &str) -> Result<Vec<Bookmark>, sqlx::Error> {
        sqlx::query_as::<_, Bookmark>(
            "SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC, id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn by_id(&self, id: &str) -> Result<Option<Bookmark>, sqlx::Error> {
        sqlx::query_as::<_, Bookmark>("SELECT * FROM bookmarks WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn delete(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM bookmarks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("0 is a valid nanosecond")
        .format(&Rfc3339)
        .expect("utc formats as rfc3339")
}
