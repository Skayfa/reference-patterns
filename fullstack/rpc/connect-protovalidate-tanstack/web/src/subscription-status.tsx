import type { Client } from "@connectrpc/connect";
import { useQuery } from "@tanstack/react-query";

import type { NewsletterService } from "./pb/example/v1/newsletter_pb.js";

interface SubscriptionStatusProps {
  client: Client<typeof NewsletterService>;
  subscriptionId: string;
}

/**
 * The read side: TanStack Query owns caching/retries, and because
 * GetSubscription is NO_SIDE_EFFECTS, a transport created with
 * `useHttpGet: true` sends it as a plain HTTP GET — cacheable by the
 * browser and any CDN in front of the API.
 */
export function SubscriptionStatus({
  client,
  subscriptionId,
}: SubscriptionStatusProps) {
  const query = useQuery({
    queryKey: ["subscription", subscriptionId],
    queryFn: () => client.getSubscription({ subscriptionId }),
  });

  if (query.isPending) return <p>Loading subscription…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;

  return (
    <p>
      {query.data.name} &lt;{query.data.email}&gt; — {query.data.subscriptionId}
    </p>
  );
}
