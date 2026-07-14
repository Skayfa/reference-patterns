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
    validators: {
      onChange: subscribeValidator,
      // TanStack Form's documented server-error pattern: the submit-time
      // validator returns { form, fields } and the framework distributes
      // the field entries onto their fields (dotted paths included) —
      // which is exactly the shape serverErrorMap builds from the RPC's
      // Violations details. Errors refresh on the next submit; the submit
      // button stays clickable (aria-disabled), so retrying is always
      // possible.
      onSubmitAsync: async ({ value }) => {
        try {
          await mutation.mutateAsync(value);
          return null;
        } catch (error) {
          return serverErrorMap(error);
        }
      },
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
