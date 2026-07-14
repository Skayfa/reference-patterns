import { create } from "@bufbuild/protobuf";
import { createStandardSchema } from "@bufbuild/protovalidate";

import { useAppForm } from "./form/use-app-form.js";
import { useFormMutation } from "./form/use-form-mutation.js";
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
  // The mutation runs as the submit validator: RPC failures come back as
  // TanStack Form's { form, fields } shape (Violations under their
  // fields), pre-wired once for every form by useFormMutation.
  const { mutation, onSubmitAsync } = useFormMutation(
    NewsletterService.method.subscribe,
  );

  // TanStack Form owns the input state; its values ARE the proto message
  // (created empty here), so the validator and the RPC share one shape.
  const form = useAppForm({
    defaultValues: create(SubscribeRequestSchema),
    validators: { onChange: subscribeValidator, onSubmitAsync },
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
