// A Connect server whose request validation lives in the proto contract:
// the protovalidate interceptor rejects invalid requests before any
// handler code runs.
package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"net/http"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	examplev1 "github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1"
	"github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1/examplev1connect"
)

type newsletterServer struct{}

// Subscribe only holds business logic: by the time it runs, the request
// has already passed the protovalidate rules declared in newsletter.proto.
func (s *newsletterServer) Subscribe(
	_ context.Context,
	req *connect.Request[examplev1.SubscribeRequest],
) (*connect.Response[examplev1.SubscribeResponse], error) {
	id := fmt.Sprintf("sub_%x", sha256.Sum256([]byte(req.Msg.GetEmail())))[:16]
	return connect.NewResponse(&examplev1.SubscribeResponse{SubscriptionId: id}), nil
}

// newMux is shared by main and the tests, so tests exercise the exact
// handler stack that production serves — interceptor included.
func newMux() *http.ServeMux {
	mux := http.NewServeMux()
	path, handler := examplev1connect.NewNewsletterServiceHandler(
		&newsletterServer{},
		connect.WithInterceptors(validate.NewInterceptor()),
	)
	mux.Handle(path, handler)
	return mux
}

func main() {
	// Plain HTTP/1.1 is enough for Connect and browser clients; wrap with
	// h2c (golang.org/x/net/http2/h2c) only if plaintext gRPC clients must
	// connect too.
	log.Println("listening on http://localhost:8080")
	log.Fatal(http.ListenAndServe("localhost:8080", newMux()))
}
