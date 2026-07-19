// Regenerates keys/go-signed-admin.paseto: a long-lived token signed by the
// Go issuer with the dev key. The Rust and TS unit tests verify this exact
// string — the committed cross-language interop proof.
package main

import (
	"fmt"
	"time"

	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/token"
)

func main() {
	signer, err := token.NewSigner(token.DevSecretHex)
	if err != nil {
		panic(err)
	}
	issued := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	raw, _, err := signer.Sign("fixture-admin", "admin", issued, 10*365*24*time.Hour)
	if err != nil {
		panic(err)
	}
	fmt.Print(raw)
}
