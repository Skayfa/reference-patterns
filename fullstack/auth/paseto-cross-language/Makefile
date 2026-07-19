# One command regenerates every derived artifact from the two sources of
# truth (proto/ and issuer-go/internal/store/{migrations,queries.sql}).
.PHONY: generate
generate:
	buf generate --template buf.gen.go.yaml
	buf generate --template buf.gen.rust.yaml
	buf generate --template buf.gen.ts.yaml
	buf build -o verifier-rust/src/pb/descriptors.binpb
	cd issuer-go && sqlc generate
