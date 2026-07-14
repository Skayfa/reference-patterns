package main

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"

	examplev1 "github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1"
	"github.com/Skayfa/reference-patterns/fullstack/rpc/connect-protovalidate-tanstack/server/pb/example/v1/examplev1connect"
)

// newTestClient spins up the real handler stack (interceptor included)
// behind httptest and returns a generated client pointed at it.
func newTestClient(t *testing.T) examplev1connect.NewsletterServiceClient {
	t.Helper()
	srv := httptest.NewServer(newMux())
	t.Cleanup(srv.Close)
	return examplev1connect.NewNewsletterServiceClient(srv.Client(), srv.URL)
}

func TestSubscribe(t *testing.T) {
	t.Parallel()
	client := newTestClient(t)
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
