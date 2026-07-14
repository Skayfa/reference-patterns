import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GetSubscriptionRequest } from "../src/pb/example/v1/newsletter_pb.js";
import { NewsletterService } from "../src/pb/example/v1/newsletter_pb.js";
import { SubscriptionStatus } from "../src/subscription-status.js";

function renderStatus(
  subscriptionId: string,
  getSubscription: (req: GetSubscriptionRequest) => {
    subscriptionId: string;
    email: string;
    name: string;
  },
) {
  const transport = createRouterTransport(({ service }) => {
    service(NewsletterService, { getSubscription });
  });
  const client = createClient(NewsletterService, transport);
  render(
    <QueryClientProvider
      // retry: false so the not-found case fails immediately instead of
      // going through TanStack Query's default 3 retries.
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SubscriptionStatus client={client} subscriptionId={subscriptionId} />
    </QueryClientProvider>,
  );
}

describe("SubscriptionStatus", () => {
  it("fetches and renders the subscription", async () => {
    const getSubscription = vi.fn((req: GetSubscriptionRequest) => ({
      subscriptionId: req.subscriptionId,
      email: "grace@example.com",
      name: "Grace",
    }));
    renderStatus("sub_42", getSubscription);

    expect(screen.getByText("Loading subscription…")).toBeInTheDocument();
    expect(await screen.findByText(/Grace <grace@example.com>/)).toBeInTheDocument();
    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(getSubscription.mock.calls[0]?.[0]).toMatchObject({
      subscriptionId: "sub_42",
    });
  });

  it("surfaces a not_found error", async () => {
    renderStatus("sub_missing", () => {
      throw new ConnectError("subscription not found", Code.NotFound);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("not_found");
  });
});
