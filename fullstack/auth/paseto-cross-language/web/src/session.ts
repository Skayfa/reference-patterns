import type { TokenPair } from "./pb/auth/v1/auth_pb.js";

export interface Session {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
}

export function sessionFrom(tokens: TokenPair | undefined): Session {
  if (!tokens) {
    throw new Error("issuer returned no tokens");
  }
  return {
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshToken: tokens.refreshToken,
  };
}
