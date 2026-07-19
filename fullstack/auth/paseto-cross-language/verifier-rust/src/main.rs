//! Composition root: tonic server + grpc-web + CORS, so both native gRPC
//! clients and browsers (via connect-web's gRPC-web transport) can call it.
//! Serves the verifier demo (ProtectedService) AND this server's own entity
//! (BookmarkService, backed by its own SQLite).

mod access;
mod bookmark;
mod paseto;
mod pb;
mod service;
mod store;
mod validate;

use pb::bookmark_v1::bookmark_service_server::BookmarkServiceServer;
use pb::demo_v1::protected_service_server::ProtectedServiceServer;
use tonic_web::GrpcWebLayer;
use tower_http::cors::{Any, CorsLayer};

use crate::bookmark::BookmarkServiceImpl;
use crate::paseto::Verifier;
use crate::service::{AuthInterceptor, ProtectedServiceImpl};
use crate::store::Store;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = std::env::var("ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8082".to_owned())
        .parse()?;
    let public_key_hex =
        std::env::var("PASETO_PUBLIC_KEY_HEX").unwrap_or_else(|_| paseto::DEV_PUBLIC_HEX.to_owned());
    let verifier = Verifier::from_hex(&public_key_hex)?;
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| "bookmarks.db".to_owned());
    let store = Store::open(&db_path).await?;

    // Dev CORS posture: any origin. grpc-web needs the grpc-* headers exposed
    // or the browser client cannot read statuses.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .expose_headers(Any);

    let interceptor = AuthInterceptor::new(verifier);
    let protected = ProtectedServiceServer::with_interceptor(
        ProtectedServiceImpl::new(),
        interceptor.clone(),
    );
    let bookmarks = BookmarkServiceServer::with_interceptor(
        BookmarkServiceImpl::new(store),
        interceptor,
    );

    println!("rust server listening on http://{addr}");
    tonic::transport::Server::builder()
        // grpc-web arrives over HTTP/1.1.
        .accept_http1(true)
        .layer(cors)
        .layer(GrpcWebLayer::new())
        .add_service(protected)
        .add_service(bookmarks)
        .serve_with_shutdown(addr, async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
