import { ConnectError } from "@connectrpc/connect";
import { useMutation } from "@connectrpc/connect-query";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthForms } from "./auth-forms.js";
import { BookmarksPanel } from "./bookmarks-panel.js";
import { NotesPanel } from "./notes-panel.js";
import { AuthService } from "./pb/auth/v1/auth_pb.js";
import { type Session, sessionFrom } from "./session.js";
import { type Transports, defaultTransports, setAccessToken } from "./transports.js";
import { AdminPanel, WhoAmIPanel } from "./whoami-panel.js";

function Dashboard({
  transports,
  session,
  onSession,
}: {
  transports: Transports;
  session: Session;
  onSession: (next: Session | null) => void;
}) {
  const [status, setStatus] = useState("");
  const refresh = useMutation(AuthService.method.refresh, { transport: transports.go });
  const logOut = useMutation(AuthService.method.logOut, { transport: transports.go });

  return (
    <main>
      <p>
        Access token expires at <time>{session.accessExpiresAt}</time>
      </p>
      <button
        type="button"
        onClick={async () => {
          try {
            const res = await refresh.mutateAsync({ refreshToken: session.refreshToken });
            onSession(sessionFrom(res.tokens));
            setStatus("refreshed: new access + rotated refresh token");
          } catch (err) {
            setStatus(`refresh failed: ${ConnectError.from(err).rawMessage}`);
            onSession(null);
          }
        }}
      >
        Refresh session
      </button>
      <button
        type="button"
        onClick={async () => {
          // Clear the session even if the revoke RPC fails (server down):
          // the client must not stay logged in with a live token injected.
          try {
            await logOut.mutateAsync({ refreshToken: session.refreshToken });
          } catch (err) {
            setStatus(`logout could not reach the server: ${ConnectError.from(err).rawMessage}`);
          } finally {
            onSession(null);
          }
        }}
      >
        Log out
      </button>
      {status && <p role="status">{status}</p>}
      <WhoAmIPanel transports={transports} />
      <AdminPanel transports={transports} />
      <NotesPanel transport={transports.go} />
      <BookmarksPanel transport={transports.rust} />
    </main>
  );
}

function AppInner({ transports }: { transports: Transports }) {
  const [session, setSession] = useState<Session | null>(null);
  const queryClient = useQueryClient();

  function onSession(next: Session | null) {
    // Token first, then render: the panels' queries fire with the header set.
    setAccessToken(next?.accessToken ?? null);
    setSession(next);
    if (!next) {
      queryClient.clear();
    }
  }

  if (!session) {
    return <AuthForms transport={transports.go} onSession={onSession} />;
  }
  return <Dashboard transports={transports} session={session} onSession={onSession} />;
}

export function App({ transports }: { transports: Transports }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner transports={transports} />
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App transports={defaultTransports()} />
    </StrictMode>,
  );
}
