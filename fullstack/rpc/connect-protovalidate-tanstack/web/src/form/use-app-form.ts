import { createFormHook } from "@tanstack/react-form";

import { fieldContext, formContext } from "./form-context.js";
import { FormError } from "./form-error.js";
import { Form } from "./form.js";
import { SubmitButton } from "./submit-button.js";
import { TextField } from "./text-field.js";

/**
 * The app-wide form hook (TanStack's recommended composition pattern):
 * every form gets the pre-bound components as <form.AppField> /
 * <field.TextField> / <form.SubmitButton>. Grow the app's form vocabulary
 * by adding components here — forms themselves stay declarative.
 */
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
  },
  formComponents: {
    Form,
    FormError,
    SubmitButton,
  },
});
