import { useFormContext } from "./form-context.js";

/**
 * Form-level server error: the `form` part of the { form, fields } object
 * returned by the onSubmitAsync validator. Refreshed on every submit.
 */
export function FormError() {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        typeof error === "string" ? <p role="alert">{error}</p> : null
      }
    </form.Subscribe>
  );
}
