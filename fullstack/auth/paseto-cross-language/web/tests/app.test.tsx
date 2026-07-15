// The full UI against in-memory fakes of both services (createRouterTransport):
// no server, no network, but the real generated clients, the real
// connect-query hooks, and the real components.
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../src/main.js";
import { AuthService } from "../src/pb/auth/v1/auth_pb.js";
import { BookmarkService } from "../src/pb/bookmark/v1/bookmark_pb.js";
import { ProtectedService } from "../src/pb/demo/v1/protected_pb.js";
import { NoteService } from "../src/pb/note/v1/note_pb.js";
import type { Transports } from "../src/transports.js";

function fakeIssuerAndServers(): Transports {
  const users = new Map<string, string>();
  let refreshCount = 0;

  const protectedImpl = (servedBy: string, role: string) => ({
    whoAmI() {
      return {
        subject: "user-1",
        role,
        issuedAt: "2026-07-15T12:00:00Z",
        expiresAt: "2036-07-12T12:00:00Z",
        servedBy,
      };
    },
    adminOnly() {
      if (role !== "admin") {
        throw new ConnectError("admin role required", Code.PermissionDenied);
      }
      return { secret: `${servedBy} secret` };
    },
  });

  const issuer = createRouterTransport(({ service }) => {
    service(AuthService, {
      signUp(req) {
        if (users.has(req.email)) {
          throw new ConnectError("email already registered", Code.AlreadyExists);
        }
        users.set(req.email, req.password);
        return { userId: "user-1" };
      },
      logIn(req) {
        if (users.get(req.email) !== req.password) {
          throw new ConnectError("invalid credentials", Code.Unauthenticated);
        }
        return {
          tokens: {
            accessToken: "v4.public.fake",
            accessExpiresAt: "2036-07-12T12:00:00Z",
            refreshToken: "refresh-0",
          },
        };
      },
      refresh() {
        refreshCount += 1;
        return {
          tokens: {
            accessToken: "v4.public.fake",
            accessExpiresAt: "2036-07-12T12:00:00Z",
            refreshToken: `refresh-${refreshCount}`,
          },
        };
      },
      logOut() {
        return {};
      },
    });
    // The go server answers ProtectedService and NoteService too, like the
    // real issuer.
    service(ProtectedService, protectedImpl("go-connect", "user"));
    const notes: { id: string; text: string; createdAt: string }[] = [];
    let nextId = 0;
    service(NoteService, {
      createNote(req) {
        const note = { id: `note-${nextId++}`, text: req.text, createdAt: "2026-07-15T12:00:00Z" };
        notes.push(note);
        return { note };
      },
      listNotes() {
        return { notes };
      },
      deleteNote(req) {
        const i = notes.findIndex((n) => n.id === req.id);
        if (i >= 0) notes.splice(i, 1);
        return {};
      },
    });
  });

  const resourceServer = (servedBy: string, role: string) =>
    createRouterTransport(({ service }) => {
      service(ProtectedService, protectedImpl(servedBy, role));
      // The rust fake owns bookmarks, like the real rust server.
      const bookmarks: { id: string; url: string; title: string; createdAt: string }[] = [];
      let nextId = 0;
      service(BookmarkService, {
        createBookmark(req) {
          const bookmark = {
            id: `bm-${nextId++}`,
            url: req.url,
            title: req.title,
            createdAt: "2026-07-15T12:00:00Z",
          };
          bookmarks.push(bookmark);
          return { bookmark };
        },
        listBookmarks() {
          return { bookmarks };
        },
        deleteBookmark(req) {
          const i = bookmarks.findIndex((b) => b.id === req.id);
          if (i >= 0) bookmarks.splice(i, 1);
          return {};
        },
      });
    });

  return {
    go: issuer,
    rust: resourceServer("rust-tonic", "user"),
    ts: resourceServer("ts-connect", "user"),
  };
}

async function logIn(transports: Transports) {
  const user = userEvent.setup();
  render(<App transports={transports} />);
  await user.type(screen.getByLabelText(/email/i), "alice@example.com");
  await user.type(screen.getByLabelText(/password/i), "correct horse battery");
  await user.click(screen.getByRole("button", { name: /sign up/i }));
  await screen.findByRole("status");
  await user.click(screen.getByRole("button", { name: /log in/i }));
  await screen.findByRole("button", { name: /log out/i });
  return user;
}

describe("App", () => {
  it("signs up, logs in, and shows the session", async () => {
    await logIn(fakeIssuerAndServers());
    expect(screen.getByText(/2036-07-12T12:00:00Z/)).toBeInTheDocument();
  });

  it("rejects a bad password", async () => {
    const user = userEvent.setup();
    render(<App transports={fakeIssuerAndServers()} />);
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/invalid credentials/i);
  });

  it("loads WhoAmI from all three servers automatically", async () => {
    await logIn(fakeIssuerAndServers());
    expect(await screen.findByText(/go-connect/)).toBeInTheDocument();
    expect(await screen.findByText(/rust-tonic/)).toBeInTheDocument();
    expect(await screen.findByText(/ts-connect/)).toBeInTheDocument();
  });

  it("shows per-server admin denial for a user token", async () => {
    await logIn(fakeIssuerAndServers());
    const denials = await screen.findAllByText(/admin role required/);
    expect(denials).toHaveLength(3);
  });

  it("rotates the refresh token", async () => {
    const user = await logIn(fakeIssuerAndServers());
    await user.click(screen.getByRole("button", { name: /refresh session/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/rotated refresh token/i);
  });

  it("creates and deletes notes through the generated hooks", async () => {
    const user = await logIn(fakeIssuerAndServers());
    await user.type(screen.getByLabelText(/new note/i), "try the pattern");
    await user.click(screen.getByRole("button", { name: /add note/i }));
    expect(await screen.findByText(/try the pattern/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.queryByText(/try the pattern/)).not.toBeInTheDocument();
  });

  it("creates and removes bookmarks on the rust transport", async () => {
    const user = await logIn(fakeIssuerAndServers());
    await user.type(screen.getByLabelText(/new bookmark url/i), "https://buf.build");
    await user.click(screen.getByRole("button", { name: /add bookmark/i }));
    expect(await screen.findByText(/https:\/\/buf\.build/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.queryByText(/https:\/\/buf\.build/)).not.toBeInTheDocument();
  });

  it("logs out back to the form", async () => {
    const user = await logIn(fakeIssuerAndServers());
    await user.click(screen.getByRole("button", { name: /log out/i }));
    expect(await screen.findByRole("button", { name: /sign up/i })).toBeInTheDocument();
  });
});
