import { QueryClient } from "@tanstack/react-query";

import { isTransientError } from "./connect-errors.js";

/**
 * Retry policy driven by RPC codes instead of TanStack Query's default
 * (3x everything): only transient failures are retried, and only for
 * queries — mutations are not idempotent and never auto-retry.
 * Shared by the app and the tests, so tests exercise the real policy.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          failureCount < 2 && isTransientError(error),
      },
    },
  });
}
