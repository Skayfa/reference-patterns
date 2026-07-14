# reference-patterns

Personal reference of implementation and testing patterns across languages
(TypeScript, Go, Protobuf — Rust and more as they come). Each pattern is a
**self-contained, runnable example** documented in its `PATTERN.md`, meant to be
consumed from other projects through MCP.

## Layout

```text
<language>/<category>/<pattern-slug>/
├── PATTERN.md    # frontmatter (name, tags, description, test command) + Problem/Solution/Key points
└── ...           # runnable code with its own manifest (package.json, go.mod, buf.yaml, ...)
```

- [llms.txt](./llms.txt) is the generated index of every pattern — this is what
  MCP clients read first.
- Patterns never depend on each other.
- **Each language directory is a workspace** managed by its native tool:
  `pnpm-workspace.yaml` (with a `catalog:` as the single place to bump
  TypeScript dependency versions), `go.work`, and per-crate Cargo for Rust.
  One root `pnpm install` covers every TypeScript pattern; bumping a catalog
  version + running `./scripts/test-all.sh` re-verifies the whole reference
  at once. Toolchains needed locally: node + pnpm, go, buf, rust + cargo.

## Consume via MCP (GitMCP)

This repo is served as an MCP server by [GitMCP](https://gitmcp.io) — no
hosting, it reads the public repo directly. From any project:

```bash
claude mcp add --transport http patterns https://gitmcp.io/Skayfa/reference-patterns
```

or in `mcpServers`:

```json
"patterns": {
  "type": "http",
  "url": "https://gitmcp.io/Skayfa/reference-patterns"
}
```

Exposed tools: `fetch_reference_docs` (returns `llms.txt`),
`search_reference_docs`, `search_reference_code`, `fetch_generic_url_content`.

## Add a pattern

1. Copy `templates/pattern/PATTERN.md` into `<language>/<category>/<slug>/`.
2. Fill the frontmatter — `description` is what MCP search matches against;
   `test` is the command `scripts/test-all.sh` runs from the pattern directory
   (`none` for docs-only patterns).
3. Add the runnable code with its own manifest. TypeScript patterns are picked
   up by the workspace glob automatically — use `"catalog:"` versions (add new
   entries to `pnpm-workspace.yaml`) and `test: pnpm test`.
4. `./scripts/generate-llms.sh` to refresh the index.
5. `./scripts/test-all.sh` — everything must pass before pushing.

## Test everything

```bash
./scripts/test-all.sh
```
