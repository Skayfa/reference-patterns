import { Code, ConnectError } from "@connectrpc/connect";

import { ViolationsSchema } from "./pb/buf/validate/validate_pb.js";

/**
 * Extracts protovalidate Violations from a ConnectError's details and maps
 * them by field path ("email", "address.city", ...) — ready to hand to
 * TanStack Form's setErrorMap({ onServer: { fields } }).
 */
export function fieldViolations(error: unknown): Record<string, string> {
  const violations: Record<string, string> = {};
  for (const detail of ConnectError.from(error).findDetails(ViolationsSchema)) {
    for (const violation of detail.violations) {
      const path = violation.field?.elements
        .map((element) => element.fieldName)
        .join(".");
      if (path) violations[path] ??= violation.message;
    }
  }
  return violations;
}

/**
 * The RPC code is the error API; raw ConnectError messages never reach the
 * DOM (an unknown-code error may carry internal server details).
 */
export function userMessage(error: unknown): string {
  switch (ConnectError.from(error).code) {
    case Code.NotFound:
      return "Not found.";
    case Code.InvalidArgument:
      return "Some fields are invalid.";
    case Code.PermissionDenied:
    case Code.Unauthenticated:
      return "You are not allowed to do this.";
    case Code.Unavailable:
    case Code.DeadlineExceeded:
    case Code.ResourceExhausted:
      return "Service temporarily unavailable — please retry.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Splits an RPC failure for TanStack Form's errorMap: field violations go
 * under their fields; anything else becomes one code-mapped form message.
 */
export function serverErrorMap(error: unknown): {
  form?: string;
  fields: Record<string, string>;
} {
  const fields = fieldViolations(error);
  return {
    form: Object.keys(fields).length > 0 ? undefined : userMessage(error),
    fields,
  };
}

// Unknown is included: network failures surface as Code.Unknown in
// connect-es, and retrying an idempotent read is safe. Aborts (Canceled)
// and every 4xx-like code are deliberately not transient.
const TRANSIENT_CODES: ReadonlySet<Code> = new Set([
  Code.Unavailable,
  Code.DeadlineExceeded,
  Code.ResourceExhausted,
  Code.Unknown,
]);

/** Worth retrying automatically — for queries only, never mutations. */
export function isTransientError(error: unknown): boolean {
  return TRANSIENT_CODES.has(ConnectError.from(error).code);
}
