// Hand-written glue over the committed buf codegen (neoeinstein-prost +
// neoeinstein-tonic). The prost output ends with `include!("demo.v1.tonic.rs")`,
// so pulling in the one file brings messages and service stubs together.
//
// auth/v1 is generated too (buf generates the whole module) but the Rust
// server only implements demo.v1.ProtectedService, so it is not included.
pub mod demo_v1 {
    include!("demo/v1/demo.v1.rs");
}

pub mod bookmark_v1 {
    include!("bookmark/v1/bookmark.v1.rs");
}
