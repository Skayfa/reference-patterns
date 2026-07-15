// demo.v1.ProtectedService in TypeScript: the same service Go and Rust
// implement, verifying the same tokens with the same public key.
// demo.v1.ProtectedService in TypeScript: the same service Go and Rust
// implement, verifying the same tokens with the same public key.
import { getOption } from "@bufbuild/protobuf";
import type { ConnectRouter, Interceptor } from "@connectrpc/connect";
import { Code, ConnectError, createContextKey } from "@connectrpc/connect";
import { type Claims, verifyAccessToken } from "./paseto.js";
import { RoleSchema, access, grants } from "./pb/auth/v1/access_pb.js";
import { ProtectedService } from "./pb/demo/v1/protected_pb.js";

export const SERVED_BY = "ts-connect";

const kClaims = createContextKey<Claims | undefined>(undefined);

// role claim ("admin") -> its granted glob patterns, read once from the
// auth.v1.Role enum-value (auth.v1.grants) options — the same contract Go and
// Rust read.
const roleGrants: Map<string, string[]> = new Map(
  RoleSchema.values.map((value) => [
    value.name.replace(/^ROLE_/, "").toLowerCase(),
    getOption(value, grants),
  ]),
);

// A grant pattern covers a permission if it is "*", equals the permission, or
// is "prefix.*" and the permission starts with "prefix." — "notes.*" covers
// "notes.write" and any future "notes.<x>", "admin.notes.delete_any" stays out.
function matchGrant(pattern: string, permission: string): boolean {
  if (pattern === "*" || pattern === permission) return true;
  if (pattern.endsWith(".*")) return permission.startsWith(pattern.slice(0, -1));
  return false;
}

// Does the role's grants cover this permission? Case-insensitive role, glob
// matching identical to Go/Rust. Unknown role -> no grants -> false.
export function authorized(role: string, permission: string): boolean {
  return (roleGrants.get(role.toLowerCase()) ?? []).some((p) => matchGrant(p, permission));
}

// Guards the authenticated services: always requires a valid Bearer PASETO,
// enforces the permission the proto declares ((auth.v1.access) option,
// default-deny when none is declared), and stashes the claims in the handler
// context. Verification is local: only the public key.
//
// Truly public RPCs (public: true) are mounted WITHOUT this interceptor; a
// public rule reaching it is a mount mistake and is refused.
export function authInterceptor(paserkPublicKey: string): Interceptor {
  return (next) => async (req) => {
    const header = req.header.get("Authorization") ?? "";
    const raw = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (raw === "") {
      throw new ConnectError("missing bearer token", Code.Unauthenticated);
    }
    let claims: Claims;
    try {
      claims = await verifyAccessToken(paserkPublicKey, raw);
    } catch {
      throw new ConnectError("invalid token", Code.Unauthenticated);
    }
    const rule = getOption(req.method, access);
    if (rule.public) {
      throw new ConnectError(
        "public rpc mounted behind the auth interceptor — mount it without one",
        Code.PermissionDenied,
      );
    }
    if (rule.permission === "") {
      throw new ConnectError("no access rule declared for this rpc", Code.PermissionDenied);
    }
    if (!authorized(claims.role, rule.permission)) {
      throw new ConnectError(`permission required: ${rule.permission}`, Code.PermissionDenied);
    }
    req.contextValues.set(kClaims, claims);
    return next(req);
  };
}

function claimsFrom(values: { get<T>(key: ReturnType<typeof createContextKey<T>>): T }): Claims {
  const claims = values.get(kClaims);
  if (!claims) {
    throw new ConnectError("handler mounted without auth interceptor", Code.Internal);
  }
  return claims;
}

export function routes(paserkPublicKey: string): (router: ConnectRouter) => void {
  return (router) => {
    router.service(
      ProtectedService,
      {
        whoAmI(_req, ctx) {
          const claims = claimsFrom(ctx.values);
          return {
            subject: claims.subject,
            role: claims.role,
            issuedAt: claims.issuedAt,
            expiresAt: claims.expiresAt,
            servedBy: SERVED_BY,
          };
        },
        adminOnly(_req, ctx) {
          // The role check happened in the interceptor, driven by the proto's
          // (auth.v1.access) option — nothing to re-check here.
          claimsFrom(ctx.values);
          return { secret: "the ts server trusts your admin token" };
        },
      },
      { interceptors: [authInterceptor(paserkPublicKey)] },
    );
  };
}
