import { Code, ConnectError } from "@connectrpc/connect";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GetSubscriptionRequest } from "../src/pb/example/v1/newsletter_pb.js";
import { SubscriptionStatus } from "../src/subscription-status.js";
import { renderWithNewsletter } from "./test-utils.js";

describe("SubscriptionStatus", () => {
  it("fetches and renders the subscription", async () => {
    const getSubscription = vi.fn((req: GetSubscriptionRequest) => ({
      subscriptionId: req.subscriptionId,
      email: "grace@example.com",
      name: "Grace",
    }));
    renderWithNewsletter(<SubscriptionStatus subscriptionId="sub_42" />, {
      getSubscription,
    });

    expect(screen.getByText("Loading subscription…")).toBeInTheDocument();
    expect(
      await screen.findByText(/Grace <grace@example.com>/),
    ).toBeInTheDocument();
    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(getSubscription.mock.calls[0]?.[0]).toMatchObject({
      subscriptionId: "sub_42",
    });
  });

  it("shows a friendly message for not_found — and does not retry it", async () => {
    const getSubscription = vi.fn((): { subscriptionId: string; email: string; name: string } => {
      throw new ConnectError("subscription sub_missing not found", Code.NotFound);
    });
    renderWithNewsletter(<SubscriptionStatus subscriptionId="sub_missing" />, {
      getSubscription,
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not found.");
    expect(alert).not.toHaveTextContent("sub_missing");
    // not_found is not transient: the retry policy never retries it, which
    // is also why this test is fast with the production QueryClient.
    expect(getSubscription).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and eventually renders", async () => {
    let calls = 0;
    const getSubscription = vi.fn((req: GetSubscriptionRequest) => {
      calls += 1;
      if (calls === 1) {
        throw new ConnectError("temporarily down", Code.Unavailable);
      }
      return {
        subscriptionId: req.subscriptionId,
        email: "grace@example.com",
        name: "Grace",
      };
    });
    renderWithNewsletter(<SubscriptionStatus subscriptionId="sub_42" />, {
      getSubscription,
    });

    // First attempt fails with a transient code -> automatically retried.
    expect(
      await screen.findByText(/Grace <grace@example.com>/, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(getSubscription).toHaveBeenCalledTimes(2);
  });
});
