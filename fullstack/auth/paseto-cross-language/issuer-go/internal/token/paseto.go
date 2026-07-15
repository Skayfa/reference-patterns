// Package token signs and verifies PASETO v4.public access tokens.
//
// Interop contract shared with the Rust (pasetors) and TS (paseto-ts)
// verifiers: footer and implicit assertion are EMPTY everywhere, and claims
// are the RFC 3339 strings PASETO mandates (sub, role, iat, exp).
package token

import (
	"fmt"
	"time"

	"aidanwoods.dev/go-paseto"
)

// Claims is the verified content of an access token.
type Claims struct {
	Subject   string
	Role      string
	IssuedAt  time.Time
	ExpiresAt time.Time
}

// Signer holds the Ed25519 secret key. Only the issuer has one.
type Signer struct {
	secret paseto.V4AsymmetricSecretKey
}

func NewSigner(secretHex string) (*Signer, error) {
	secret, err := paseto.NewV4AsymmetricSecretKeyFromHex(secretHex)
	if err != nil {
		return nil, fmt.Errorf("token: bad secret key: %w", err)
	}
	return &Signer{secret: secret}, nil
}

// Sign issues a v4.public token. Returns the token and its expiry as the
// RFC 3339 string embedded in the exp claim.
func (s *Signer) Sign(subject, role string, now time.Time, ttl time.Duration) (string, string, error) {
	exp := now.Add(ttl)
	t := paseto.NewToken()
	t.SetSubject(subject)
	t.SetIssuedAt(now)
	// pasetors' default validation rules require nbf to be present; go-paseto
	// does not emit it on its own. Set it explicitly or Rust rejects the token.
	t.SetNotBefore(now)
	t.SetExpiration(exp)
	t.SetString("role", role)
	return t.V4Sign(s.secret, nil), exp.Format(time.RFC3339), nil
}

// Verifier holds only the Ed25519 public key.
type Verifier struct {
	public paseto.V4AsymmetricPublicKey
	parser paseto.Parser
}

func NewVerifier(publicHex string) (*Verifier, error) {
	public, err := paseto.NewV4AsymmetricPublicKeyFromHex(publicHex)
	if err != nil {
		return nil, fmt.Errorf("token: bad public key: %w", err)
	}
	// The default parser already enforces exp/iat/nbf validity.
	return &Verifier{public: public, parser: paseto.NewParser()}, nil
}

func (v *Verifier) Verify(raw string) (Claims, error) {
	t, err := v.parser.ParseV4Public(v.public, raw, nil)
	if err != nil {
		return Claims{}, fmt.Errorf("token: verify: %w", err)
	}
	subject, err := t.GetSubject()
	if err != nil {
		return Claims{}, fmt.Errorf("token: missing sub: %w", err)
	}
	role, err := t.GetString("role")
	if err != nil {
		return Claims{}, fmt.Errorf("token: missing role: %w", err)
	}
	issuedAt, err := t.GetIssuedAt()
	if err != nil {
		return Claims{}, fmt.Errorf("token: missing iat: %w", err)
	}
	expiresAt, err := t.GetExpiration()
	if err != nil {
		return Claims{}, fmt.Errorf("token: missing exp: %w", err)
	}
	return Claims{Subject: subject, Role: role, IssuedAt: issuedAt, ExpiresAt: expiresAt}, nil
}
