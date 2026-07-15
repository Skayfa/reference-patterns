//! Per-RPC ACL read from the contract itself: the (auth.v1.access) method
//! option and the auth.v1.Role hierarchy, extracted at startup from the
//! committed descriptor set (`buf build -o src/pb/descriptors.binpb`).
//! prost discards custom options at codegen time, so reflection over the
//! descriptors is how Rust sees them.

use std::collections::HashMap;

use prost_reflect::DescriptorPool;
use tonic::{Request, Status};

use crate::paseto::Claims;

static DESCRIPTOR_SET: &[u8] = include_bytes!("pb/descriptors.binpb");

#[derive(Debug, Clone, Copy)]
struct Rule {
    public: bool,
    minimum_role: i32,
}

pub struct AccessRules {
    // fully-qualified method name ("demo.v1.ProtectedService.WhoAmI") -> rule
    by_method: HashMap<String, Rule>,
    // role claim ("admin") -> hierarchy level (auth.v1.Role enum number)
    role_levels: HashMap<String, i32>,
    // level -> lower-cased role name, for error messages
    role_names: HashMap<i32, String>,
}

impl AccessRules {
    pub fn from_contract() -> Self {
        let pool = DescriptorPool::decode(DESCRIPTOR_SET).expect("bad descriptor set");
        let ext = pool
            .get_extension_by_name("auth.v1.access")
            .expect("auth.v1.access extension not in descriptor set");
        let role_enum = pool
            .get_enum_by_name("auth.v1.Role")
            .expect("auth.v1.Role not in descriptor set");

        let mut role_levels = HashMap::new();
        let mut role_names = HashMap::new();
        for value in role_enum.values() {
            // "ROLE_ADMIN" -> claim string "admin"
            let claim = value.name().trim_start_matches("ROLE_").to_lowercase();
            role_levels.insert(claim.clone(), value.number());
            role_names.insert(value.number(), claim);
        }

        // Every service in the contract, not a hardcoded list: a new proto
        // package shows up here with zero Rust changes.
        let mut by_method = HashMap::new();
        for service in pool.services() {
            for method in service.methods() {
                let options = method.options();
                if !options.has_extension(&ext) {
                    continue; // absent rule = default deny at check time
                }
                let value = options.get_extension(&ext);
                let Some(rule) = value.as_message().map(|m| Rule {
                    public: m
                        .get_field_by_name("public")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    minimum_role: m
                        .get_field_by_name("minimum_role")
                        .and_then(|v| v.as_enum_number())
                        .unwrap_or(0),
                }) else {
                    continue;
                };
                by_method.insert(method.full_name().to_owned(), rule);
            }
        }
        Self { by_method, role_levels, role_names }
    }

    /// Hierarchy level of a role claim; unknown claims level 0 (pass nothing).
    /// Case-insensitive, matching Go (ROLE_+upper) and TS (toUpperCase): the
    /// three servers must agree on the same token's role.
    pub fn level(&self, claim_role: &str) -> i32 {
        self.role_levels.get(&claim_role.to_lowercase()).copied().unwrap_or(0)
    }

    /// Default-deny enforcement of the proto-declared rule for this method.
    pub fn check(&self, method_full_name: &str, claim_role: &str) -> Result<(), Status> {
        let Some(rule) = self.by_method.get(method_full_name) else {
            return Err(Status::permission_denied("no access rule declared for this rpc"));
        };
        // Public RPCs are served without the auth interceptor (like Go's
        // AuthService); one reaching this per-handler guard is a mount mistake.
        if rule.public {
            return Err(Status::permission_denied(
                "public rpc mounted behind the auth interceptor — mount it without one",
            ));
        }
        if rule.minimum_role == 0 {
            return Err(Status::permission_denied("no access rule declared for this rpc"));
        }
        if self.level(claim_role) < rule.minimum_role {
            let name = self
                .role_names
                .get(&rule.minimum_role)
                .cloned()
                .unwrap_or_else(|| rule.minimum_role.to_string());
            return Err(Status::permission_denied(format!("{name} role required")));
        }
        Ok(())
    }
}

/// The one-line handler guard: claims were stashed by the AuthInterceptor,
/// the rule comes from the proto. tonic interceptors never see which RPC is
/// called, hence per-handler instead of middleware.
pub fn authorize<T>(
    rules: &AccessRules,
    request: &Request<T>,
    method_full_name: &str,
) -> Result<Claims, Status> {
    let claims = request
        .extensions()
        .get::<Claims>()
        .cloned()
        .ok_or_else(|| Status::internal("handler mounted without auth interceptor"))?;
    rules.check(method_full_name, &claims.role)?;
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_come_from_the_proto_annotations() {
        let rules = AccessRules::from_contract();
        // admin outranks user: hierarchy from the enum numbers.
        assert!(rules.check("demo.v1.ProtectedService.WhoAmI", "user").is_ok());
        assert!(rules.check("demo.v1.ProtectedService.WhoAmI", "admin").is_ok());
        assert!(rules.check("demo.v1.ProtectedService.AdminOnly", "admin").is_ok());
        assert_eq!(
            rules.check("demo.v1.ProtectedService.AdminOnly", "user").unwrap_err().code(),
            tonic::Code::PermissionDenied
        );
        // The Rust-owned service is covered by the same contract mechanism.
        assert!(rules.check("bookmark.v1.BookmarkService.CreateBookmark", "user").is_ok());
    }

    #[test]
    fn role_matching_is_case_insensitive_like_go_and_ts() {
        let rules = AccessRules::from_contract();
        for variant in ["admin", "Admin", "ADMIN"] {
            assert!(
                rules.check("demo.v1.ProtectedService.AdminOnly", variant).is_ok(),
                "role claim {variant:?} should satisfy admin"
            );
        }
    }

    #[test]
    fn default_deny_for_unknown_methods_and_roles() {
        let rules = AccessRules::from_contract();
        assert!(rules.check("demo.v1.ProtectedService.NotARealRpc", "admin").is_err());
        assert_eq!(
            rules.check("demo.v1.ProtectedService.AdminOnly", "intruder").unwrap_err().code(),
            tonic::Code::PermissionDenied
        );
    }

    // The Rust twin of the Go default-deny gate: every method of every
    // service in the contract must carry an explicit rule.
    #[test]
    fn every_rpc_in_the_contract_declares_a_rule() {
        let rules = AccessRules::from_contract();
        let pool = DescriptorPool::decode(DESCRIPTOR_SET).unwrap();
        for service in pool.services() {
            for method in service.methods() {
                assert!(
                    rules.by_method.contains_key(method.full_name()),
                    "{} has no (auth.v1.access) rule",
                    method.full_name()
                );
            }
        }
    }
}
