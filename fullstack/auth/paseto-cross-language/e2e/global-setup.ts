// Builds and boots the three real servers (Go issuer, Rust tonic verifier,
// TS connect verifier) on free ports, then tears them down. The first run
// pays the cold cargo build (~minutes); warm runs take seconds.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

const run = promisify(execFile);

const patternRoot = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const issuerDir = path.resolve(patternRoot, "issuer-go");
const rustDir = path.resolve(patternRoot, "verifier-rust");
const tsDir = path.resolve(patternRoot, "verifier-ts");

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "correct horse battery";

declare module "vitest" {
  export interface ProvidedContext {
    goUrl: string;
    rustUrl: string;
    tsUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

async function waitForTcp(port: number, child: ChildProcess, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited with code ${child.exitCode} before listening`);
    }
    const up = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${label} did not listen on :${port} within 30s`);
}

// detached → own process group, so teardown can kill the whole tree
// (pnpm/tsx wrap the real server in child processes).
function boot(label: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  child.on("error", (err) => console.error(`${label}: ${err.message}`));
  return child;
}

export default async function setup(project: TestProject): Promise<() => void> {
  const scratch = mkdtempSync(path.join(tmpdir(), "paseto-e2e-"));

  console.log("building go issuer and rust verifier (first run compiles tonic: minutes)...");
  await Promise.all([
    run("go", ["build", "-o", path.join(scratch, "issuer"), "."], { cwd: issuerDir }),
    run("cargo", ["build"], { cwd: rustDir, env: process.env }),
  ]);

  const [goPort, rustPort, tsPort] = await Promise.all([freePort(), freePort(), freePort()]);

  const children = [
    boot("issuer-go", path.join(scratch, "issuer"), [], issuerDir, {
      ADDR: `127.0.0.1:${goPort}`,
      DB_PATH: path.join(scratch, "auth.db"),
      SEED_ADMIN_EMAIL: ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    }),
    boot("verifier-rust", path.join(rustDir, "target", "debug", "verifier-rust"), [], rustDir, {
      ADDR: `127.0.0.1:${rustPort}`,
      DB_PATH: path.join(scratch, "bookmarks.db"),
    }),
    boot("verifier-ts", "pnpm", ["exec", "tsx", "src/server.ts"], tsDir, {
      PORT: String(tsPort),
    }),
  ];

  try {
    await Promise.all([
      waitForTcp(goPort, children[0], "issuer-go"),
      waitForTcp(rustPort, children[1], "verifier-rust"),
      waitForTcp(tsPort, children[2], "verifier-ts"),
    ]);
  } catch (err) {
    for (const child of children) {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    }
    throw err;
  }

  project.provide("goUrl", `http://127.0.0.1:${goPort}`);
  project.provide("rustUrl", `http://127.0.0.1:${rustPort}`);
  project.provide("tsUrl", `http://127.0.0.1:${tsPort}`);

  return () => {
    for (const child of children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  };
}
