// Package protected is the Go implementation of demo.v1.ProtectedService —
// the same service Rust and TS implement, verifying the same tokens with the
// same public key.
package protected

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/token"
	authv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1"
	demov1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/demo/v1"
)

type claimsKey struct{}

// AccessRuleFor reads the (auth.v1.access) option declared on the RPC in
// the proto — the contract itself says which permission it requires. nil =
// the RPC declares neither a permission nor public, which the default-deny
// posture treats as forbidden.
func AccessRuleFor(procedure string) *authv1.AccessRule {
	name := strings.ReplaceAll(strings.TrimPrefix(procedure, "/"), "/", ".")
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
	if err != nil {
		return nil
	}
	method, ok := desc.(protoreflect.MethodDescriptor)
	if !ok {
		return nil
	}
	opts, ok := method.Options().(*descriptorpb.MethodOptions)
	if !ok {
		return nil
	}
	rule, _ := proto.GetExtension(opts, authv1.E_Access).(*authv1.AccessRule)
	if rule.GetPermission() == "" && !rule.GetPublic() {
		return nil
	}
	return rule
}

// roleGrants is the role → grant-pattern map, read once from the Role enum's
// (auth.v1.grants) value options — the contract is the single source of truth.
var roleGrants = buildRoleGrants()

func buildRoleGrants() map[string][]string {
	grants := map[string][]string{}
	values := authv1.Role(0).Descriptor().Values()
	for i := 0; i < values.Len(); i++ {
		v := values.Get(i)
		opts, ok := v.Options().(*descriptorpb.EnumValueOptions)
		if !ok {
			continue
		}
		patterns, _ := proto.GetExtension(opts, authv1.E_Grants).([]string)
		// Store under the claim form: lower-cased, no "ROLE_" prefix.
		name := strings.ToLower(strings.TrimPrefix(string(v.Name()), "ROLE_"))
		grants[name] = patterns
	}
	return grants
}

// MatchGrant reports whether a grant pattern covers a permission: "*" matches
// everything, an exact string matches itself, and "prefix.*" matches any
// permission under "prefix." — so "notes.*" covers "notes.write" and any
// future "notes.<x>", while "admin.notes.delete_any" stays outside it.
func MatchGrant(pattern, permission string) bool {
	switch {
	case pattern == "*" || pattern == permission:
		return true
	case strings.HasSuffix(pattern, ".*"):
		return strings.HasPrefix(permission, pattern[:len(pattern)-1])
	default:
		return false
	}
}

// Authorized reports whether a role's grants cover the permission. Role
// matching is case-insensitive; an unknown role has no grants and passes
// nothing. Reused by the interceptor and by handler-level elevated checks.
func Authorized(role, permission string) bool {
	for _, pattern := range roleGrants[strings.ToLower(role)] {
		if MatchGrant(pattern, permission) {
			return true
		}
	}
	return false
}

// NewAuthInterceptor guards the authenticated services: it always requires a
// valid Bearer PASETO, enforces the minimum role the proto declares for the
// RPC (default-deny when no rule is declared), and stashes the claims in the
// context. Verification is local: only the public key.
//
// Truly public RPCs (public: true — the whole AuthService) are mounted on a
// separate handler WITHOUT this interceptor; see newMux. This interceptor is
// never placed in front of a public RPC, so it always demands a token. A
// public rule reaching it is therefore a mount mistake, and is refused rather
// than silently waved through.
func NewAuthInterceptor(verifier *token.Verifier) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			raw, ok := strings.CutPrefix(req.Header().Get("Authorization"), "Bearer ")
			if !ok || raw == "" {
				return nil, connect.NewError(connect.CodeUnauthenticated,
					errors.New("missing bearer token"))
			}
			claims, err := verifier.Verify(raw)
			if err != nil {
				return nil, connect.NewError(connect.CodeUnauthenticated,
					errors.New("invalid token"))
			}
			rule := AccessRuleFor(req.Spec().Procedure)
			switch {
			case rule == nil:
				return nil, connect.NewError(connect.CodePermissionDenied,
					errors.New("no access rule declared for this rpc"))
			case rule.GetPublic():
				return nil, connect.NewError(connect.CodePermissionDenied,
					errors.New("public rpc mounted behind the auth interceptor — mount it without one"))
			case !Authorized(claims.Role, rule.GetPermission()):
				return nil, connect.NewError(connect.CodePermissionDenied,
					errors.New("permission required: "+rule.GetPermission()))
			}
			return next(context.WithValue(ctx, claimsKey{}, claims), req)
		}
	}
}

func ClaimsFrom(ctx context.Context) (token.Claims, error) {
	claims, ok := ctx.Value(claimsKey{}).(token.Claims)
	if !ok {
		return token.Claims{}, connect.NewError(connect.CodeInternal,
			errors.New("handler mounted without auth interceptor"))
	}
	return claims, nil
}

type Service struct{}

func (Service) WhoAmI(
	ctx context.Context, _ *connect.Request[demov1.WhoAmIRequest],
) (*connect.Response[demov1.WhoAmIResponse], error) {
	claims, err := ClaimsFrom(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&demov1.WhoAmIResponse{
		Subject:   claims.Subject,
		Role:      claims.Role,
		IssuedAt:  claims.IssuedAt.Format(time.RFC3339),
		ExpiresAt: claims.ExpiresAt.Format(time.RFC3339),
		ServedBy:  "go-connect",
	}), nil
}

func (Service) AdminOnly(
	ctx context.Context, _ *connect.Request[demov1.AdminOnlyRequest],
) (*connect.Response[demov1.AdminOnlyResponse], error) {
	// The role check happened in the interceptor, driven by the proto's
	// (auth.v1.access) option — nothing to re-check here.
	if _, err := ClaimsFrom(ctx); err != nil {
		return nil, err
	}
	return connect.NewResponse(&demov1.AdminOnlyResponse{
		Secret: "the go server trusts your admin token",
	}), nil
}
