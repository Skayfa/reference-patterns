//! bookmark.v1.BookmarkService — the Rust-owned entity, symmetric with the
//! Go-owned note.v1: same contract mechanics (ACL option, claims from the
//! interceptor), storage in THIS server's own SQLite (src/store.rs).

use tonic::{Request, Response, Status};

use crate::access::{AccessRules, authorize};
use crate::pb::bookmark_v1::bookmark_service_server::BookmarkService;
use crate::pb::bookmark_v1::{
    Bookmark, CreateBookmarkRequest, CreateBookmarkResponse, DeleteBookmarkRequest,
    DeleteBookmarkResponse, ListBookmarksRequest, ListBookmarksResponse,
};
use crate::store::Store;

pub struct BookmarkServiceImpl {
    store: Store,
    rules: AccessRules,
}

impl BookmarkServiceImpl {
    pub fn new(store: Store) -> Self {
        Self { store, rules: AccessRules::from_contract() }
    }
}

fn api_bookmark(b: crate::store::Bookmark) -> Bookmark {
    Bookmark { id: b.id, url: b.url, title: b.title, created_at: b.created_at }
}

fn internal(err: sqlx::Error) -> Status {
    eprintln!("store error: {err}");
    Status::internal("storage error")
}

#[tonic::async_trait]
impl BookmarkService for BookmarkServiceImpl {
    async fn create_bookmark(
        &self,
        request: Request<CreateBookmarkRequest>,
    ) -> Result<Response<CreateBookmarkResponse>, Status> {
        let claims = authorize(&self.rules, &request, "bookmark.v1.BookmarkService.CreateBookmark")?;
        let msg = request.into_inner();
        // buf.validate rules from the proto, enforced by hand: Rust has no
        // first-party protovalidate runtime (see PATTERN.md Key points).
        if msg.url.is_empty() || msg.url.len() > 2048 {
            return Err(Status::invalid_argument("url must be 1..2048 characters"));
        }
        if msg.title.len() > 200 {
            return Err(Status::invalid_argument("title must be at most 200 characters"));
        }
        let created = self
            .store
            .create(&claims.subject, &msg.url, &msg.title)
            .await
            .map_err(internal)?;
        Ok(Response::new(CreateBookmarkResponse { bookmark: Some(api_bookmark(created)) }))
    }

    async fn list_bookmarks(
        &self,
        request: Request<ListBookmarksRequest>,
    ) -> Result<Response<ListBookmarksResponse>, Status> {
        let claims = authorize(&self.rules, &request, "bookmark.v1.BookmarkService.ListBookmarks")?;
        let bookmarks = self
            .store
            .list_by_user(&claims.subject)
            .await
            .map_err(internal)?
            .into_iter()
            .map(api_bookmark)
            .collect();
        Ok(Response::new(ListBookmarksResponse { bookmarks }))
    }

    async fn delete_bookmark(
        &self,
        request: Request<DeleteBookmarkRequest>,
    ) -> Result<Response<DeleteBookmarkResponse>, Status> {
        let claims = authorize(&self.rules, &request, "bookmark.v1.BookmarkService.DeleteBookmark")?;
        let id = request.into_inner().id;
        let existing = self
            .store
            .by_id(&id)
            .await
            .map_err(internal)?
            .ok_or_else(|| Status::not_found("bookmark not found"))?;
        // Ownership is business logic, on top of the proto-declared role gate.
        let is_owner = existing.user_id == claims.subject;
        let is_admin = self.rules.level(&claims.role) >= self.rules.level("admin");
        if !is_owner && !is_admin {
            return Err(Status::permission_denied("only the owner or an admin can delete a bookmark"));
        }
        self.store.delete(&existing.id).await.map_err(internal)?;
        Ok(Response::new(DeleteBookmarkResponse {}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paseto::Claims;

    async fn service() -> BookmarkServiceImpl {
        BookmarkServiceImpl::new(Store::open(":memory:").await.unwrap())
    }

    fn with_claims<T>(message: T, subject: &str, role: &str) -> Request<T> {
        let mut request = Request::new(message);
        request.extensions_mut().insert(Claims {
            subject: subject.to_owned(),
            role: role.to_owned(),
            issued_at: "2026-07-15T12:00:00Z".to_owned(),
            expires_at: "2036-07-12T12:00:00Z".to_owned(),
        });
        request
    }

    #[tokio::test]
    async fn create_list_delete_scoped_to_subject() {
        let svc = service().await;
        let created = svc
            .create_bookmark(with_claims(
                CreateBookmarkRequest { url: "https://buf.build".into(), title: "buf".into() },
                "alice",
                "user",
            ))
            .await
            .unwrap()
            .into_inner()
            .bookmark
            .unwrap();

        let alice_list = svc
            .list_bookmarks(with_claims(ListBookmarksRequest {}, "alice", "user"))
            .await
            .unwrap()
            .into_inner();
        assert_eq!(alice_list.bookmarks.len(), 1);

        // Scoped: bob sees nothing.
        let bob_list = svc
            .list_bookmarks(with_claims(ListBookmarksRequest {}, "bob", "user"))
            .await
            .unwrap()
            .into_inner();
        assert!(bob_list.bookmarks.is_empty());

        // bob (role user) cannot delete alice's bookmark; an admin can.
        let denied = svc
            .delete_bookmark(with_claims(
                DeleteBookmarkRequest { id: created.id.clone() },
                "bob",
                "user",
            ))
            .await
            .unwrap_err();
        assert_eq!(denied.code(), tonic::Code::PermissionDenied);

        svc.delete_bookmark(with_claims(DeleteBookmarkRequest { id: created.id }, "bob", "admin"))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn enforces_the_contract_validation_rules_by_hand() {
        let svc = service().await;
        let err = svc
            .create_bookmark(with_claims(
                CreateBookmarkRequest { url: String::new(), title: String::new() },
                "alice",
                "user",
            ))
            .await
            .unwrap_err();
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
    }

    #[tokio::test]
    async fn deleting_a_missing_bookmark_is_not_found() {
        let svc = service().await;
        let err = svc
            .delete_bookmark(with_claims(DeleteBookmarkRequest { id: "nope".into() }, "alice", "user"))
            .await
            .unwrap_err();
        assert_eq!(err.code(), tonic::Code::NotFound);
    }
}
