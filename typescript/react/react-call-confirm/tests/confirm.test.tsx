import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Confirm } from "../src/confirm.js";
import { DeleteButton } from "../src/delete-button.js";

describe("Confirm", () => {
  it("resolves with true when the user confirms", async () => {
    const user = userEvent.setup();
    render(<Confirm />);

    // .call() pushes into the Root's state from outside React → act().
    let decision!: Promise<boolean>;
    act(() => {
      decision = Confirm.call({ message: "Continue?" });
    });

    expect(screen.getByRole("dialog")).toHaveTextContent("Continue?");
    await user.click(screen.getByRole("button", { name: "Yes" }));

    await expect(decision).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resolves with false when the user declines", async () => {
    const user = userEvent.setup();
    render(<Confirm />);

    let decision!: Promise<boolean>;
    act(() => {
      decision = Confirm.call({ message: "Continue?" });
    });

    await user.click(screen.getByRole("button", { name: "No" }));

    await expect(decision).resolves.toBe(false);
  });

  it("stacks concurrent calls and settles them independently", async () => {
    const user = userEvent.setup();
    render(<Confirm />);

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = Confirm.call({ message: "First?" });
      second = Confirm.call({ message: "Second?" });
    });

    // Newer calls render below the older ones.
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1]).toHaveTextContent("Second?");

    // Answer the second dialog first: calls are independent.
    await user.click(within(dialogs[1]!).getByRole("button", { name: "Yes" }));
    await expect(second).resolves.toBe(true);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await user.click(within(dialogs[0]!).getByRole("button", { name: "No" }));
    await expect(first).resolves.toBe(false);
  });

  it("guards an action behind the confirmation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <>
        <DeleteButton itemName="report.pdf" onDelete={onDelete} />
        <Confirm />
      </>,
    );

    // Decline: the guarded action must not run.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "report.pdf"?');
    await user.click(screen.getByRole("button", { name: "No" }));
    expect(onDelete).not.toHaveBeenCalled();

    // Confirm: it runs exactly once.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
