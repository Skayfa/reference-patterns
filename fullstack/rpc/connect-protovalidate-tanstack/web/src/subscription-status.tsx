import { useSuspenseQuery } from "@connectrpc/connect-query";

import { NewsletterService } from "./pb/example/v1/newsletter_pb.js";

/**
 * The read side, happy path only: useSuspenseQuery guarantees data —
 * loading surfaces at the nearest <Suspense> and failures at the nearest
 * error boundary (see RpcBoundary), so no isPending/isError plumbing here
 * or in any other read component. GetSubscription is NO_SIDE_EFFECTS, so
 * a transport with `useHttpGet: true` sends it as a cacheable HTTP GET.
 */
export function SubscriptionStatus({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const { data } = useSuspenseQuery(NewsletterService.method.getSubscription, {
    subscriptionId,
  });

  return (
    <p>
      {data.name} &lt;{data.email}&gt; — {data.subscriptionId}
    </p>
  );
}
