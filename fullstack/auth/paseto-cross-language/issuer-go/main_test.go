package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/auth"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/note"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/protected"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/store"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/token"
	authv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1/authv1connect"
	demov1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/demo/v1"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/demo/v1/demov1connect"
	notev1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/note/v1"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/note/v1/notev1connect"
)

type testClients struct {
	auth      authv1connect.AuthServiceClient
	protected demov1connect.ProtectedServiceClient
	notes     notev1connect.NoteServiceClient
	store     *store.Store
}

// newTestClients boots the exact production handler stack (newMux) over
// httptest, with a throwaway SQLite file and the committed dev keys.
func newTestClients(t *testing.T) testClients {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	signer, err := token.NewSigner(token.DevSecretHex)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := token.NewVerifier(token.DevPublicHex)
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(withCORS(newMux(auth.NewService(st, signer), note.NewService(st), verifier)))
	t.Cleanup(srv.Close)

	return testClients{
		auth:      authv1connect.NewAuthServiceClient(srv.Client(), srv.URL),
		protected: demov1connect.NewProtectedServiceClient(srv.Client(), srv.URL),
		notes:     notev1connect.NewNoteServiceClient(srv.Client(), srv.URL),
		store:     st,
	}
}

func bearer[T any](req *connect.Request[T], accessToken string) *connect.Request[T] {
	req.Header().Set("Authorization", "Bearer "+accessToken)
	return req
}

