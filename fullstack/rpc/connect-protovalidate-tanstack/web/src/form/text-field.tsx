import { useId } from "react";

import { useFieldContext } from "./form-context.js";

/**
 * Generic text input bound to the current field via context: value,
 * blur/change handlers, error display and ARIA wiring in one place,
 * written once for every form of the app.
 */
export function TextField({ label }: { label: string }) {
  const field = useFieldContext<string>();
  const id = useId();
  const showError = field.state.meta.isTouched && !field.state.meta.isValid;
  const [firstError] = field.state.meta.errors;
  const errorMessage =
    typeof firstError === "string" ? firstError : firstError?.message;

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? `${id}-error` : undefined}
      />
      {showError ? <em id={`${id}-error`}>{errorMessage}</em> : null}
    </div>
  );
}
