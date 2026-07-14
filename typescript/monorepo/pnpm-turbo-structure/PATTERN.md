---
name: pnpm-turbo-structure
language: typescript
category: monorepo
tags: [pnpm, turborepo, workspace, tooling, monorepo]
description: How to structure a pnpm + Turborepo monorepo — apps/packages/tooling split, shared configs as packages, task graph
test: none
---

# pnpm + Turborepo monorepo structure

Concepts distilled from [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo);
the stack (Next.js, tRPC...) is incidental — the structure is the pattern.

## Problem

Several apps share business logic, UI and tooling config. Without structure,
config drifts between apps, cross-package type-safety is lost, and every CI
run rebuilds everything.

## Solution

### Three workspace roots, three responsibilities

```text
apps/       # deployables — thin, mostly wiring (web, mobile, ...)
packages/   # shared code — @org/api, @org/db, @org/ui, @org/validators
tooling/    # shared DEV config as packages — eslint, prettier, tsconfig, tailwind
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
  - tooling/*
catalog: # single source of truth for shared dependency versions
  typescript: ^5.7.0
  zod: ^3.24.0
```

Packages then declare `"zod": "catalog:"` — bumping a version happens in one
place.

### Config as packages, not copy-paste

Each app extends the tooling packages instead of owning its config:

```jsonc
// apps/web/package.json
"devDependencies": {
  "@org/eslint-config": "workspace:*",
  "@org/tsconfig": "workspace:*"
}
// apps/web/tsconfig.json
{ "extends": "@org/tsconfig/base.json" }
```

### Task graph in turbo.json

```jsonc
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

`^build` means "build my workspace dependencies first"; declared `outputs`
make task results cacheable — unchanged packages are skipped entirely.

### Internal packages stay source-only

Shared packages ship TypeScript source via `exports`, no build step:

```jsonc
// packages/validators/package.json
{
  "name": "@org/validators",
  "exports": { ".": "./src/index.ts" }
}
```

The consuming app's bundler compiles them; `dependsOn: ["^build"]` only
bites for packages that genuinely emit artifacts.

## Key points

- **Server code as devDependency in clients**: a client app that needs only
  the *types* of `@org/api` lists it in `devDependencies` — full type-safety,
  zero backend code in the client bundle.
- Shared runtime code between client and server (validation schemas) gets
  its own package (`@org/validators`) rather than living in the API package.
- `pnpm turbo gen init` scaffolds a new package with tooling pre-wired —
  encode the package conventions in the generator, not in a wiki.
- Root `.env` shared via `dotenv-cli` wrapper scripts (`with-env`) instead of
  per-app env files.
- Namespace everything (`@org/*`) from day one; renaming later is a
  find-and-replace across every import.

## How to run

Docs-only pattern — see [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo)
for a full runnable instance:

```bash
npx create-turbo@latest -e https://github.com/t3-oss/create-t3-turbo
```
