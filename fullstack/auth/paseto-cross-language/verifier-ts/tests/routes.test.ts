import { readFileSync } from "node:fs";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { sign } from "paseto-ts/v4";
import { describe, expect, it } from "vitest";
import { devPublicKeyHex, hexToPaserkPublic } from "../src/paseto.js";
import { SERVED_BY, routes } from "../src/routes.js";
import { ProtectedService } from "../src/pb/demo/v1/protected_pb.js";

// In-memory transport through the real router — interceptor included, no port.
const transport = createRouterTransport(routes(hexToPaserkPublic(devPublicKeyHex())));
const client = createClient(ProtectedService, transport);

// Signed by the Go issuer (issuer-go/cmd/genfixture): the cross-language proof.
const goSignedAdmin = readFileSync(
  new URL("../../keys/go-signed-admin.paseto", import.meta.url),
  "utf8",
).trim();

function localToken(role: string): string {
  const hex = readFileSync(new URL("../../keys/dev.secret.hex", import.meta.url), "utf8").trim();
  const secret = `k4.secret.${Buffer.from(hex, "hex").toString("base64url")}`;
  return sign(secret, { sub: "user-1", role, exp: "10 minutes" });
}

function bearer(token: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function codeOf(promise: Promise<unknown>): Promise<Code | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

describe("ProtectedService (ts)", () => {
  it("answers WhoAmI for the Go-signed token", async () => {
    const res = await client.whoAmI({}, bearer(goSignedAdmin));
    expect(res.subject).toBe("fixture-admin");
    expect(res.role).toBe("admin");
    expect(res.issuedAt).toBe("2026-07-15T12:00:00Z");
    expect(res.servedBy).toBe(SERVED_BY);
  });

  it("rejects a missing token", async () => {
    expect(await codeOf(client.whoAmI({}))).toBe(Code.Unauthenticated);
  });

  it("rejects a tampered token", async () => {
    const i = Math.floor(goSignedAdmin.length / 2);
    const flipped = goSignedAdmin[i] === "a" ? "b" : "a";
    const tampered = goSignedAdmin.slice(0, i) + flipped + goSignedAdmin.slice(i + 1);
    expect(await codeOf(client.whoAmI({}, bearer(tampered)))).toBe(Code.Unauthenticated);
  });

  it("rejects an expired token", async () => {
    const hex = readFileSync(new URL("../../keys/dev.secret.hex", import.meta.url), "utf8").trim();
    const secret = `k4.secret.${Buffer.from(hex, "hex").toString("base64url")}`;
    const expired = sign(
      secret,
      { sub: "user-1", role: "user", exp: "2020-01-01T00:00:00Z" },
      { addExp: false, validatePayload: false },
    );
    expect(await codeOf(client.whoAmI({}, bearer(expired)))).toBe(Code.Unauthenticated);
  });

  it("enforces the admin role", async () => {
    expect(await codeOf(client.adminOnly({}, bearer(localToken("user"))))).toBe(
      Code.PermissionDenied,
    );
    const res = await client.adminOnly({}, bearer(goSignedAdmin));
    expect(res.secret).not.toBe("");
  });
});
