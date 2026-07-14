import { Code, ConnectError } from "@connectrpc/connect";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ViolationsSchema } from "../src/pb/buf/validate/validate_pb.js";
import type { SubscribeRequest } from "../src/pb/example/v1/newsletter_pb.js";
import { SubscribeForm } from "../src/subscribe-form.js";
import { renderWithNewsletter } from "./test-utils.js";

// What the Go protovalidate interceptor attaches to invalid_argument
// errors: a Violations message as an outgoing {desc, value} error detail.
const violationsDetail = (field: string, message: string) => ({
  desc: ViolationsSchema,
  value: {
    violations: [{ field: { elements: [{ fieldName: field }] }, message }],
  },
});

async function submitValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Name"), "Ada");
  await user.click(screen.getByRole("button", { name: "Subscribe" }));
}

describe("SubscribeForm", () => {
  it("shows field errors and blocks submit on invalid input", async () => {
    const user = userEvent.setup();
    const subscribe = vi.fn();
    renderWithNewsletter(<SubscribeForm />, { subscribe });

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
    renderWithNewsletter(<SubscribeForm />, { subscribe });

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

  it("maps server field violations onto the fields, not a global alert", async () => {
    const user = userEvent.setup();
    // A rule the client cannot know (e.g. uniqueness) rejected server-side.
    renderWithNewsletter(<SubscribeForm />, {
      subscribe: () => {
        throw new ConnectError(
          "validation failed",
          Code.InvalidArgument,
          undefined,
          [violationsDetail("email", "email is already subscribed")],
        );
      },
    });

    await submitValidForm(user);

    expect(
      await screen.findByText("email is already subscribed"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recovers after a server rejection: editing re-enables submit", async () => {
    const user = userEvent.setup();
    let calls = 0;
    renderWithNewsletter(<SubscribeForm />, {
      subscribe: () => {
        calls += 1;
        if (calls === 1) {
          throw new ConnectError(
            "validation failed",
            Code.InvalidArgument,
            undefined,
            [violationsDetail("email", "email is already subscribed")],
          );
        }
        return { subscriptionId: "sub_second_try" };
      },
    });

    await submitValidForm(user);
    expect(
      await screen.findByText("email is already subscribed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();

    // Editing clears the onServer cause: the error disappears and
    // canSubmit recovers — no deadlock.
    await user.type(screen.getByLabelText("Email"), "x");
    expect(
      screen.queryByText("email is already subscribed"),
    ).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(await screen.findByText(/sub_second_try/)).toBeInTheDocument();
  });

  it("shows a code-mapped message for non-field errors, never the raw one", async () => {
    const user = userEvent.setup();
    renderWithNewsletter(<SubscribeForm />, {
      subscribe: () => {
        throw new ConnectError("db connection lost", Code.Unavailable);
      },
    });

    await submitValidForm(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Service temporarily unavailable — please retry.",
    );
    expect(alert).not.toHaveTextContent("db connection lost");
  });
});
