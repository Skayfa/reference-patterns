import { create } from "@bufbuild/protobuf";
import { createStandardSchema } from "@bufbuild/protovalidate";
import { useMutation } from "@connectrpc/connect-query";

import { serverErrorMap } from "./connect-errors.js";
import { useAppForm } from "./form/use-app-form.js";
import {
  NewsletterService,
  SubscribeRequestSchema,
} from "./pb/example/v1/newsletter_pb.js";

// Unified validation: the protovalidate rules annotated in newsletter.proto
// travel inside the generated schema, and createStandardSchema evaluates
// them in the browser — the exact rules (and messages) the Go interceptor
// enforces, with no hand-written mirror.
const subscribeValidator = createStandardSchema(SubscribeRequestSchema);

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
        // Server Violations land under their fields, anything else becomes
        // a code-mapped form-level message. The onServer cause is cleared
        // by the framework on the next edit, so canSubmit recovers —
        // returning these from onSubmitAsync instead would deadlock the
        // disabled submit button (onSubmit errors only clear on submit).
        // Cast: setErrorMap distributes the {form, fields} shape on any
        // cause at runtime, but form-core types the onServer slot after an
        // onServer validator that cannot be declared.
        formApi.setErrorMap({ onServer: serverErrorMap(error) as never });
      }
    },
  });

  if (mutation.isSuccess) {
    return <p>Subscribed! Your id: {mutation.data.subscriptionId}</p>;
  }

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

        <form.FormError />
      </form.Form>
    </form.AppForm>
  );
}
