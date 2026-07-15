//! PASETO v4.public verification with only the Ed25519 public key.
//!
//! Interop contract with the Go issuer and TS verifier: footer and implicit
//! assertion are EMPTY, claims are RFC 3339 strings (sub, role, iat, exp).

use pasetors::claims::ClaimsValidationRules;
use pasetors::keys::AsymmetricPublicKey;
use pasetors::token::UntrustedToken;
use pasetors::version4::V4;
use pasetors::{public, Public};

pub const DEV_PUBLIC_HEX: &str = include_str!("../../keys/dev.public.hex");

#[derive(Debug, Clone, PartialEq)]
pub struct Claims {
    pub subject: String,
    pub role: String,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Debug)]
pub enum VerifyError {
    BadKey,
    Invalid(String),
    MissingClaim(&'static str),
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerifyError::BadKey => write!(f, "bad public key"),
            VerifyError::Invalid(e) => write!(f, "invalid token: {e}"),
            VerifyError::MissingClaim(c) => write!(f, "missing claim: {c}"),
        }
    }
}

impl std::error::Error for VerifyError {}

pub struct Verifier {
    public_key: AsymmetricPublicKey<V4>,
}

impl Verifier {
    pub fn from_hex(public_key_hex: &str) -> Result<Self, VerifyError> {
        let bytes = hex::decode(public_key_hex.trim()).map_err(|_| VerifyError::BadKey)?;
        let public_key =
            AsymmetricPublicKey::<V4>::from(&bytes).map_err(|_| VerifyError::BadKey)?;
        Ok(Self { public_key })
    }

    pub fn verify(&self, raw: &str) -> Result<Claims, VerifyError> {
        let untrusted = UntrustedToken::<Public, V4>::try_from(raw)
            .map_err(|e| VerifyError::Invalid(e.to_string()))?;
        // Default rules validate exp/iat/nbf when present.
        let rules = ClaimsValidationRules::new();
        let trusted = public::verify(&self.public_key, &untrusted, &rules, None, None)
            .map_err(|e| VerifyError::Invalid(e.to_string()))?;
        let claims = trusted
            .payload_claims()
            .ok_or(VerifyError::MissingClaim("payload"))?;

        let get = |name: &'static str| -> Result<String, VerifyError> {
            claims
                .get_claim(name)
                .and_then(|v| v.as_str())
                .map(str::to_owned)
                .ok_or(VerifyError::MissingClaim(name))
        };
        Ok(Claims {
            subject: get("sub")?,
            role: get("role")?,
            issued_at: get("iat")?,
            expires_at: get("exp")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pasetors::claims::Claims as SignClaims;
    use pasetors::keys::AsymmetricSecretKey;

    const DEV_SECRET_HEX: &str = include_str!("../../keys/dev.secret.hex");
    /// Signed by the Go issuer (issuer-go/cmd/genfixture): the cross-language proof.
    const GO_SIGNED_ADMIN: &str = include_str!("../../keys/go-signed-admin.paseto");

    fn sign_local(build: impl FnOnce(&mut SignClaims)) -> String {
        let bytes = hex::decode(DEV_SECRET_HEX.trim()).unwrap();
        let secret = AsymmetricSecretKey::<V4>::from(&bytes).unwrap();
        let mut claims = SignClaims::new().unwrap();
        build(&mut claims);
        public::sign(&secret, &claims, None, None).unwrap()
    }

    #[test]
    fn verifies_go_signed_fixture() {
        let verifier = Verifier::from_hex(DEV_PUBLIC_HEX).unwrap();
        let claims = verifier.verify(GO_SIGNED_ADMIN).unwrap();
        assert_eq!(claims.subject, "fixture-admin");
        assert_eq!(claims.role, "admin");
        assert_eq!(claims.issued_at, "2026-07-15T12:00:00Z");
        assert_eq!(claims.expires_at, "2036-07-12T12:00:00Z");
    }

    #[test]
    fn verifies_locally_signed_token() {
        let raw = sign_local(|c| {
            c.subject("user-1").unwrap();
            c.add_additional("role", "user").unwrap();
        });
        let verifier = Verifier::from_hex(DEV_PUBLIC_HEX).unwrap();
        let claims = verifier.verify(&raw).unwrap();
        assert_eq!(claims.subject, "user-1");
        assert_eq!(claims.role, "user");
    }

    #[test]
    fn rejects_expired() {
        let raw = sign_local(|c| {
            c.subject("user-1").unwrap();
            c.add_additional("role", "user").unwrap();
            c.expiration("2020-01-01T00:00:00Z").unwrap();
        });
        let verifier = Verifier::from_hex(DEV_PUBLIC_HEX).unwrap();
        assert!(verifier.verify(&raw).is_err());
    }

    #[test]
    fn rejects_tampered() {
        let mut tampered = GO_SIGNED_ADMIN.to_owned().into_bytes();
        let i = tampered.len() / 2;
        tampered[i] = if tampered[i] == b'a' { b'b' } else { b'a' };
        let tampered = String::from_utf8(tampered).unwrap();
        let verifier = Verifier::from_hex(DEV_PUBLIC_HEX).unwrap();
        assert!(verifier.verify(&tampered).is_err());
    }
}
