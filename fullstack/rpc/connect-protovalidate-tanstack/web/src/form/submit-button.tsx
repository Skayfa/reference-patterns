import { useFormContext } from "./form-context.js";

/** Submit button wired to the surrounding form's canSubmit/isSubmitting. */
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
        <button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? pendingLabel : label}
        </button>
      )}
    </form.Subscribe>
  );
}
