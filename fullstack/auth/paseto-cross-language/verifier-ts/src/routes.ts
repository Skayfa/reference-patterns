// demo.v1.ProtectedService in TypeScript: the same service Go and Rust
// implement, verifying the same tokens with the same public key.
import { getOption } from "@bufbuild/protobuf";
import type { ConnectRouter, Interceptor } from "@connectrpc/connect";
import { Code, ConnectError, createContextKey } from "@connectrpc/connect";
import { type Claims, verifyAccessToken } from "./paseto.js";
import { Role, access } from "./pb/auth/v1/access_pb.js";
import { ProtectedService } from "./pb/demo/v1/protected_pb.js";

export const SERVED_BY = "ts-connect";

const kClaims = createContextKey<Claims | undefined>(undefined);

// RoleLevel maps a token's role claim ("admin") onto the auth.v1.Role
// hierarchy (ROLE_ADMIN). Unknown claims map to ROLE_UNSPECIFIED and pass
// nothing.
function roleLevel(claim: string): Role {
  // protobuf-es strips the enum-name prefix: Role.ADMIN, not ROLE_ADMIN.
  const level = Role[claim.toUpperCase() as keyof typeof Role];
  return typeof level === "number" ? level : Role.UNSPECIFIED;
}

// Guards the authenticated services: always requires a valid Bearer PASETO,
// enforces the minimum role the proto declares ((auth.v1.access) option,
// default-deny when no rule is declared), and stashes the claims in the
// handler context. Verification is local: only the public key.
//
// Truly public RPCs (public: true) are mounted WITHOUT this interceptor; it
// is never placed in front of one, so a public rule reaching it is a mount
// mistake and is refused rather than silently waved through.
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
    if (rule.minimumRole === Role.UNSPECIFIED) {
      throw new ConnectError("no access rule declared for this rpc", Code.PermissionDenied);
    }
    if (roleLevel(claims.role) < rule.minimumRole) {
      const name = Role[rule.minimumRole].toLowerCase();
      throw new ConnectError(`${name} role required`, Code.PermissionDenied);
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
