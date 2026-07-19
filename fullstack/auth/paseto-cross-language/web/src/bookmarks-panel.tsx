import type { Transport } from "@connectrpc/connect";
import { ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useState } from "react";
import { BookmarkService } from "./pb/bookmark/v1/bookmark_pb.js";

// Same generated-hooks data layer as the notes panel, but the owner is the
// RUST server, reached over gRPC-web: pass `transports.rust` and nothing
// else changes — that is the whole point of the shared contract.
export function BookmarksPanel({ transport }: { transport: Transport }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const list = useQuery(BookmarkService.method.listBookmarks, undefined, { transport });
  const create = useMutation(BookmarkService.method.createBookmark, { transport });
  const remove = useMutation(BookmarkService.method.deleteBookmark, { transport });

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
      <h2>My bookmarks (served by Rust)</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            // title is its own field: the contract caps it at 200 chars while
            // url allows 2048, so reusing url as title would reject long URLs.
            await create.mutateAsync({ url, title });
            setUrl("");
            setTitle("");
          });
        }}
      >
        <label>
          New bookmark URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label>
          Title (optional)
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button type="submit">Add bookmark</button>
      </form>
      {status && <p role="status">{status}</p>}
      <ul>
        {(list.data?.bookmarks ?? []).map((bookmark) => (
          <li key={bookmark.id}>
            {bookmark.url}{" "}
            <button
              type="button"
              onClick={() => void run(() => remove.mutateAsync({ id: bookmark.id }))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
