import { useFormContext } from "./form-context.js";

/**
 * Form-level server error (errorMap.onServer). The framework clears the
 * onServer cause on the next change/blur validation cycle, so the message
 * disappears — and canSubmit recovers — as soon as the user edits.
 */
export function FormError() {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.errorMap.onServer}>
      {(error) => (error ? <p role="alert">{String(error)}</p> : null)}
    </form.Subscribe>
  );
}
