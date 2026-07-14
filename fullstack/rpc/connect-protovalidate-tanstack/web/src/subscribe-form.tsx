import type { Client } from "@connectrpc/connect";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

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
  const form = useForm({
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
      <form.Field name="email">
        {(field) => (
          <label>
            Email
            <input
              type="text"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {field.state.meta.isTouched && !field.state.meta.isValid ? (
              <em>{field.state.meta.errors[0]?.message}</em>
            ) : null}
          </label>
        )}
      </form.Field>

      <form.Field name="name">
        {(field) => (
          <label>
            Name
            <input
              type="text"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {field.state.meta.isTouched && !field.state.meta.isValid ? (
              <em>{field.state.meta.errors[0]?.message}</em>
            ) : null}
          </label>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "Subscribing…" : "Subscribe"}
          </button>
        )}
      </form.Subscribe>

      {mutation.isError ? (
        // Server-side rejections (protovalidate) land here with the
        // violated field in the message.
        <p role="alert">{mutation.error.message}</p>
      ) : null}
    </form>
  );
}
