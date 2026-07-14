import type { ServiceImpl } from "@connectrpc/connect";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { NewsletterService } from "../src/pb/example/v1/newsletter_pb.js";

/**
 * Renders UI against a real Connect service running in memory
 * (createRouterTransport): actual (de)serialization and error semantics,
 * no network, no fetch mocking. Provide only the methods the test needs.
 */
export function renderWithNewsletter(
  ui: ReactNode,
  impl: Partial<ServiceImpl<typeof NewsletterService>>,
) {
  const transport = createRouterTransport(({ service }) => {
    service(NewsletterService, impl);
  });
  render(
    <TransportProvider transport={transport}>
      <QueryClientProvider
        // retry: false so error cases fail immediately instead of going
        // through TanStack Query's default 3 retries.
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {ui}
      </QueryClientProvider>
    </TransportProvider>,
  );
}
