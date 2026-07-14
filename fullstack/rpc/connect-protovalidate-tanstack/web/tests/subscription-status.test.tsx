import { Code, ConnectError } from "@connectrpc/connect";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { GetSubscriptionRequest } from "../src/pb/example/v1/newsletter_pb.js";
import { RpcBoundary } from "../src/rpc-boundary.js";
import { SubscriptionStatus } from "../src/subscription-status.js";
import { renderWithNewsletter } from "./test-utils.js";

// The component is happy-path only; loading and errors are owned by the
// boundary it is mounted under.
function renderStatus(
  subscriptionId: string,
  getSubscription: (req: GetSubscriptionRequest) => {
    subscriptionId: string;
    email: string;
    name: string;
  },
) {
  renderWithNewsletter(
    <RpcBoundary>
      <SubscriptionStatus subscriptionId={subscriptionId} />
    </RpcBoundary>,
    { getSubscription },
  );
}

describe("SubscriptionStatus", () => {
  it("suspends into the fallback, then renders the subscription", async () => {
    const getSubscription = vi.fn((req: GetSubscriptionRequest) => ({
      subscriptionId: req.subscriptionId,
      email: "grace@example.com",
      name: "Grace",
    }));
    renderStatus("sub_42", getSubscription);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(
      await screen.findByText(/Grace <grace@example.com>/),
    ).toBeInTheDocument();
    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(getSubscription.mock.calls[0]?.[0]).toMatchObject({
      subscriptionId: "sub_42",
    });
  });

  it("shows the boundary fallback on not_found, and Retry refetches", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const getSubscription = vi.fn((req: GetSubscriptionRequest) => {
      calls += 1;
      if (calls === 1) {
        throw new ConnectError("subscription sub_late not found", Code.NotFound);
      }
      return {
        subscriptionId: req.subscriptionId,
        email: "grace@example.com",
        name: "Grace",
      };
    });
    renderStatus("sub_late", getSubscription);

    // not_found is not transient: no automatic retry, the boundary shows
    // the code-mapped copy (never the raw message).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not found.");
    expect(alert).not.toHaveTextContent("sub_late");
    expect(getSubscription).toHaveBeenCalledTimes(1);

    // QueryErrorResetBoundary wiring: Retry resets the boundary AND the
    // query, so the refetch actually happens.
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText(/Grace <grace@example.com>/),
    ).toBeInTheDocument();
    expect(getSubscription).toHaveBeenCalledTimes(2);
  });

  it("retries transient failures automatically before ever failing", async () => {
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
    renderStatus("sub_42", getSubscription);

    expect(
      await screen.findByText(/Grace <grace@example.com>/, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(getSubscription).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
