import { useFormContext } from "./form-context.js";

/**
 * Submit button wired to the surrounding form. Per the TanStack Form docs,
 * `disabled` buttons are not accessible — aria-disabled communicates the
 * state while keeping the button clickable: clicking an invalid form
 * re-runs validation (surfacing what is wrong), and clicking after a
 * server rejection retries the submit.
 */
export function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const form = useFormContext();

  return (
    <form.Subscribe
      selector={(state) => [state.canSubmit, state.isSubmitting] as const}
    >
      {([canSubmit, isSubmitting]) => (
        <button
          type="submit"
          aria-disabled={!canSubmit || isSubmitting}
          onClick={(event) => {
            // Only double-submission is actually blocked.
            if (isSubmitting) event.preventDefault();
          }}
        >
          {isSubmitting ? pendingLabel : label}
        </button>
      )}
    </form.Subscribe>
  );
}
