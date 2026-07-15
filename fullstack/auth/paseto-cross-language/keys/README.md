# DEV KEYS ONLY — intentionally public

This Ed25519 keypair is committed so that every test in the pattern is
deterministic and each language can sign its own fixtures. It provides **zero
security**: anyone reading this repo can mint valid tokens for it.

In production: generate a pair at deploy time (`go run ./issuer-go/cmd/genkey`),
keep the secret in a secret manager, and hand only `PASETO_PUBLIC_KEY_HEX` to
the resource servers.

- `dev.secret.hex` — 64-byte secret (seed + public), go-paseto/pasetors format.
- `dev.public.hex` — 32-byte raw Ed25519 public key.

Both files contain bare hex with no trailing newline.
