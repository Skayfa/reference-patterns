import type { Transport } from "@connectrpc/connect";
import { ConnectError } from "@connectrpc/connect";
import { useQuery } from "@connectrpc/connect-query";
import { ProtectedService } from "./pb/demo/v1/protected_pb.js";
import type { Transports } from "./transports.js";

// The demo's centerpiece: the SAME access token (injected by the transport
// interceptor), verified independently by three servers in three languages.
// connect-query keys queries per transport, so the three columns never
// collide in the cache; the hooks are the entire data layer — no client
// wiring, no manual fetch.

function serverList(transports: Transports): [string, Transport][] {
  return [
    ["go", transports.go],
    ["rust", transports.rust],
    ["ts", transports.ts],
  ];
}

function answerText(isPending: boolean, error: unknown, ok: () => string): string {
  if (isPending) return "…";
  if (error) return `error: ${ConnectError.from(error).rawMessage}`;
  return ok();
}

function WhoAmIAnswer({ label, transport }: { label: string; transport: Transport }) {
  const q = useQuery(ProtectedService.method.whoAmI, undefined, { transport });
  return (
    <li>
      <strong>{label}</strong>:{" "}
      {answerText(q.isPending, q.error, () => `${q.data?.subject} (${q.data?.role}) via ${q.data?.servedBy}`)}
    </li>
  );
}

function AdminAnswer({ label, transport }: { label: string; transport: Transport }) {
  const q = useQuery(ProtectedService.method.adminOnly, undefined, { transport });
  return (
    <li>
      <strong>{label}</strong>: {answerText(q.isPending, q.error, () => q.data?.secret ?? "")}
    </li>
  );
}

export function WhoAmIPanel({ transports }: { transports: Transports }) {
  return (
    <section>
      <h2>Who am I?</h2>
      <ul>
        {serverList(transports).map(([label, transport]) => (
          <WhoAmIAnswer key={label} label={label} transport={transport} />
        ))}
      </ul>
    </section>
  );
}

export function AdminPanel({ transports }: { transports: Transports }) {
  return (
    <section>
      <h2>Admin only</h2>
      <ul>
        {serverList(transports).map(([label, transport]) => (
          <AdminAnswer key={label} label={label} transport={transport} />
        ))}
      </ul>
    </section>
  );
}
