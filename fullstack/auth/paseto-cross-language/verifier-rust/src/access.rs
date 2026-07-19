//! Per-RPC ACL read from the contract itself, extracted at startup from the
//! committed descriptor set (`buf build -o src/pb/descriptors.binpb`): the
//! (auth.v1.access) method option (the required permission string) and the
//! (auth.v1.grants) glob patterns each auth.v1.Role value declares. prost
//! discards custom options at codegen time, so reflection over the
//! descriptors is how Rust sees them.

use std::collections::HashMap;

use prost_reflect::{DescriptorPool, Value};
use tonic::{Request, Status};

use crate::paseto::Claims;

static DESCRIPTOR_SET: &[u8] = include_bytes!("pb/descriptors.binpb");

#[derive(Debug, Clone)]
struct Rule {
    public: bool,
    permission: String,
}

pub struct AccessRules {
    // fully-qualified method name ("demo.v1.ProtectedService.WhoAmI") -> rule
    by_method: HashMap<String, Rule>,
    // role claim ("admin") -> its granted glob patterns
    role_grants: HashMap<String, Vec<String>>,
}

impl AccessRules {
    pub fn from_contract() -> Self {
        let pool = DescriptorPool::decode(DESCRIPTOR_SET).expect("bad descriptor set");
        let access_ext = pool
            .get_extension_by_name("auth.v1.access")
            .expect("auth.v1.access extension not in descriptor set");
        let grants_ext = pool
            .get_extension_by_name("auth.v1.grants")
            .expect("auth.v1.grants extension not in descriptor set");
        let role_enum = pool
            .get_enum_by_name("auth.v1.Role")
            .expect("auth.v1.Role not in descriptor set");

        // role claim ("admin") -> ["*"] etc., straight from the enum-value options.
        let mut role_grants = HashMap::new();
        for value in role_enum.values() {
            let claim = value.name().trim_start_matches("ROLE_").to_lowercase();
            let options = value.options();
            let patterns = if options.has_extension(&grants_ext) {
                options
                    .get_extension(&grants_ext)
                    .as_list()
                    .map(|list| {
                        list.iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            role_grants.insert(claim, patterns);
        }

        // Every service in the contract, not a hardcoded list: a new proto
        // package shows up here with zero Rust changes.
        let mut by_method = HashMap::new();
        for service in pool.services() {
            for method in service.methods() {
                let options = method.options();
                if !options.has_extension(&access_ext) {
                    continue; // absent rule = default deny at check time
                }
                let value = options.get_extension(&access_ext);
                let Some(rule) = value.as_message().map(|m| Rule {
                    public: field_bool(m.get_field_by_name("public").as_deref()),
                    permission: field_string(m.get_field_by_name("permission").as_deref()),
                }) else {
                    continue;
                };
                by_method.insert(method.full_name().to_owned(), rule);
            }
        }
        Self { by_method, role_grants }
    }

    /// Does the role's grants cover this permission? Case-insensitive role,
    /// glob matching identical to Go/TS. Unknown role -> no grants -> false.
    pub fn authorized(&self, claim_role: &str, permission: &str) -> bool {
        self.role_grants
            .get(&claim_role.to_lowercase())
            .is_some_and(|patterns| patterns.iter().any(|p| match_grant(p, permission)))
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
        if rule.permission.is_empty() {
            return Err(Status::permission_denied("no access rule declared for this rpc"));
        }
        if !self.authorized(claim_role, &rule.permission) {
            return Err(Status::permission_denied(format!(
                "permission required: {}",
                rule.permission
            )));
        }
        Ok(())
    }
}

/// A grant pattern covers a permission if it is "*", equals the permission, or
/// is "prefix.*" and the permission starts with "prefix." — so "notes.*"
/// covers "notes.write" and any future "notes.<x>", while
/// "admin.notes.delete_any" stays outside it.
fn match_grant(pattern: &str, permission: &str) -> bool {
    if pattern == "*" || pattern == permission {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return prefix.ends_with('.') && permission.starts_with(prefix);
    }
    false
}

fn field_bool(v: Option<&Value>) -> bool {
    v.and_then(Value::as_bool).unwrap_or(false)
}

fn field_string(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or_default().to_owned()
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
    fn permissions_come_from_the_proto_annotations() {
        let rules = AccessRules::from_contract();
        // user (notes.*, bookmarks.*, profile.read) passes the resource RPCs.
        assert!(rules.check("demo.v1.ProtectedService.WhoAmI", "user").is_ok());
        assert!(rules.check("bookmark.v1.BookmarkService.CreateBookmark", "user").is_ok());
        // ...but not the admin.diagnostics permission.
        assert_eq!(
            rules.check("demo.v1.ProtectedService.AdminOnly", "user").unwrap_err().code(),
            tonic::Code::PermissionDenied
        );
        // admin's "*" covers everything.
        assert!(rules.check("demo.v1.ProtectedService.AdminOnly", "admin").is_ok());
    }

    #[test]
    fn glob_matching_and_case_insensitive_role() {
        let rules = AccessRules::from_contract();
        // a new permission under an existing prefix is auto-covered.
        assert!(rules.authorized("user", "notes.archive"));
        assert!(rules.authorized("user", "bookmarks.delete"));
        // elevated permission is outside notes.* — user cannot.
        assert!(!rules.authorized("user", "admin.notes.delete_any"));
        // admin "*" matches anything, case-insensitively.
        assert!(rules.authorized("ADMIN", "admin.notes.delete_any"));
        assert!(rules.authorized("Admin", "anything.at.all"));
        // unknown role has no grants.
        assert!(!rules.authorized("intruder", "notes.read"));
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

    // No dead grant: every non-"*" pattern must cover at least one permission
    // in the WHOLE contract (Rust sees it all via the descriptor set), so a
    // typo like "note.*" for "notes.*" fails the build. Elevated permissions
    // enforced in handlers are added to the declared set.
    #[test]
    fn no_dead_grant_pattern() {
        let rules = AccessRules::from_contract();
        let mut perms: Vec<String> = rules
            .by_method
            .values()
            .filter(|r| !r.permission.is_empty())
            .map(|r| r.permission.clone())
            .collect();
        perms.push("admin.notes.delete_any".to_owned());
        perms.push("admin.bookmarks.delete_any".to_owned());

        for (role, patterns) in &rules.role_grants {
            for pattern in patterns {
                if pattern == "*" {
                    continue;
                }
                assert!(
                    perms.iter().any(|p| match_grant(pattern, p)),
                    "role {role:?} grants {pattern:?}, which matches no permission — typo?"
                );
            }
        }
    }
}
