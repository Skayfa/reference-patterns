import { useFieldContext } from "./form-context.js";

/**
 * Generic text input bound to the current field via context: value,
 * blur/change handlers and error display in one place, written once for
 * every form of the app. No props to thread — <field.TextField label />.
 */
export function TextField({ label }: { label: string }) {
  const field = useFieldContext<string>();
  const [firstError] = field.state.meta.errors;
  const errorMessage =
    typeof firstError === "string" ? firstError : firstError?.message;

  return (
    <label>
      {label}
      <input
        type="text"
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      {field.state.meta.isTouched && !field.state.meta.isValid ? (
        <em>{errorMessage}</em>
      ) : null}
    </label>
  );
}
