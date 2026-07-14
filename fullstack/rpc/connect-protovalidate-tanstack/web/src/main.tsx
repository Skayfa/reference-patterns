// Real-app wiring: a Connect transport pointed at the Go server
// (server/main.go), provided app-wide via TransportProvider. Tests swap it
// for an in-memory one.
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { SubscribeForm } from "./subscribe-form.js";

const transport = createConnectTransport({
  baseUrl: "http://localhost:8080",
  // Send NO_SIDE_EFFECTS RPCs (GetSubscription) as HTTP GET so browsers
  // and CDNs can cache them; RPCs with side effects still go as POST.
  useHttpGet: true,
});
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <TransportProvider transport={transport}>
    <QueryClientProvider client={queryClient}>
      <SubscribeForm />
    </QueryClientProvider>
  </TransportProvider>,
);
