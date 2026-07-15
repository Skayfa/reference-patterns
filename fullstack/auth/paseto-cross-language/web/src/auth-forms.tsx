import type { Transport } from "@connectrpc/connect";
import { ConnectError } from "@connectrpc/connect";
import { useMutation } from "@connectrpc/connect-query";
import { useState } from "react";
import { AuthService } from "./pb/auth/v1/auth_pb.js";
import { type Session, sessionFrom } from "./session.js";

interface Props {
  transport: Transport;
  onSession: (session: Session) => void;
}

// Deliberately plain (useState, no form library): the pattern is about the
// tokens, not the form. See fullstack/rpc/connect-protovalidate-tanstack for
// the full TanStack form machinery.
export function AuthForms({ transport, onSession }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const signUp = useMutation(AuthService.method.signUp, { transport });
  const logIn = useMutation(AuthService.method.logIn, { transport });

  async function run(action: "signup" | "login") {
    try {
      if (action === "signup") {
        await signUp.mutateAsync({ email, password });
        setStatus("account created — log in");
        return;
      }
      const res = await logIn.mutateAsync({ email, password });
      onSession(sessionFrom(res.tokens));
    } catch (err) {
      setStatus(ConnectError.from(err).rawMessage);
    }
  }

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <h2>Log in</h2>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="button" onClick={() => run("signup")}>
        Sign up
      </button>
      <button type="submit" onClick={() => run("login")}>
        Log in
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
