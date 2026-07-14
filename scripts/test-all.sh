#!/usr/bin/env bash
# Run every pattern's test command, read from the `test:` field of its
# PATTERN.md frontmatter. Patterns with `test: none` are docs-only and skipped.
set -euo pipefail

cd "$(dirname "$0")/.."

failed=()
ran=0

while IFS= read -r pattern_file; do
  dir=$(dirname "$pattern_file")
  cmd=$(grep -m1 '^test:' "$pattern_file" | sed 's/^test:[[:space:]]*//')

  if [[ -z "$cmd" ]]; then
    echo "SKIP  $dir (no test field)"
    continue
  fi
  if [[ "$cmd" == "none" ]]; then
    echo "SKIP  $dir (docs-only)"
    continue
  fi

  ran=$((ran + 1))
  echo "RUN   $dir -> $cmd"
  if (cd "$dir" && bash -c "$cmd"); then
    echo "PASS  $dir"
  else
    echo "FAIL  $dir"
    failed+=("$dir")
  fi
done < <(find . -name PATTERN.md -not -path './templates/*' -not -path '*/node_modules/*' | sort)

echo
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "${#failed[@]} pattern(s) failed: ${failed[*]}"
  exit 1
fi
echo "All $ran runnable pattern(s) passed."
