package token

// Dev keypair, duplicated from ../../../keys/*.hex because go:embed cannot
// reach outside the module. A test asserts the copies stay in sync.
// See keys/README.md — these are intentionally public, dev/test only.
const (
	DevSecretHex = "0afa3a04763eb7191fd11f1b6c65e86f20c6e7c1e03524403b16f65fcba4c9b9f18763f83ba851af0944d12649365ccfc3c638bdc6105923753178a30159cbfe"
	DevPublicHex = "f18763f83ba851af0944d12649365ccfc3c638bdc6105923753178a30159cbfe"
)
