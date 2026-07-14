import type { ReactNode } from "react";

import { useFormContext } from "./form-context.js";

/** The <form> element wired to handleSubmit — written once, like the fields. */
export function Form({ children }: { children: ReactNode }) {
  const form = useFormContext();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {children}
    </form>
  );
}
