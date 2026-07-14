import type { ServiceImpl } from "@connectrpc/connect";
import { createRouterTransport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { NewsletterService } from "../src/pb/example/v1/newsletter_pb.js";
import { createQueryClient } from "../src/query-client.js";

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
      {/* The production QueryClient, real retry policy included: error
          tests stay fast because non-transient codes are never retried. */}
      <QueryClientProvider client={createQueryClient()}>
        {ui}
      </QueryClientProvider>
    </TransportProvider>,
  );
}
