import { readFileSync } from "node:fs";
import { sign } from "paseto-ts/v4";
import { describe, expect, it } from "vitest";
import { devPublicKeyHex, hexToPaserkPublic, verifyAccessToken } from "../src/paseto.js";

const publicKey = hexToPaserkPublic(devPublicKeyHex());
// Signed by the Go issuer (issuer-go/cmd/genfixture): the cross-language proof.
const goSignedAdmin = readFileSync(
  new URL("../../keys/go-signed-admin.paseto", import.meta.url),
  "utf8",
).trim();

function devSecretPaserk(): string {
  const hex = readFileSync(new URL("../../keys/dev.secret.hex", import.meta.url), "utf8").trim();
  return `k4.secret.${Buffer.from(hex, "hex").toString("base64url")}`;
}

describe("verifyAccessToken", () => {
  it("verifies the Go-signed fixture", async () => {
    const claims = await verifyAccessToken(publicKey, goSignedAdmin);
    expect(claims).toEqual({
      subject: "fixture-admin",
      role: "admin",
      issuedAt: "2026-07-15T12:00:00Z",
      expiresAt: "2036-07-12T12:00:00Z",
    });
  });

  it("verifies a locally signed token", async () => {
    const token = sign(devSecretPaserk(), { sub: "user-1", role: "user", exp: "10 minutes" });
    const claims = await verifyAccessToken(publicKey, token);
    expect(claims.subject).toBe("user-1");
    expect(claims.role).toBe("user");
  });

  it("rejects an expired token", async () => {
    const token = sign(
      devSecretPaserk(),
      { sub: "user-1", role: "user", exp: "2020-01-01T00:00:00Z" },
      // addExp would silently replace the past exp with now+1h.
      { addExp: false, validatePayload: false },
    );
    await expect(verifyAccessToken(publicKey, token)).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const i = Math.floor(goSignedAdmin.length / 2);
    const flipped = goSignedAdmin[i] === "a" ? "b" : "a";
    const tampered = goSignedAdmin.slice(0, i) + flipped + goSignedAdmin.slice(i + 1);
    await expect(verifyAccessToken(publicKey, tampered)).rejects.toThrow();
  });

  it("rejects a token missing the role claim", async () => {
    const token = sign(devSecretPaserk(), { sub: "user-1", exp: "10 minutes" });
    await expect(verifyAccessToken(publicKey, token)).rejects.toThrow(/missing a required claim/);
  });
});
