import type { DescMessage, DescMethodUnary, MessageInitShape } from "@bufbuild/protobuf";
import { useMutation } from "@connectrpc/connect-query";

import { serverErrorMap } from "../connect-errors.js";

/**
 * Binds a Connect mutation to TanStack Form's submit validator, once for
 * the whole app: the mutation runs at submit time, and any RPC failure
 * comes back as the documented { form, fields } error shape — Violations
 * under their fields, every other code as one form-level user message.
 * Forms plug it in as `validators: { onSubmitAsync }` and contain zero
 * error handling.
 */
export function useFormMutation<I extends DescMessage, O extends DescMessage>(
  method: DescMethodUnary<I, O>,
) {
  const mutation = useMutation(method);

  const onSubmitAsync = async ({
    value,
  }: {
    value: MessageInitShape<I>;
  }): Promise<null | { form?: string; fields: Record<string, string> }> => {
    try {
      await mutation.mutateAsync(value);
      return null;
    } catch (error) {
      return serverErrorMap(error);
    }
  };

  return { mutation, onSubmitAsync };
}
