import { createCallable } from "react-call";

export interface ConfirmProps {
  message: string;
}

export type ConfirmResponse = boolean;

/**
 * An awaitable confirm dialog: `await Confirm.call({ message })` resolves
 * with the user's choice. The callable is itself the root component —
 * mount <Confirm /> once, near the app root, for calls to render.
 */
export const Confirm = createCallable<ConfirmProps, ConfirmResponse>(
  ({ call, message }) => (
    <div role="dialog" aria-modal="true">
      <p>{message}</p>
      <button type="button" onClick={() => call.end(true)}>
        Yes
      </button>
      <button type="button" onClick={() => call.end(false)}>
        No
      </button>
    </div>
  ),
);
