import type { Client } from "@connectrpc/connect";
import { useMutation } from "@tanstack/react-query";

import { useAppForm } from "./form/use-app-form.js";
import type { NewsletterService } from "./pb/example/v1/newsletter_pb.js";
import { subscribeSchema } from "./schema.js";

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

  // ...TanStack Form owns the input state and client-side validation.
  const form = useAppForm({
    defaultValues: { email: "", name: "" },
    validators: { onChange: subscribeSchema },
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
