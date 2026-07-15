// The cross-language proof: one token signed by the Go issuer, accepted
// as-is by the Rust (gRPC-web, the browser's protocol) and TS (Connect)
// servers — plus rotation, reuse detection, revocation and RBAC on all three.
import { Code, ConnectError, type Transport, createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-node";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./global-setup.js";
import { AuthService, type TokenPair } from "./src/pb/auth/v1/auth_pb.js";
import { BookmarkService } from "./src/pb/bookmark/v1/bookmark_pb.js";
import { ProtectedService } from "./src/pb/demo/v1/protected_pb.js";
import { NoteService } from "./src/pb/note/v1/note_pb.js";

const goUrl = inject("goUrl");
const connectOpts = { httpVersion: "1.1" } as const;

const auth = createClient(AuthService, createConnectTransport({ baseUrl: goUrl, ...connectOpts }));

// Rust goes through gRPC-web — the exact protocol the browser uses.
const servers: [string, Transport][] = [
  ["go-connect", createConnectTransport({ baseUrl: goUrl, ...connectOpts })],
  ["rust-tonic", createGrpcWebTransport({ baseUrl: inject("rustUrl"), ...connectOpts })],
  ["ts-connect", createConnectTransport({ baseUrl: inject("tsUrl"), ...connectOpts })],
];
const protectedClients = servers.map(
  ([servedBy, transport]) => [servedBy, createClient(ProtectedService, transport)] as const,
);

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

function tampered(token: string): string {
  const i = Math.floor(token.length / 2);
  return token.slice(0, i) + (token[i] === "a" ? "b" : "a") + token.slice(i + 1);
}

let tokens: TokenPair;

beforeAll(async () => {
  await auth.signUp({ email: "alice@example.com", password: "correct horse battery" });
  const res = await auth.logIn({ email: "alice@example.com", password: "correct horse battery" });
  if (!res.tokens) throw new Error("no tokens");
  tokens = res.tokens;
});

describe("cross-language token compatibility", () => {
  it("the same Go-signed token passes WhoAmI on all three servers", async () => {
    for (const [servedBy, client] of protectedClients) {
      const res = await client.whoAmI({}, bearer(tokens.accessToken));
      expect(res.servedBy).toBe(servedBy);
      expect(res.role).toBe("user");
      expect(res.subject).not.toBe("");
      expect(res.expiresAt).toBe(tokens.accessExpiresAt);
    }
  });

  it("a tampered token is rejected by all three servers", async () => {
    for (const [servedBy, client] of protectedClients) {
      expect(
        await codeOf(client.whoAmI({}, bearer(tampered(tokens.accessToken)))),
        servedBy,
      ).toBe(Code.Unauthenticated);
    }
  });

  it("AdminOnly denies role=user on all three servers", async () => {
    for (const [servedBy, client] of protectedClients) {
      expect(await codeOf(client.adminOnly({}, bearer(tokens.accessToken))), servedBy).toBe(
        Code.PermissionDenied,
      );
    }
  });

  it("AdminOnly accepts the seeded admin on all three servers", async () => {
    const res = await auth.logIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminToken = res.tokens?.accessToken ?? "";
    for (const [servedBy, client] of protectedClients) {
      const answer = await client.adminOnly({}, bearer(adminToken));
      expect(answer.secret, servedBy).not.toBe("");
    }
  });
});

describe("notes: the new-entity walkthrough over the wire", () => {
  const notes = createClient(NoteService, createConnectTransport({ baseUrl: goUrl, ...connectOpts }));

  it("scopes notes to the token's subject and enforces owner-or-admin delete", async () => {
    const bob = await (async () => {
      await auth.signUp({ email: "bob@example.com", password: "correct horse battery" });
      const res = await auth.logIn({ email: "bob@example.com", password: "correct horse battery" });
      return res.tokens?.accessToken ?? "";
    })();

    const created = await notes.createNote({ text: "bob's note" }, bearer(bob));
    const noteId = created.note?.id ?? "";
    expect(noteId).not.toBe("");

    // Scoped listing: bob sees his note, alice sees none of bob's.
    const bobList = await notes.listNotes({}, bearer(bob));
    expect(bobList.notes.map((n) => n.text)).toContain("bob's note");
    const aliceList = await notes.listNotes({}, bearer(tokens.accessToken));
    expect(aliceList.notes.map((n) => n.text)).not.toContain("bob's note");

    // Validation comes from the proto (buf.validate).
    expect(await codeOf(notes.createNote({ text: "" }, bearer(bob)))).toBe(Code.InvalidArgument);

    // alice (role user) cannot delete bob's note; the seeded admin can.
    expect(await codeOf(notes.deleteNote({ id: noteId }, bearer(tokens.accessToken)))).toBe(
      Code.PermissionDenied,
    );
    const admin = await auth.logIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await notes.deleteNote({ id: noteId }, bearer(admin.tokens?.accessToken ?? ""));
    const afterDelete = await notes.listNotes({}, bearer(bob));
    expect(afterDelete.notes.map((n) => n.id)).not.toContain(noteId);
  });
});

describe("bookmarks: the Rust-owned entity over gRPC-web", () => {
  // Same protocol the browser uses to reach tonic; the token is Go-signed,
  // the storage is the Rust server's own SQLite.
  const bookmarks = createClient(
    BookmarkService,
    createGrpcWebTransport({ baseUrl: inject("rustUrl"), ...connectOpts }),
  );

  it("creates, scopes, validates and deletes on the Rust server", async () => {
    const created = await bookmarks.createBookmark(
      { url: "https://buf.build", title: "buf" },
      bearer(tokens.accessToken),
    );
    const id = created.bookmark?.id ?? "";
    expect(id).not.toBe("");

    const mine = await bookmarks.listBookmarks({}, bearer(tokens.accessToken));
    expect(mine.bookmarks.map((b) => b.url)).toContain("https://buf.build");

    // Scoped to the token's subject: the admin (different sub) sees none.
    const admin = await auth.logIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminToken = admin.tokens?.accessToken ?? "";
    const adminList = await bookmarks.listBookmarks({}, bearer(adminToken));
    expect(adminList.bookmarks.map((b) => b.id)).not.toContain(id);

    // Contract validation rules, hand-enforced in Rust.
    expect(
      await codeOf(bookmarks.createBookmark({ url: "", title: "" }, bearer(tokens.accessToken))),
    ).toBe(Code.InvalidArgument);

    // Owner-or-admin delete: the admin may delete alice's bookmark.
    await bookmarks.deleteBookmark({ id }, bearer(adminToken));
    const after = await bookmarks.listBookmarks({}, bearer(tokens.accessToken));
    expect(after.bookmarks.map((b) => b.id)).not.toContain(id);
  });
});

describe("refresh rotation and revocation", () => {
  it("rotates on refresh, detects reuse, kills the family", async () => {
    const refreshed = await auth.refresh({ refreshToken: tokens.refreshToken });
    const next = refreshed.tokens;
    if (!next) throw new Error("no tokens");
    expect(next.refreshToken).not.toBe(tokens.refreshToken);

    // The refreshed access token works everywhere too.
    for (const [servedBy, client] of protectedClients) {
      const res = await client.whoAmI({}, bearer(next.accessToken));
      expect(res.servedBy).toBe(servedBy);
    }

    // Replaying the rotated token is reuse → refused, family dead.
    expect(await codeOf(auth.refresh({ refreshToken: tokens.refreshToken }))).toBe(
      Code.Unauthenticated,
    );
    expect(await codeOf(auth.refresh({ refreshToken: next.refreshToken }))).toBe(
      Code.Unauthenticated,
    );
  });

  it("logout revokes the refresh token", async () => {
    const res = await auth.logIn({ email: "alice@example.com", password: "correct horse battery" });
    const pair = res.tokens;
    if (!pair) throw new Error("no tokens");
    await auth.logOut({ refreshToken: pair.refreshToken });
    expect(await codeOf(auth.refresh({ refreshToken: pair.refreshToken }))).toBe(
      Code.Unauthenticated,
    );
  });
});
