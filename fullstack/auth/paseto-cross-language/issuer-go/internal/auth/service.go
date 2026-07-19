// Package auth implements auth.v1.AuthService: the only place tokens are
// minted. Refresh tokens are opaque, single-use, and revocable by family;
// access tokens are PASETO v4.public and live entirely client-side.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"

	authv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/store"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/token"
)

const (
	AccessTTL  = 10 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
)

var errInvalidCredentials = errors.New("invalid credentials")
var errInvalidRefresh = errors.New("invalid refresh token")

type Service struct {
	store  *store.Store
	signer *token.Signer
	now    func() time.Time
}

func NewService(st *store.Store, signer *token.Signer) *Service {
	return &Service{store: st, signer: signer, now: time.Now}
}

func (s *Service) SignUp(
	ctx context.Context, req *connect.Request[authv1.SignUpRequest],
) (*connect.Response[authv1.SignUpResponse], error) {
	// Input shape (email format, password length) was already enforced by the
	// protovalidate interceptor, straight from the proto's buf.validate rules.
	hash, err := argon2id.CreateHash(req.Msg.GetPassword(), argon2id.DefaultParams)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	user, err := s.store.CreateUser(ctx, req.Msg.GetEmail(), hash, "user")
	if errors.Is(err, store.ErrEmailTaken) {
		return nil, connect.NewError(connect.CodeAlreadyExists, err)
	}
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.SignUpResponse{UserId: user.ID}), nil
}

func (s *Service) LogIn(
	ctx context.Context, req *connect.Request[authv1.LogInRequest],
) (*connect.Response[authv1.LogInResponse], error) {
	user, err := s.store.UserByEmail(ctx, req.Msg.GetEmail())
	if errors.Is(err, store.ErrNotFound) {
		// Same code and message as a bad password: never reveal which one it was.
		return nil, connect.NewError(connect.CodeUnauthenticated, errInvalidCredentials)
	}
	if err != nil {
		return nil, err
	}
	match, err := argon2id.ComparePasswordAndHash(req.Msg.GetPassword(), user.PasswordHash)
	if err != nil {
		return nil, fmt.Errorf("compare password: %w", err)
	}
	if !match {
		return nil, connect.NewError(connect.CodeUnauthenticated, errInvalidCredentials)
	}

	// A login starts a fresh refresh-token family.
	pair, err := s.issuePair(ctx, user, store.NewID())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.LogInResponse{Tokens: pair}), nil
}

func (s *Service) Refresh(
	ctx context.Context, req *connect.Request[authv1.RefreshRequest],
) (*connect.Response[authv1.RefreshResponse], error) {
	current, err := s.store.RefreshTokenByHash(ctx, hashToken(req.Msg.GetRefreshToken()))
	if errors.Is(err, store.ErrNotFound) {
		return nil, connect.NewError(connect.CodeUnauthenticated, errInvalidRefresh)
	}
	if err != nil {
		return nil, err
	}
	// Fast reuse check for the common already-rotated case; the authoritative
	// guard is the conditional UPDATE in RotateRefreshToken below, which also
	// closes the race between two concurrent Refresh calls.
	if current.RotatedAt != nil {
		if err := s.store.RevokeFamily(ctx, current.FamilyID); err != nil {
			return nil, err
		}
		return nil, connect.NewError(connect.CodeUnauthenticated, errInvalidRefresh)
	}
	if current.RevokedAt != nil || s.now().After(current.ExpiresAt) {
		return nil, connect.NewError(connect.CodeUnauthenticated, errInvalidRefresh)
	}

	user, err := s.store.UserByID(ctx, current.UserID)
	if err != nil {
		return nil, err
	}

	// Sign is pure (no DB); mint the refresh string, then atomically rotate
	// the current token and insert this successor in one transaction.
	access, expiresAt, err := s.signer.Sign(user.ID, user.Role, s.now(), AccessTTL)
	if err != nil {
		return nil, err
	}
	refresh, err := newOpaqueToken()
	if err != nil {
		return nil, err
	}
	err = s.store.RotateRefreshToken(
		ctx, current.ID, user.ID, current.FamilyID, hashToken(refresh), s.now().Add(RefreshTTL),
	)
	if errors.Is(err, store.ErrTokenReuse) {
		// Lost the race / replay: another request already rotated this token.
		// Kill the family so the winner's successor dies too.
		if err := s.store.RevokeFamily(ctx, current.FamilyID); err != nil {
			return nil, err
		}
		return nil, connect.NewError(connect.CodeUnauthenticated, errInvalidRefresh)
	}
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.RefreshResponse{Tokens: &authv1.TokenPair{
		AccessToken:     access,
		AccessExpiresAt: expiresAt,
		RefreshToken:    refresh,
	}}), nil
}

func (s *Service) LogOut(
	ctx context.Context, req *connect.Request[authv1.LogOutRequest],
) (*connect.Response[authv1.LogOutResponse], error) {
	current, err := s.store.RefreshTokenByHash(ctx, hashToken(req.Msg.GetRefreshToken()))
	if errors.Is(err, store.ErrNotFound) {
		// Idempotent: logging out an unknown token is still logged out.
		return connect.NewResponse(&authv1.LogOutResponse{}), nil
	}
	if err != nil {
		return nil, err
	}
	if err := s.store.RevokeFamily(ctx, current.FamilyID); err != nil {
		return nil, err
	}
	return connect.NewResponse(&authv1.LogOutResponse{}), nil
}

func (s *Service) issuePair(ctx context.Context, user store.User, familyID string) (*authv1.TokenPair, error) {
	access, expiresAt, err := s.signer.Sign(user.ID, user.Role, s.now(), AccessTTL)
	if err != nil {
		return nil, err
	}
	refresh, err := newOpaqueToken()
	if err != nil {
		return nil, err
	}
	if err := s.store.InsertRefreshToken(
		ctx, user.ID, familyID, hashToken(refresh), s.now().Add(RefreshTTL),
	); err != nil {
		return nil, err
	}
	return &authv1.TokenPair{
		AccessToken:     access,
		AccessExpiresAt: expiresAt,
		RefreshToken:    refresh,
	}, nil
}

func newOpaqueToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("random refresh token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
