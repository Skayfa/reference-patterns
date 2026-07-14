// Composition root: wires the newsletter service to its transport —
// shared handler options, mux, timeouts and graceful shutdown. Business
// logic lives in internal/newsletter.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	"github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/internal/newsletter"
	"github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1/examplev1connect"
)

// defaultHandlerOptions is the option set every service handler mounts
// with — defined once; a second service reuses it as-is. Error
// discipline: handlers only return connect.NewError with deliberate codes
// (a bare error would reach clients as code unknown WITH its message).
func defaultHandlerOptions() []connect.HandlerOption {
	return []connect.HandlerOption{
		// Requests failing the proto's protovalidate rules never reach a
		// handler: invalid_argument + Violations details.
		connect.WithInterceptors(validate.NewInterceptor()),
		// Panics must never leak internals to clients: log server-side,
		// answer with a generic internal error.
		connect.WithRecover(func(_ context.Context, spec connect.Spec, _ http.Header, r any) error {
			slog.Error("panic in handler", "procedure", spec.Procedure, "panic", r)
			return connect.NewError(connect.CodeInternal, errors.New("internal error"))
		}),
	}
}

// newMux is shared by main and the tests, so tests exercise the exact
// handler stack that production serves — interceptors included.
func newMux(svc examplev1connect.NewsletterServiceHandler) *http.ServeMux {
	mux := http.NewServeMux()
	path, handler := examplev1connect.NewNewsletterServiceHandler(svc, defaultHandlerOptions()...)
	mux.Handle(path, handler)
	return mux
}

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = "localhost:8080"
	}

	// Plain HTTP/1.1 is enough for Connect and browser clients; wrap the
	// handler with h2c (golang.org/x/net/http2/h2c) only if plaintext gRPC
	// clients must connect too.
	srv := &http.Server{
		Addr:    addr,
		Handler: newMux(newsletter.NewServer()),
		// Never serve without header timeouts (slowloris).
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("listening", "addr", "http://"+addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "error", err)
			stop()
		}
	}()

	// Graceful shutdown: stop accepting, let in-flight requests finish.
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown", "error", err)
	}
	slog.Info("stopped")
}
