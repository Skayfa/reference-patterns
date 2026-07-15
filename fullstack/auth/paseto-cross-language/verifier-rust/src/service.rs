//! demo.v1.ProtectedService in Rust: the same service Go and TS implement,
//! verifying the same tokens with the same public key.

use std::sync::Arc;

use tonic::{Request, Response, Status};

use crate::access::{AccessRules, authorize};
use crate::paseto::{Claims, Verifier};
use crate::pb::demo_v1::protected_service_server::ProtectedService;
use crate::pb::demo_v1::{
    AdminOnlyRequest, AdminOnlyResponse, WhoAmIRequest, WhoAmIResponse,
};

pub const SERVED_BY: &str = "rust-tonic";

/// Verifies the Bearer PASETO on every request and stashes the claims in the
/// request extensions. Verification is local: only the public key.
#[derive(Clone)]
pub struct AuthInterceptor {
    verifier: Arc<Verifier>,
}

impl AuthInterceptor {
    pub fn new(verifier: Verifier) -> Self {
        Self { verifier: Arc::new(verifier) }
    }
}

impl tonic::service::Interceptor for AuthInterceptor {
    fn call(&mut self, mut request: Request<()>) -> Result<Request<()>, Status> {
        let header = request
            .metadata()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        let raw = header
            .strip_prefix("Bearer ")
            .filter(|t| !t.is_empty())
            .ok_or_else(|| Status::unauthenticated("missing bearer token"))?;
        let claims = self
            .verifier
            .verify(raw)
            .map_err(|_| Status::unauthenticated("invalid token"))?;
        request.extensions_mut().insert(claims);
        Ok(request)
    }
}

pub struct ProtectedServiceImpl {
    rules: AccessRules,
}

impl ProtectedServiceImpl {
    pub fn new() -> Self {
        Self { rules: AccessRules::from_contract() }
    }
}

#[tonic::async_trait]
impl ProtectedService for ProtectedServiceImpl {
    async fn who_am_i(
        &self,
        request: Request<WhoAmIRequest>,
    ) -> Result<Response<WhoAmIResponse>, Status> {
        let claims = authorize(&self.rules, &request, "demo.v1.ProtectedService.WhoAmI")?;
        Ok(Response::new(WhoAmIResponse {
            subject: claims.subject,
            role: claims.role,
            issued_at: claims.issued_at,
            expires_at: claims.expires_at,
            served_by: SERVED_BY.to_owned(),
        }))
    }

    async fn admin_only(
        &self,
        request: Request<AdminOnlyRequest>,
    ) -> Result<Response<AdminOnlyResponse>, Status> {
        authorize(&self.rules, &request, "demo.v1.ProtectedService.AdminOnly")?;
        Ok(Response::new(AdminOnlyResponse {
            secret: "the rust server trusts your admin token".to_owned(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paseto::DEV_PUBLIC_HEX;
    use tonic::metadata::MetadataValue;
    use tonic::service::Interceptor;

    const GO_SIGNED_ADMIN: &str = include_str!("../../keys/go-signed-admin.paseto");

    fn intercepted(token: Option<&str>) -> Result<Request<()>, Status> {
        let mut request = Request::new(());
        if let Some(token) = token {
            request.metadata_mut().insert(
                "authorization",
                MetadataValue::try_from(format!("Bearer {token}")).unwrap(),
            );
        }
        AuthInterceptor::new(Verifier::from_hex(DEV_PUBLIC_HEX).unwrap()).call(request)
    }

    fn with_claims<T>(message: T, role: &str) -> Request<T> {
        let mut request = Request::new(message);
        request.extensions_mut().insert(Claims {
            subject: "user-1".to_owned(),
            role: role.to_owned(),
            issued_at: "2026-07-15T12:00:00Z".to_owned(),
            expires_at: "2036-07-12T12:00:00Z".to_owned(),
        });
        request
    }

    #[test]
    fn interceptor_accepts_go_signed_token_and_stashes_claims() {
        let request = intercepted(Some(GO_SIGNED_ADMIN)).unwrap();
        let claims = request.extensions().get::<Claims>().unwrap();
        assert_eq!(claims.subject, "fixture-admin");
        assert_eq!(claims.role, "admin");
    }

    #[test]
    fn interceptor_rejects_missing_and_invalid_tokens() {
        assert_eq!(intercepted(None).unwrap_err().code(), tonic::Code::Unauthenticated);
        assert_eq!(intercepted(Some("")).is_err(), true);
        let tampered = GO_SIGNED_ADMIN.replace('a', "b");
        assert_eq!(
            intercepted(Some(&tampered)).unwrap_err().code(),
            tonic::Code::Unauthenticated
        );
    }

    #[tokio::test]
    async fn who_am_i_echoes_claims() {
        let response = ProtectedServiceImpl::new()
            .who_am_i(with_claims(WhoAmIRequest {}, "user"))
            .await
            .unwrap();
        let msg = response.into_inner();
        assert_eq!(msg.subject, "user-1");
        assert_eq!(msg.served_by, SERVED_BY);
    }

    #[tokio::test]
    async fn admin_only_enforces_role() {
        let denied = ProtectedServiceImpl::new()
            .admin_only(with_claims(AdminOnlyRequest {}, "user"))
            .await
            .unwrap_err();
        assert_eq!(denied.code(), tonic::Code::PermissionDenied);

        ProtectedServiceImpl::new()
            .admin_only(with_claims(AdminOnlyRequest {}, "admin"))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn handler_without_interceptor_is_an_internal_error() {
        let err = ProtectedServiceImpl::new()
            .who_am_i(Request::new(WhoAmIRequest {}))
            .await
            .unwrap_err();
        assert_eq!(err.code(), tonic::Code::Internal);
    }
}
