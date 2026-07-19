package token

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestSignAndVerifyRoundTrip(t *testing.T) {
	signer, err := NewSigner(DevSecretHex)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := NewVerifier(DevPublicHex)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().Truncate(time.Second)
	raw, expiresAt, err := signer.Sign("user-123", "admin", now, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(raw, "v4.public.") {
		t.Fatalf("expected v4.public token, got %q", raw)
	}

	claims, err := verifier.Verify(raw)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user-123" || claims.Role != "admin" {
		t.Errorf("claims = %+v", claims)
	}
	if got := claims.ExpiresAt.Format(time.RFC3339); got != expiresAt {
		t.Errorf("expiry mismatch: claim %s vs returned %s", got, expiresAt)
	}
}

func TestVerifyRejectsExpired(t *testing.T) {
	signer, _ := NewSigner(DevSecretHex)
	verifier, _ := NewVerifier(DevPublicHex)

	raw, _, err := signer.Sign("user-123", "user", time.Now().Add(-time.Hour), 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Verify(raw); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestVerifyRejectsTampered(t *testing.T) {
	signer, _ := NewSigner(DevSecretHex)
	verifier, _ := NewVerifier(DevPublicHex)

	raw, _, err := signer.Sign("user-123", "user", time.Now(), 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	tampered := []byte(raw)
	i := len(tampered) / 2
	if tampered[i] == 'a' {
		tampered[i] = 'b'
	} else {
		tampered[i] = 'a'
	}
	if _, err := verifier.Verify(string(tampered)); err == nil {
		t.Fatal("expected tampered token to be rejected")
	}
}

// The constants in devkeys.go must match the files the Rust and TS sides read.
func TestDevKeysMatchCommittedFiles(t *testing.T) {
	for path, want := range map[string]string{
		"../../../keys/dev.secret.hex": DevSecretHex,
		"../../../keys/dev.public.hex": DevPublicHex,
	} {
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.TrimSpace(string(got)) != want {
			t.Errorf("%s out of sync with devkeys.go", path)
		}
	}
}
