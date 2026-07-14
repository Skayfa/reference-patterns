// Real-app wiring: a Connect transport pointed at the Go server
// (server/main.go). Not exercised by the tests — they swap this transport
// for an in-memory one.
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { NewsletterService } from "./pb/example/v1/newsletter_pb.js";
import { SubscribeForm } from "./subscribe-form.js";

const transport = createConnectTransport({
  baseUrl: "http://localhost:8080",
  // Send NO_SIDE_EFFECTS RPCs (GetSubscription) as HTTP GET so browsers
  // and CDNs can cache them; RPCs with side effects still go as POST.
  useHttpGet: true,
});
const client = createClient(NewsletterService, transport);
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <SubscribeForm client={client} />
  </QueryClientProvider>,
);
