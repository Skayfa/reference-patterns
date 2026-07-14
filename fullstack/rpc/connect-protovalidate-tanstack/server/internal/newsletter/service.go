// Package newsletter implements the NewsletterService business logic.
// It knows nothing about how it is mounted: interceptors, mux and server
// lifecycle belong to the composition root (main.go).
package newsletter

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"

	validatepb "buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	examplev1 "github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1"
)

type subscription struct {
	email string
	name  string
}

// Server implements examplev1connect.NewsletterServiceHandler. The
// in-memory map is a deliberate stand-in for a database — swap it at the
// composition root when persistence becomes real; no repository interface
// until there are two implementations.
type Server struct {
	mu   sync.RWMutex
	subs map[string]subscription
}

func NewServer() *Server {
	return &Server{subs: make(map[string]subscription)}
}

// Subscribe holds business logic only: by the time it runs, the request
// has already passed the protovalidate rules declared in newsletter.proto.
func (s *Server) Subscribe(
	_ context.Context,
	req *connect.Request[examplev1.SubscribeRequest],
) (*connect.Response[examplev1.SubscribeResponse], error) {
	id := fmt.Sprintf("sub_%x", sha256.Sum256([]byte(req.Msg.GetEmail())))[:16]

	s.mu.Lock()
	_, exists := s.subs[id]
	if !exists {
		s.subs[id] = subscription{email: req.Msg.GetEmail(), name: req.Msg.GetName()}
	}
	s.mu.Unlock()

	if exists {
		// A business rule protovalidate cannot express (uniqueness) still
		// answers through the same channel as rule violations, so clients
		// map it onto the right form field with zero extra code.
		return nil, fieldViolation(connect.CodeAlreadyExists,
			"email", "email is already subscribed")
	}
	return connect.NewResponse(&examplev1.SubscribeResponse{SubscriptionId: id}), nil
}

// GetSubscription is declared NO_SIDE_EFFECTS in the proto, so connect-go
// also serves it over HTTP GET — no extra server code needed.
func (s *Server) GetSubscription(
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

// fieldViolation makes a business rejection addressable to one request
// field, by attaching the same buf.validate.Violations detail the
// protovalidate interceptor emits. Clients that already parse violations
// (see web/src/connect-errors.ts) place the message under the right form
// field with zero extra code; clients that don't still get code+message.
// Without the detail, the frontend could only show a generic form-level
// error. Reuse it for any field-bound rule protovalidate cannot express
// (uniqueness, quotas, dangling references, ...).
func fieldViolation(code connect.Code, field, message string) *connect.Error {
	err := connect.NewError(code, fmt.Errorf("%s: %s", field, message))
	detail, detailErr := connect.NewErrorDetail(&validatepb.Violations{
		Violations: []*validatepb.Violation{{
			Field: &validatepb.FieldPath{
				Elements: []*validatepb.FieldPathElement{{FieldName: proto.String(field)}},
			},
			Message: proto.String(message),
		}},
	})
	if detailErr == nil {
		err.AddDetail(detail)
	}
	return err
}
