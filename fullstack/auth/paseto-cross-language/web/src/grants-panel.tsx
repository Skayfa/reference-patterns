import type { Transport } from "@connectrpc/connect";
import { useQuery } from "@connectrpc/connect-query";
import { ProtectedService } from "./pb/demo/v1/protected_pb.js";
import { authorized, grantsForRole } from "./permissions.js";

// Permissions the demo exercises, shown against the logged-in role so the
// contract's RBAC is visible in the UI — computed with the same matching the
// three servers use.
const DEMO_PERMISSIONS = [
  "notes.read",
  "notes.write",
  "notes.delete",
  "admin.notes.delete_any",
  "bookmarks.write",
  "admin.diagnostics",
];

export function GrantsPanel({ transport }: { transport: Transport }) {
  // The role comes from WhoAmI (the PASETO token is opaque to the browser).
  const who = useQuery(ProtectedService.method.whoAmI, undefined, { transport });
  const role = who.data?.role ?? "";
  if (!role) return null;
  return (
    <section>
      <h2>My grants ({role})</h2>
      <p>patterns: {grantsForRole(role).join(", ")}</p>
      <ul>
        {DEMO_PERMISSIONS.map((permission) => (
          <li key={permission}>
            {permission}: {authorized(role, permission) ? "allowed" : "denied"}
          </li>
        ))}
      </ul>
    </section>
  );
}
