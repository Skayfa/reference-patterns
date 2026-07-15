import type { Transport } from "@connectrpc/connect";
import { ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useState } from "react";
import { NoteService } from "./pb/note/v1/note_pb.js";

// The "new entity" walkthrough, front side: everything here is generated
// hooks over the generated schema — the only hand-written code is JSX.
// Notes live on the Go server (it owns the storage), so this panel talks to
// one transport; the token still comes from the shared interceptor.
export function NotesPanel({ transport }: { transport: Transport }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const list = useQuery(NoteService.method.listNotes, undefined, { transport });
  const create = useMutation(NoteService.method.createNote, { transport });
  const remove = useMutation(NoteService.method.deleteNote, { transport });

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setStatus("");
      await list.refetch();
    } catch (err) {
      setStatus(ConnectError.from(err).rawMessage);
    }
  }

  return (
    <section>
      <h2>My notes</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await create.mutateAsync({ text });
            setText("");
          });
        }}
      >
        <label>
          New note
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit">Add note</button>
      </form>
      {status && <p role="status">{status}</p>}
      <ul>
        {(list.data?.notes ?? []).map((note) => (
          <li key={note.id}>
            {note.text}{" "}
            <button type="button" onClick={() => void run(() => remove.mutateAsync({ id: note.id }))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
