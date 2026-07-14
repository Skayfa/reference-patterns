import { createFormHookContexts } from "@tanstack/react-form";

// Shared contexts wiring pre-bound components to whichever form renders
// them. Lives in its own file to avoid circular imports (components need
// the contexts, the form hook needs the components).
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
