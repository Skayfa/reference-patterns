package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"

	examplev1 "github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1"
	"github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1/examplev1connect"
)

// methodRecorder captures each request's HTTP verb so tests can prove
// which RPCs actually travel as GET.
type methodRecorder struct {
	mu      sync.Mutex
	methods []string
	next    http.Handler
}

func (r *methodRecorder) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mu.Lock()
	r.methods = append(r.methods, req.Method)
	r.mu.Unlock()
	r.next.ServeHTTP(w, req)
}

func (r *methodRecorder) last(t *testing.T) string {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.methods) == 0 {
		t.Fatal("no request recorded")
	}
	return r.methods[len(r.methods)-1]
}

// newTestClient spins up the real handler stack (interceptor included)
// behind httptest and returns a generated client pointed at it.
func newTestClient(t *testing.T, opts ...connect.ClientOption) (examplev1connect.NewsletterServiceClient, *methodRecorder) {
	t.Helper()
	rec := &methodRecorder{next: newMux()}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	return examplev1connect.NewNewsletterServiceClient(srv.Client(), srv.URL, opts...), rec
}

func TestSubscribe(t *testing.T) {
	t.Parallel()
	client, _ := newTestClient(t)
	ctx := context.Background()

	t.Run("valid request returns a subscription id", func(t *testing.T) {
		res, err := client.Subscribe(ctx, connect.NewRequest(&examplev1.SubscribeRequest{
			Email: "ada@example.com",
			Name:  "Ada",
		}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got := res.Msg.GetSubscriptionId(); !strings.HasPrefix(got, "sub_") {
			t.Errorf("subscription id = %q, want sub_ prefix", got)
		}
	})

	// Table of requests the interceptor must reject — the handler never runs.
	invalid := map[string]struct {
		req           *examplev1.SubscribeRequest
		violatedField string
	}{
		"malformed email": {
			req:           &examplev1.SubscribeRequest{Email: "not-an-email", Name: "Ada"},
			violatedField: "email",
		},
		"empty email": {
			req:           &examplev1.SubscribeRequest{Email: "", Name: "Ada"},
			violatedField: "email",
		},
		"name too short": {
			req:           &examplev1.SubscribeRequest{Email: "ada@example.com", Name: "A"},
			violatedField: "name",
		},
	}

	for name, tc := range invalid {
		t.Run("rejects "+name, func(t *testing.T) {
			_, err := client.Subscribe(ctx, connect.NewRequest(tc.req))
			if err == nil {
				t.Fatal("expected a validation error, got none")
			}
			if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument", code)
			}
			var connectErr *connect.Error
			if !errors.As(err, &connectErr) {
				t.Fatal("expected a *connect.Error")
			}
			// protovalidate attaches structured Violations as error details;
			// the violated field name is part of the message.
			if !strings.Contains(connectErr.Message(), tc.violatedField) {
				t.Errorf("message %q does not mention field %q", connectErr.Message(), tc.violatedField)
			}
			if len(connectErr.Details()) == 0 {
				t.Error("expected Violations in error details")
			}
		})
	}
}

func TestGetSubscription(t *testing.T) {
	t.Parallel()
	// WithHTTPGet turns NO_SIDE_EFFECTS methods into HTTP GETs; other
	// methods (Subscribe) keep travelling as POST.
	client, rec := newTestClient(t, connect.WithHTTPGet())
	ctx := context.Background()

	t.Run("reads back over HTTP GET what Subscribe stored over POST", func(t *testing.T) {
		created, err := client.Subscribe(ctx, connect.NewRequest(&examplev1.SubscribeRequest{
			Email: "grace@example.com",
			Name:  "Grace",
		}))
		if err != nil {
			t.Fatal(err)
		}
		if got := rec.last(t); got != http.MethodPost {
			t.Errorf("Subscribe travelled as %s, want POST", got)
		}

		res, err := client.GetSubscription(ctx, connect.NewRequest(&examplev1.GetSubscriptionRequest{
			SubscriptionId: created.Msg.GetSubscriptionId(),
		}))
		if err != nil {
			t.Fatal(err)
		}
		if got := rec.last(t); got != http.MethodGet {
			t.Errorf("GetSubscription travelled as %s, want GET", got)
		}
		if res.Msg.GetEmail() != "grace@example.com" || res.Msg.GetName() != "Grace" {
			t.Errorf("got %q/%q, want stored subscription", res.Msg.GetEmail(), res.Msg.GetName())
		}
	})

	t.Run("unknown id is not_found", func(t *testing.T) {
		_, err := client.GetSubscription(ctx, connect.NewRequest(&examplev1.GetSubscriptionRequest{
			SubscriptionId: "sub_missing",
		}))
		if code := connect.CodeOf(err); code != connect.CodeNotFound {
			t.Fatalf("code = %v, want not_found", code)
		}
	})

	t.Run("validation also applies to GET requests", func(t *testing.T) {
		_, err := client.GetSubscription(ctx, connect.NewRequest(&examplev1.GetSubscriptionRequest{
			SubscriptionId: "",
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", code)
		}
	})
}
