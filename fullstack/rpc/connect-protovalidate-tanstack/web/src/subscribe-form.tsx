import { create } from "@bufbuild/protobuf";
import { createStandardSchema } from "@bufbuild/protovalidate";
import type { Client } from "@connectrpc/connect";
import { useMutation } from "@tanstack/react-query";

import { useAppForm } from "./form/use-app-form.js";
import type { NewsletterService } from "./pb/example/v1/newsletter_pb.js";
import { SubscribeRequestSchema } from "./pb/example/v1/newsletter_pb.js";

// Unified validation: the protovalidate rules annotated in newsletter.proto
// travel inside the generated schema, and createStandardSchema evaluates
// them in the browser — the exact rules (and messages) the Go interceptor
// enforces, with no hand-written mirror.
const subscribeValidator = createStandardSchema(SubscribeRequestSchema);

interface SubscribeFormProps {
  /** Injected so tests can pass a client backed by an in-memory transport. */
  client: Client<typeof NewsletterService>;
}

export function SubscribeForm({ client }: SubscribeFormProps) {
  // TanStack Query owns the network state (pending/error/success)...
  const mutation = useMutation({
    mutationFn: (input: { email: string; name: string }) =>
      client.subscribe(input),
  });

  // ...TanStack Form owns the input state; its values ARE the proto message
  // (created empty here), so the validator and the RPC share one shape.
  const form = useAppForm({
    defaultValues: create(SubscribeRequestSchema),
    validators: { onChange: subscribeValidator },
    onSubmit: async ({ value }) => {
      // Swallow the rejection: TanStack Query owns the error state and the
      // component renders it from mutation.isError. Awaiting still keeps
      // form.state.isSubmitting true for the duration of the call.
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  if (mutation.isSuccess) {
    return <p>Subscribed! Your id: {mutation.data.subscriptionId}</p>;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="email">
        {(field) => <field.TextField label="Email" />}
      </form.AppField>

      <form.AppField name="name">
        {(field) => <field.TextField label="Name" />}
      </form.AppField>

      <form.AppForm>
        <form.SubmitButton label="Subscribe" pendingLabel="Subscribing…" />
      </form.AppForm>

      {mutation.isError ? (
        // Server-side rejections (protovalidate) land here with the
        // violated field in the message.
        <p role="alert">{mutation.error.message}</p>
      ) : null}
    </form>
  );
}
