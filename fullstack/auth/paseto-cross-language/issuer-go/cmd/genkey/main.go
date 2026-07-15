// Prints a fresh Ed25519 keypair in the hex format every server understands.
// The committed pair under keys/ was produced by this command; rotate the
// same way.
package main

import (
	"fmt"

	"aidanwoods.dev/go-paseto"
)

func main() {
	secret := paseto.NewV4AsymmetricSecretKey()
	fmt.Printf("secret: %s\n", secret.ExportHex())
	fmt.Printf("public: %s\n", secret.Public().ExportHex())
}
