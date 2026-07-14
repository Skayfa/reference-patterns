import { useQuery } from "@connectrpc/connect-query";

import { NewsletterService } from "./pb/example/v1/newsletter_pb.js";

/**
 * The read side: connect-query derives the cache key from the method
 * descriptor + input (no manual queryKey), and because GetSubscription is
 * NO_SIDE_EFFECTS, a transport created with `useHttpGet: true` sends it as
 * a plain HTTP GET — cacheable by the browser and any CDN in front.
 */
export function SubscriptionStatus({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const query = useQuery(NewsletterService.method.getSubscription, {
    subscriptionId,
  });

  if (query.isPending) return <p>Loading subscription…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;

  return (
    <p>
      {query.data.name} &lt;{query.data.email}&gt; — {query.data.subscriptionId}
    </p>
  );
}
