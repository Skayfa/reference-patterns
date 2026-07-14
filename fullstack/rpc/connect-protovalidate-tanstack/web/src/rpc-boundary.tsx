import { QueryErrorResetBoundary } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { userMessage } from "./connect-errors.js";

/**
 * Declarative loading and error handling, written once: components below
 * use useSuspenseQuery and render only the happy path — pending states
 * surface here as the Suspense fallback, failures as a code-mapped
 * message with a Retry button. QueryErrorResetBoundary is what makes
 * Retry actually refetch the failed queries after the boundary resets.
 *
 * Reads only: mutation errors stay local to their form on purpose — a
 * boundary would unmount the subtree and lose the user's input.
 */
export function RpcBoundary({
  fallback,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }) => (
            <div role="alert">
              <p>{userMessage(error)}</p>
              <button type="button" onClick={resetErrorBoundary}>
                Retry
              </button>
            </div>
          )}
        >
          <Suspense fallback={fallback ?? <p>Loading…</p>}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
