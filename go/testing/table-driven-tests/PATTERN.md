---
name: table-driven-tests
language: go
category: testing
tags: [testing, table-driven, subtests, t-helper]
description: Idiomatic Go table-driven tests — named map cases, parallel subtests, t.Helper assertion helpers
test: go test ./...
---

# Table-driven tests in Go

## Problem

Testing a pure function across many inputs with one test function per case
duplicates setup and assertion code, and unnamed cases make failures hard to
trace back to their input.

## Solution

`stringsx/slug_test.go` drives `Slugify` through a `map[string]struct` table:

- **Map keys name the cases** — failures print the name, and
  `go test -run 'TestSlugify/empty_input'` reruns a single case.
- **`t.Run` subtests** isolate cases: one failing case does not stop the rest.
- **`t.Parallel()`** at both levels runs cases concurrently.
- **`assertEqual` with `t.Helper()`** keeps messages consistent and makes
  failures point at the calling line inside the table loop.

## Key points

- Use a map when case order is irrelevant (it also shuffles iteration,
  catching order dependencies); use a slice when order matters.
- Since Go 1.22 the loop variable is per-iteration — no `tc := tc` copy is
  needed before `t.Parallel()`.
- Keep the table entries minimal: input and expected output. Case-specific
  setup logic belongs inside the subtest, not in extra table fields.
- `got %q, want %q` quoting surfaces whitespace and empty-string differences.

## How to run

```bash
go test ./...
```