func signUpAndLogIn(t *testing.T, c testClients, email string) *authv1.TokenPair {
	t.Helper()
	ctx := context.Background()
	if _, err := c.auth.SignUp(ctx, connect.NewRequest(&authv1.SignUpRequest{
		Email: email, Password: "correct horse battery",
	})); err != nil {
		t.Fatal(err)
	}
	res, err := c.auth.LogIn(ctx, connect.NewRequest(&authv1.LogInRequest{
		Email: email, Password: "correct horse battery",
	}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.GetTokens()
}

func TestFullAuthFlow(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	tokens := signUpAndLogIn(t, c, "alice@example.com")

	// The access token opens WhoAmI on the Go resource server.
	who, err := c.protected.WhoAmI(ctx, bearer(connect.NewRequest(&demov1.WhoAmIRequest{}), tokens.GetAccessToken()))
	if err != nil {
		t.Fatal(err)
	}
	if who.Msg.GetRole() != "user" || who.Msg.GetServedBy() != "go-connect" {
		t.Errorf("whoami = %+v", who.Msg)
	}
	if who.Msg.GetExpiresAt() != tokens.GetAccessExpiresAt() {
		t.Errorf("expiry drift: token %s vs whoami %s", tokens.GetAccessExpiresAt(), who.Msg.GetExpiresAt())
	}

	// Refresh rotates: new pair, and both tokens differ.
	refreshed, err := c.auth.Refresh(ctx, connect.NewRequest(&authv1.RefreshRequest{
		RefreshToken: tokens.GetRefreshToken(),
	}))
	if err != nil {
		t.Fatal(err)
	}
	next := refreshed.Msg.GetTokens()
	if next.GetRefreshToken() == tokens.GetRefreshToken() {
		t.Fatal("refresh token was not rotated")
	}
	if _, err := c.protected.WhoAmI(ctx, bearer(connect.NewRequest(&demov1.WhoAmIRequest{}), next.GetAccessToken())); err != nil {
		t.Fatalf("refreshed access token rejected: %v", err)
	}

	// Replaying the rotated token is reuse: refused, and the whole family
	// dies — including the successor that was just issued.
	if _, err := c.auth.Refresh(ctx, connect.NewRequest(&authv1.RefreshRequest{
		RefreshToken: tokens.GetRefreshToken(),
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("replayed refresh: want unauthenticated, got %v", err)
	}
	if _, err := c.auth.Refresh(ctx, connect.NewRequest(&authv1.RefreshRequest{
		RefreshToken: next.GetRefreshToken(),
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("successor after reuse: want unauthenticated, got %v", err)
	}
}

// The default-deny gate: EVERY RPC this server mounts must carry an explicit
// (auth.v1.access) rule — public or a minimum role. A new RPC without one
// fails this test instead of silently shipping an unprotected endpoint.
//
// It ranges over the registry (excluding infrastructure packages), so a newly
// added Go-served package is covered automatically — no hand-maintained list.
// Lives in package main because that's where every mounted service's pb
// package is imported and thus registered. Services this server does NOT
// implement aren't in its registry; the whole contract — including the
// Rust-owned BookmarkService — is gated by the descriptor-set twin in
// verifier-rust/src/access.rs.
func TestEveryRPCDeclaresAnAccessRule(t *testing.T) {
	checked := 0
	protoregistry.GlobalFiles.RangeFiles(func(file protoreflect.FileDescriptor) bool {
		pkg := string(file.Package())
		if strings.HasPrefix(pkg, "google.") || strings.HasPrefix(pkg, "buf.") {
			return true // skip well-known types and the buf.validate deps
		}
		services := file.Services()
		for i := 0; i < services.Len(); i++ {
			service := services.Get(i)
			methods := service.Methods()
			for j := 0; j < methods.Len(); j++ {
				method := methods.Get(j)
				procedure := "/" + string(service.FullName()) + "/" + string(method.Name())
				if protected.AccessRuleFor(procedure) == nil {
					t.Errorf("%s has no (auth.v1.access) rule — annotate it with a permission or public", procedure)
				}
				checked++
			}
		}
		return true
	})
	if checked == 0 {
		t.Fatal("gate found no RPCs to check — registry filter is wrong")
	}
}

// The "no dead grant" check (a pattern matching no permission is a typo) needs
// the WHOLE contract's permissions — bookmarks are served by Rust and aren't
// in this binary's registry — so it lives in verifier-rust/src/access.rs,
// which reads the full descriptor set.

// A stolen refresh token replayed concurrently with the legitimate client
// must not let both through: the conditional-UPDATE rotation guard admits
// exactly one, and the reuse revokes the whole family.
func TestConcurrentRefreshDetectsReuse(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	tokens := signUpAndLogIn(t, c, "race@example.com")

	const n = 8
	var wg sync.WaitGroup
	results := make([]error, n)
	start := make(chan struct{})
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, results[i] = c.auth.Refresh(ctx, connect.NewRequest(&authv1.RefreshRequest{
				RefreshToken: tokens.GetRefreshToken(),
			}))
		}()
	}
	close(start)
	wg.Wait()

	successes := 0
	for _, err := range results {
		switch {
		case err == nil:
			successes++
		case connect.CodeOf(err) == connect.CodeUnauthenticated:
			// expected loser
		default:
			t.Fatalf("unexpected refresh error: %v", err)
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent refresh with the same token: %d succeeded, want exactly 1", successes)
	}
	// Reuse was detected, so the family is revoked: even the winner's
	// successor no longer refreshes.
	if _, err := c.auth.Refresh(ctx, connect.NewRequest(&authv1.RefreshRequest{
		RefreshToken: tokens.GetRefreshToken(),
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("after reuse: want unauthenticated, got %v", err)
	}
}

func TestLogOutRevokesFamily(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	tokens := signUpAndLogIn(t, c, "bob@example.com")
	if _, err := c.auth.LogOut(ctx, connect.NewRequest(&authv1.LogOutRequest{
		RefreshToken: tokens.GetRefreshToken(),
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := c.auth.Refresh(ctx, connect.NewRequest(&authv1.RefreshRequest{
		RefreshToken: tokens.GetRefreshToken(),
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("refresh after logout: want unauthenticated, got %v", err)
	}
	// Logout is idempotent.
	if _, err := c.auth.LogOut(ctx, connect.NewRequest(&authv1.LogOutRequest{
		RefreshToken: tokens.GetRefreshToken(),
	})); err != nil {
		t.Fatalf("second logout: %v", err)
	}
}

func TestInvalidCredentialsAndDuplicateSignup(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	signUpAndLogIn(t, c, "carol@example.com")

	if _, err := c.auth.SignUp(ctx, connect.NewRequest(&authv1.SignUpRequest{
		Email: "carol@example.com", Password: "another password",
	})); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Errorf("duplicate signup: want already_exists, got %v", err)
	}

	for name, req := range map[string]*authv1.LogInRequest{
		"wrong password": {Email: "carol@example.com", Password: "nope nope nope"},
		"unknown email":  {Email: "nobody@example.com", Password: "whatever else"},
	} {
		if _, err := c.auth.LogIn(ctx, connect.NewRequest(req)); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Errorf("%s: want unauthenticated, got %v", name, err)
		}
	}

	if _, err := c.auth.SignUp(ctx, connect.NewRequest(&authv1.SignUpRequest{
		Email: "short@example.com", Password: "short",
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("short password: want invalid_argument, got %v", err)
	}
}

func TestProtectedRejectsBadTokens(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	tokens := signUpAndLogIn(t, c, "dave@example.com")

	// Missing token.
	if _, err := c.protected.WhoAmI(ctx, connect.NewRequest(&demov1.WhoAmIRequest{})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("missing token: want unauthenticated, got %v", err)
	}

	// Tampered token.
	raw := []byte(tokens.GetAccessToken())
	i := len(raw) / 2
	if raw[i] == 'a' {
		raw[i] = 'b'
	} else {
		raw[i] = 'a'
	}
	if _, err := c.protected.WhoAmI(ctx, bearer(connect.NewRequest(&demov1.WhoAmIRequest{}), string(raw))); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("tampered token: want unauthenticated, got %v", err)
	}

	// Expired token, signed with the same dev key.
	signer, _ := token.NewSigner(token.DevSecretHex)
	expired, _, err := signer.Sign("dave", "user", time.Now().Add(-time.Hour), auth.AccessTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.protected.WhoAmI(ctx, bearer(connect.NewRequest(&demov1.WhoAmIRequest{}), expired)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("expired token: want unauthenticated, got %v", err)
	}
}

func TestRBAC(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	tokens := signUpAndLogIn(t, c, "eve@example.com")
	if _, err := c.protected.AdminOnly(ctx, bearer(connect.NewRequest(&demov1.AdminOnlyRequest{}), tokens.GetAccessToken())); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("user calling AdminOnly: want permission_denied, got %v", err)
	}

	// Promote and log in again: the new token carries role=admin.
	if err := c.store.PromoteToAdmin(ctx, "eve@example.com"); err != nil {
		t.Fatal(err)
	}
	res, err := c.auth.LogIn(ctx, connect.NewRequest(&authv1.LogInRequest{
		Email: "eve@example.com", Password: "correct horse battery",
	}))
	if err != nil {
		t.Fatal(err)
	}
	admin, err := c.protected.AdminOnly(ctx, bearer(connect.NewRequest(&demov1.AdminOnlyRequest{}), res.Msg.GetTokens().GetAccessToken()))
	if err != nil {
		t.Fatal(err)
	}
	if admin.Msg.GetSecret() == "" {
		t.Error("expected a secret for admins")
	}
}

func TestNotesFlow(t *testing.T) {
	c := newTestClients(t)
	ctx := context.Background()

	alice := signUpAndLogIn(t, c, "alice@example.com")
	mallory := signUpAndLogIn(t, c, "mallory@example.com")

	// Unauthenticated and invalid inputs are stopped before the handler.
	if _, err := c.notes.CreateNote(ctx, connect.NewRequest(&notev1.CreateNoteRequest{Text: "x"})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("no token: want unauthenticated, got %v", err)
	}
	if _, err := c.notes.CreateNote(ctx, bearer(connect.NewRequest(&notev1.CreateNoteRequest{Text: ""}), alice.GetAccessToken())); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("empty text: want invalid_argument (protovalidate), got %v", err)
	}

	created, err := c.notes.CreateNote(ctx, bearer(connect.NewRequest(&notev1.CreateNoteRequest{Text: "first note"}), alice.GetAccessToken()))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.notes.CreateNote(ctx, bearer(connect.NewRequest(&notev1.CreateNoteRequest{Text: "second note"}), alice.GetAccessToken())); err != nil {
		t.Fatal(err)
	}

	// Notes are scoped to the token's subject: alice sees 2, mallory sees 0.
	aliceList, err := c.notes.ListNotes(ctx, bearer(connect.NewRequest(&notev1.ListNotesRequest{}), alice.GetAccessToken()))
	if err != nil {
		t.Fatal(err)
	}
	if len(aliceList.Msg.GetNotes()) != 2 {
		t.Fatalf("alice notes = %d, want 2", len(aliceList.Msg.GetNotes()))
	}
	malloryList, err := c.notes.ListNotes(ctx, bearer(connect.NewRequest(&notev1.ListNotesRequest{}), mallory.GetAccessToken()))
	if err != nil {
		t.Fatal(err)
	}
	if len(malloryList.Msg.GetNotes()) != 0 {
		t.Fatalf("mallory notes = %d, want 0", len(malloryList.Msg.GetNotes()))
	}

	// Deletion is owner-or-admin: mallory can't, alice can, an admin can.
	noteID := created.Msg.GetNote().GetId()
	if _, err := c.notes.DeleteNote(ctx, bearer(connect.NewRequest(&notev1.DeleteNoteRequest{Id: noteID}), mallory.GetAccessToken())); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("mallory deleting alice's note: want permission_denied, got %v", err)
	}
	if _, err := c.notes.DeleteNote(ctx, bearer(connect.NewRequest(&notev1.DeleteNoteRequest{Id: noteID}), alice.GetAccessToken())); err != nil {
		t.Fatalf("alice deleting her note: %v", err)
	}
	if _, err := c.notes.DeleteNote(ctx, bearer(connect.NewRequest(&notev1.DeleteNoteRequest{Id: noteID}), alice.GetAccessToken())); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("deleting twice: want not_found, got %v", err)
	}

	if err := c.store.PromoteToAdmin(ctx, "mallory@example.com"); err != nil {
		t.Fatal(err)
	}
	res, err := c.auth.LogIn(ctx, connect.NewRequest(&authv1.LogInRequest{Email: "mallory@example.com", Password: "correct horse battery"}))
	if err != nil {
		t.Fatal(err)
	}
	remaining := aliceList.Msg.GetNotes()[0].GetId()
	if remaining == noteID {
		remaining = aliceList.Msg.GetNotes()[1].GetId()
	}
	if _, err := c.notes.DeleteNote(ctx, bearer(connect.NewRequest(&notev1.DeleteNoteRequest{Id: remaining}), res.Msg.GetTokens().GetAccessToken())); err != nil {
		t.Fatalf("admin deleting alice's note: %v", err)
	}
}

func TestCORSPreflight(t *testing.T) {
	srv := httptest.NewServer(withCORS(http.NotFoundHandler()))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/anything", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Errorf("preflight status = %d", res.StatusCode)
	}
	if res.Header.Get("Access-Control-Allow-Origin") == "" {
		t.Error("missing CORS headers on preflight")
	}
}
