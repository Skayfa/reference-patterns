// A Connect server whose request validation lives in the proto contract:
// the protovalidate interceptor rejects invalid requests before any
// handler code runs.
package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	examplev1 "github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1"
	"github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1/examplev1connect"
)

type subscription struct {
	email string
	name  string
}

type newsletterServer struct {
	mu   sync.RWMutex
	subs map[string]subscription
}

func newNewsletterServer() *newsletterServer {
	return &newsletterServer{subs: make(map[string]subscription)}
}

// Subscribe only holds business logic: by the time it runs, the request
// has already passed the protovalidate rules declared in newsletter.proto.
func (s *newsletterServer) Subscribe(
	_ context.Context,
	req *connect.Request[examplev1.SubscribeRequest],
) (*connect.Response[examplev1.SubscribeResponse], error) {
	id := fmt.Sprintf("sub_%x", sha256.Sum256([]byte(req.Msg.GetEmail())))[:16]
	s.mu.Lock()
	s.subs[id] = subscription{email: req.Msg.GetEmail(), name: req.Msg.GetName()}
	s.mu.Unlock()
	return connect.NewResponse(&examplev1.SubscribeResponse{SubscriptionId: id}), nil
}

// GetSubscription is declared NO_SIDE_EFFECTS in the proto, so connect-go
// also serves it over HTTP GET — no extra server code needed.
func (s *newsletterServer) GetSubscription(
	_ context.Context,
	req *connect.Request[examplev1.GetSubscriptionRequest],
) (*connect.Response[examplev1.GetSubscriptionResponse], error) {
	s.mu.RLock()
	sub, ok := s.subs[req.Msg.GetSubscriptionId()]
	s.mu.RUnlock()
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("subscription %q not found", req.Msg.GetSubscriptionId()))
	}
	return connect.NewResponse(&examplev1.GetSubscriptionResponse{
		SubscriptionId: req.Msg.GetSubscriptionId(),
		Email:          sub.email,
		Name:           sub.name,
	}), nil
}

// newMux is shared by main and the tests, so tests exercise the exact
// handler stack that production serves — interceptors included. Error
// discipline: handlers only return connect.NewError with deliberate codes
// (a bare error would reach clients as code unknown WITH its message).
func newMux(svc examplev1connect.NewsletterServiceHandler) *http.ServeMux {
	mux := http.NewServeMux()
	path, handler := examplev1connect.NewNewsletterServiceHandler(
		svc,
		connect.WithInterceptors(validate.NewInterceptor()),
		// Panics must never leak internals to clients: log server-side,
		// answer with a generic internal error.
		connect.WithRecover(func(_ context.Context, spec connect.Spec, _ http.Header, r any) error {
			log.Printf("panic in %s: %v", spec.Procedure, r)
			return connect.NewError(connect.CodeInternal, errors.New("internal error"))
		}),
	)
	mux.Handle(path, handler)
	return mux
}

func main() {
	// Plain HTTP/1.1 is enough for Connect and browser clients; wrap with
	// h2c (golang.org/x/net/http2/h2c) only if plaintext gRPC clients must
	// connect too.
	log.Println("listening on http://localhost:8080")
	log.Fatal(http.ListenAndServe("localhost:8080", newMux(newNewsletterServer())))
}
