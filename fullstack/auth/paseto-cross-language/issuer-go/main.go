// Composition root: wires the auth issuer and the Go resource server to
// their transport — shared handler options, per-service interceptors, CORS,
// graceful shutdown. Business logic lives in internal/.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"connectrpc.com/validate"

	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/auth"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/note"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/protected"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/store"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/token"
	authv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1/authv1connect"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/demo/v1/demov1connect"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/note/v1/notev1connect"
)

// defaultHandlerOptions is mounted by every service. Error discipline:
// handlers only return connect.NewError with deliberate codes.
func defaultHandlerOptions() []connect.HandlerOption {
	return []connect.HandlerOption{
		// Requests failing the proto's buf.validate rules never reach a
		// handler: invalid_argument, straight from the contract.
		connect.WithInterceptors(validate.NewInterceptor()),
		connect.WithRecover(func(_ context.Context, spec connect.Spec, _ http.Header, r any) error {
			slog.Error("panic in handler", "procedure", spec.Procedure, "panic", r)
			return connect.NewError(connect.CodeInternal, errors.New("internal error"))
		}),
	}
}

// newMux is shared by main and the tests, so tests exercise the exact
// handler stack production serves. AuthService is public; ProtectedService
// and NoteService sit behind the PASETO interceptor.
func newMux(authSvc *auth.Service, noteSvc *note.Service, verifier *token.Verifier) *http.ServeMux {
	mux := http.NewServeMux()
	authPath, authHandler := authv1connect.NewAuthServiceHandler(authSvc, defaultHandlerOptions()...)
	mux.Handle(authPath, authHandler)
	protectedOpts := append(defaultHandlerOptions(),
		connect.WithInterceptors(protected.NewAuthInterceptor(verifier)))
	protectedPath, protectedHandler := demov1connect.NewProtectedServiceHandler(
		protected.Service{}, protectedOpts...)
	mux.Handle(protectedPath, protectedHandler)
	notePath, noteHandler := notev1connect.NewNoteServiceHandler(noteSvc, protectedOpts...)
	mux.Handle(notePath, noteHandler)
	return mux
}

// withCORS is the dev posture: any origin. The pattern's point is token
// verification, not an origin allowlist — tighten this in production.
func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers",
			"Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// seedAdmin makes an admin account exist for demos and e2e without a
// "first user wins" rule: signup if missing, then promote. Idempotent.
//
// The seed calls the service struct directly, bypassing the transport's
// protovalidate interceptor, so it validates the request against the same
// contract rules by hand — SEED_ADMIN_* can't create a credential the API
// itself would reject.
func seedAdmin(ctx context.Context, authSvc *auth.Service, st *store.Store, email, password string) error {
	req := &authv1.SignUpRequest{Email: email, Password: password}
	if err := protovalidate.Validate(req); err != nil {
		return fmt.Errorf("seed admin fails the contract rules: %w", err)
	}
	_, err := authSvc.SignUp(ctx, connect.NewRequest(req))
	if err != nil && connect.CodeOf(err) != connect.CodeAlreadyExists {
		return err
	}
	return st.PromoteToAdmin(ctx, email)
}

func main() {
	addr := envOr("ADDR", "localhost:8080")
	dbPath := envOr("DB_PATH", "auth.db")
	secretHex := envOr("PASETO_SECRET_KEY_HEX", token.DevSecretHex)
	publicHex := envOr("PASETO_PUBLIC_KEY_HEX", token.DevPublicHex)

	st, err := store.Open(dbPath)
	if err != nil {
		slog.Error("open store", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	signer, err := token.NewSigner(secretHex)
	if err != nil {
		slog.Error("bad secret key", "error", err)
		os.Exit(1)
	}
	verifier, err := token.NewVerifier(publicHex)
	if err != nil {
		slog.Error("bad public key", "error", err)
		os.Exit(1)
	}

	authSvc := auth.NewService(st, signer)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if email, password := os.Getenv("SEED_ADMIN_EMAIL"), os.Getenv("SEED_ADMIN_PASSWORD"); email != "" && password != "" {
		if err := seedAdmin(ctx, authSvc, st, email, password); err != nil {
			slog.Error("seed admin", "error", err)
			os.Exit(1)
		}
		slog.Info("seeded admin", "email", email)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           withCORS(newMux(authSvc, note.NewService(st), verifier)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("issuer listening", "addr", "http://"+addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown", "error", err)
	}
	slog.Info("stopped")
}
