# AGENTS.md

## Stack

Polyglot pattern reference — no single toolchain. Each pattern under
`<language>/<category>/<slug>/` keeps its own manifest (`package.json`,
`go.mod`, `buf.yaml`, ...), and each language directory is a workspace
managed by its native tool: pnpm workspace + `catalog:` for `typescript/`
(all shared versions live in `pnpm-workspace.yaml`), `go.work` for `go/`,
Cargo per-crate for `rust/`. Required locally: node + pnpm, go, buf, and
rust + cargo (via rustup). Everything (code, comments, docs) is in English.

## Comment tester

```bash
./scripts/test-all.sh
```

Installs the pnpm workspace once at the root, then runs every pattern's
`test:` command from its `PATTERN.md` frontmatter, in the pattern's directory.
`test: none` marks a docs-only pattern (skipped). To test a single pattern,
run its `test:` command from its directory (after a root `pnpm install` for
TypeScript patterns).

**Dependency bumps**: edit the `catalog:` in `pnpm-workspace.yaml` (or a
`go.mod`), then `./scripts/test-all.sh` — it re-verifies every pattern against
the new versions in one pass.

## Comment livrer

- Branch from `main`; review in lazygit before push.
- No test CI — tests are verified locally with `scripts/test-all.sh` before any push.
- Push to `main` = shipped: GitMCP (`https://gitmcp.io/Skayfa/reference-patterns`)
  serves the repo directly, and the `Deploy site` workflow rebuilds the web UI
  (`site/`, Astro) to GitHub Pages at
  `https://skayfa.github.io/reference-patterns/`. The site auto-discovers
  every `PATTERN.md` — nothing to register.
- Never include client-project code (or anything non-generic) — the repo is public.

## Flow par type

**New pattern** (the only flow here — usually driven by the `distill` skill
from the source project's session):

1. Copy `templates/pattern/PATTERN.md` to `<language>/<category>/<slug>/PATTERN.md`.
2. Fill frontmatter: `name` (= slug), `language` (= top-level dir), `category`,
   `tags`, `description` (one line, drives MCP search), `origin` (source
   project + month; sillon subject slug if any; `built in-repo` for
   explorations), `test`. Two optional fields, `verdict`
   (`adopted | rejected | trial`) and `verdict_note` (one line on why), are
   added later — once the pattern has proven or failed itself in real use,
   never at distill time. The site shows them as a badge and a callout.
3. Write the runnable example — self-contained, no cross-pattern imports.
   TypeScript: the workspace glob (`typescript/*/*`) picks the package up
   automatically; use `"catalog:"` versions (add new deps to the catalog in
   `pnpm-workspace.yaml`) and `test: pnpm test`. Go: add the module to
   `go.work`.
4. Body: Problem → Solution → Path (what was tried and rejected before the
   final solution — from real history, never reconstructed) → Key points
   (the non-obvious bits) → How to run.
5. `./scripts/generate-llms.sh` to regenerate the index (commit `llms.txt`).
6. `./scripts/test-all.sh` must pass.

**New language**: just create the top-level dir with the first pattern —
`generate-llms.sh` picks it up automatically (no empty placeholder dirs).
