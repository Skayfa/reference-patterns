import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SubscribeRequest } from "../src/pb/example/v1/newsletter_pb.js";
import { NewsletterService } from "../src/pb/example/v1/newsletter_pb.js";
import { SubscribeForm } from "../src/subscribe-form.js";

/**
 * createRouterTransport runs a real Connect service in memory: the form is
 * tested against actual (de)serialization and error semantics, with no
 * network and no fetch mocking.
 */
function renderForm(
  subscribe: (req: SubscribeRequest) => { subscriptionId: string },
) {
  const transport = createRouterTransport(({ service }) => {
    service(NewsletterService, { subscribe });
  });
  const client = createClient(NewsletterService, transport);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscribeForm client={client} />
    </QueryClientProvider>,
  );
}

describe("SubscribeForm", () => {
  it("shows field errors and blocks submit on invalid input", async () => {
    const user = userEvent.setup();
    const subscribe = vi.fn();
    renderForm(subscribe);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Name"), "A");

    // protovalidate's own messages — the same ones the Go server returns,
    // since both sides evaluate the same rules from newsletter.proto.
    expect(
      screen.getByText("must be a valid email address"),
    ).toBeInTheDocument();
    expect(screen.getByText("must be at least 2 characters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("submits valid input and renders the server response", async () => {
    const user = userEvent.setup();
    const subscribe = vi.fn((_req: SubscribeRequest) => ({
      subscriptionId: "sub_test123",
    }));
    renderForm(subscribe);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(await screen.findByText(/sub_test123/)).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]?.[0]).toMatchObject({
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("surfaces a server-side validation rejection", async () => {
    const user = userEvent.setup();
    // Simulates what the Go protovalidate interceptor returns for a rule
    // the client-side schema missed.
    renderForm(() => {
      throw new ConnectError(
        "validation error: email must be a valid email address",
        Code.InvalidArgument,
      );
    });

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("invalid_argument");
    expect(alert).toHaveTextContent("email");
  });
});
