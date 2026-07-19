// Composition root: connect-es over node:http, plus the dev CORS posture so
// the browser front can call it directly.
import http from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { devPublicKeyHex, hexToPaserkPublic } from "./paseto.js";
import { routes } from "./routes.js";

const port = Number(process.env.PORT ?? 8083);
const publicKeyHex = process.env.PASETO_PUBLIC_KEY_HEX ?? devPublicKeyHex();

const handler = connectNodeAdapter({ routes: routes(hexToPaserkPublic(publicKeyHex)) });

function withCors(next: http.RequestListener): http.RequestListener {
  return (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    next(req, res);
  };
}

http.createServer(withCors(handler)).listen(port, "127.0.0.1", () => {
  console.log(`ts verifier listening on http://127.0.0.1:${port}`);
});
