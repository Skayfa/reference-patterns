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

  it("surfaces a not_found error", async () => {
    renderWithNewsletter(<SubscriptionStatus subscriptionId="sub_missing" />, {
      getSubscription: () => {
        throw new ConnectError("subscription not found", Code.NotFound);
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("not_found");
  });
});
