import { create } from "@bufbuild/protobuf";
import { createStandardSchema } from "@bufbuild/protovalidate";
import { useMutation } from "@connectrpc/connect-query";
import type { DeepKeys } from "@tanstack/react-form";

import { fieldViolations, serverErrorMap } from "./connect-errors.js";
import { useAppForm } from "./form/use-app-form.js";
import type { SubscribeRequest } from "./pb/example/v1/newsletter_pb.js";
import {
  NewsletterService,
  SubscribeRequestSchema,
} from "./pb/example/v1/newsletter_pb.js";

// Unified validation: the protovalidate rules annotated in newsletter.proto
// travel inside the generated schema, and createStandardSchema evaluates
// them in the browser — the exact rules (and messages) the Go interceptor
// enforces, with no hand-written mirror.
const subscribeValidator = createStandardSchema(SubscribeRequestSchema);

// Runtime-checked narrowing backed by the proto descriptor: a violation
// path is a form field exactly when it is a field of the request message,
// so this predicate cannot drift from the schema.
const isSubscribeField = (path: string): path is DeepKeys<SubscribeRequest> =>
  SubscribeRequestSchema.fields.some((field) => field.localName === path);

export function SubscribeForm() {
  // connect-query wires the mutation to the method descriptor: no
  // mutationFn, no client prop — the transport comes from TransportProvider.
  const mutation = useMutation(NewsletterService.method.subscribe);

  // TanStack Form owns the input state; its values ARE the proto message
  // (created empty here), so the validator and the RPC share one shape.
  const form = useAppForm({
    defaultValues: create(SubscribeRequestSchema),
    validators: { onChange: subscribeValidator },
    onSubmit: async ({ value, formApi }) => {
      try {
        await mutation.mutateAsync(value);
      } catch (error) {
        // Server Violations land under their fields (errorMap.onServer):
        // the framework clears that cause on the user's next edit, so
        // canSubmit recovers. Every other failure stays in TanStack
        // Query's mutation state, which never gates canSubmit — no
        // deadlock on either path.
        for (const [path, message] of Object.entries(fieldViolations(error))) {
          if (isSubscribeField(path)) {
            formApi.setFieldMeta(path, (meta) => ({
              ...meta,
              errorMap: { ...meta.errorMap, onServer: message },
              // "form" marks the error as form-sourced, which is what lets
              // the form's validation cycle clear it on the next edit.
              errorSourceMap: { ...meta.errorSourceMap, onServer: "form" },
            }));
          }
        }
      }
    },
  });

  if (mutation.isSuccess) {
    return <p>Subscribed! Your id: {mutation.data.subscriptionId}</p>;
  }

  // form: a code-mapped message for non-field failures, undefined when the
  // violations already point at fields (no redundant global alert).
  const serverError = mutation.error
    ? serverErrorMap(mutation.error)
    : undefined;

  return (
    <form.AppForm>
      <form.Form>
        <form.AppField name="email">
          {(field) => <field.TextField label="Email" />}
        </form.AppField>

        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
        </form.AppField>

        <form.SubmitButton label="Subscribe" pendingLabel="Subscribing…" />

        {serverError?.form ? <p role="alert">{serverError.form}</p> : null}
      </form.Form>
    </form.AppForm>
  );
}
