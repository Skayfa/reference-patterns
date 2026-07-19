// One transport per server. Go and TS speak Connect natively; the Rust tonic
// server speaks gRPC — the browser reaches it through the gRPC-web protocol
// (tonic-web translates on the server side).
//
// The access token is injected here, by an interceptor shared by all three
// transports: components never build auth headers.
import type { Interceptor, Transport } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";

export interface Transports {
  go: Transport;
  rust: Transport;
  ts: Transport;
}

// Memory only, deliberately not localStorage: a page reload logs out.
let currentAccessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}

const withBearer: Interceptor = (next) => (req) => {
  if (currentAccessToken) {
    req.header.set("Authorization", `Bearer ${currentAccessToken}`);
  }
  return next(req);
};

export function defaultTransports(): Transports {
  return {
    go: createConnectTransport({
      baseUrl: import.meta.env.VITE_GO_URL ?? "http://localhost:8080",
      interceptors: [withBearer],
    }),
    rust: createGrpcWebTransport({
      baseUrl: import.meta.env.VITE_RUST_URL ?? "http://localhost:8082",
      interceptors: [withBearer],
    }),
    ts: createConnectTransport({
      baseUrl: import.meta.env.VITE_TS_URL ?? "http://localhost:8083",
      interceptors: [withBearer],
    }),
  };
}
