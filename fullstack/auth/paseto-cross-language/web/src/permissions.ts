// The front resolves permissions from the SAME contract the servers do: the
// auth.v1.Role enum-value (auth.v1.grants) options, with the same glob match.
// This is UX only (hide/disable affordances) — the servers still enforce.
import { getOption } from "@bufbuild/protobuf";
import { RoleSchema, grants } from "./pb/auth/v1/access_pb.js";

const roleGrants: Map<string, string[]> = new Map(
  RoleSchema.values.map((value) => [
    value.name.replace(/^ROLE_/, "").toLowerCase(),
    getOption(value, grants),
  ]),
);

function matchGrant(pattern: string, permission: string): boolean {
  if (pattern === "*" || pattern === permission) return true;
  if (pattern.endsWith(".*")) return permission.startsWith(pattern.slice(0, -1));
  return false;
}

export function grantsForRole(role: string): string[] {
  return roleGrants.get(role.toLowerCase()) ?? [];
}

export function authorized(role: string, permission: string): boolean {
  return grantsForRole(role).some((p) => matchGrant(p, permission));
}
