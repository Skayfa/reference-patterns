//! Contract-declared input validation for the Rust server.
//!
//! Go and TS enforce the proto's `buf.validate` rules automatically with a
//! first-party protovalidate interceptor. buf ships no official Rust runtime,
//! so we use the community `prost-protovalidate` crate in its runtime-bridge
//! mode: it reads the rules from the SAME committed descriptor set the ACL
//! reflects over (`pb/descriptors.binpb`) and validates a prost message by
//! transcoding it to wire bytes — no build.rs, no hand-written length checks
//! to drift from the contract.

use prost::Message;
use prost_protovalidate::bridge::RuntimeBridge;
use tonic::Status;

static DESCRIPTOR_SET: &[u8] = include_bytes!("pb/descriptors.binpb");

pub struct Validator {
    bridge: RuntimeBridge,
}

impl Validator {
    pub fn from_contract() -> Self {
        Self { bridge: RuntimeBridge::from_fds(DESCRIPTOR_SET) }
    }

    /// Validate a request against its proto `buf.validate` rules. `full_name`
    /// is the message's fully-qualified name (e.g.
    /// "bookmark.v1.CreateBookmarkRequest"). A violation becomes
    /// InvalidArgument, matching the Go/TS interceptors.
    pub fn check<M: Message>(&self, full_name: &str, msg: &M) -> Result<(), Status> {
        self.bridge
            .validate_wire(full_name, &msg.encode_to_vec())
            .map_err(Status::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pb::bookmark_v1::CreateBookmarkRequest;

    #[test]
    fn accepts_valid_and_rejects_empty_url() {
        let v = Validator::from_contract();
        assert!(
            v.check(
                "bookmark.v1.CreateBookmarkRequest",
                &CreateBookmarkRequest { url: "https://buf.build".into(), title: "buf".into() },
            )
            .is_ok()
        );
        let err = v
            .check(
                "bookmark.v1.CreateBookmarkRequest",
                &CreateBookmarkRequest { url: String::new(), title: String::new() },
            )
            .unwrap_err();
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
    }

    #[test]
    fn rejects_over_length_title() {
        let v = Validator::from_contract();
        let err = v
            .check(
                "bookmark.v1.CreateBookmarkRequest",
                &CreateBookmarkRequest {
                    url: "https://example.com".into(),
                    title: "x".repeat(201),
                },
            )
            .unwrap_err();
        assert_eq!(err.code(), tonic::Code::InvalidArgument);
    }
}
