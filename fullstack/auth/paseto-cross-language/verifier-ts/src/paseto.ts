// PASETO v4.public verification with only the Ed25519 public key.
//
// Interop contract with the Go issuer and Rust verifier: footer and implicit
// assertion are EMPTY, claims are RFC 3339 strings (sub, role, iat, exp, nbf).
import { readFileSync } from "node:fs";
import { verify } from "paseto-ts/v4";

export interface Claims {
  subject: string;
  role: string;
  issuedAt: string;
  expiresAt: string;
}

// paseto-ts refuses raw key material: keys must be PASERK-scoped
// ("k4.public.<base64url>"). The other languages exchange bare hex, so wrap it.
export function hexToPaserkPublic(hex: string): string {
  const bytes = Buffer.from(hex.trim(), "hex");
  if (bytes.length !== 32) {
    throw new Error(`expected 32-byte Ed25519 public key, got ${bytes.length}`);
  }
  return `k4.public.${bytes.toString("base64url")}`;
}

export function devPublicKeyHex(): string {
  return readFileSync(new URL("../../keys/dev.public.hex", import.meta.url), "utf8").trim();
}

export async function verifyAccessToken(paserkPublicKey: string, raw: string): Promise<Claims> {
  // verify() checks the signature and validates exp/iat/nbf when present.
  const { payload } = await verify<{ sub?: string; role?: string; iat?: string; exp?: string }>(
    paserkPublicKey,
    raw,
  );
  const { sub, role, iat, exp } = payload;
  if (!sub || !role || !iat || !exp) {
    throw new Error("token is missing a required claim (sub, role, iat, exp)");
  }
  return { subject: sub, role, issuedAt: iat, expiresAt: exp };
}
