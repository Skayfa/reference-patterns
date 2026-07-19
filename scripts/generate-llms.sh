#!/usr/bin/env bash
# Regenerate llms.txt — the GitMCP entry point — from the frontmatter of every
# PATTERN.md. Run after adding or renaming a pattern.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_URL="https://github.com/Skayfa/reference-patterns"
OUT="llms.txt"

field() { grep -m1 "^$2:" "$1" | sed "s/^$2:[[:space:]]*//"; }

heading() {
  case "$1" in
    typescript) echo "TypeScript" ;;
    go) echo "Go" ;;
    protobuf) echo "Protobuf" ;;
    rust) echo "Rust" ;;
    *) echo "$(tr '[:lower:]' '[:upper:]' <<< "${1:0:1}")${1:1}" ;;
  esac
}

{
  echo "# reference-patterns"
  echo
  echo "> Personal reference of implementation and testing patterns across languages."
  echo "> Each pattern is a self-contained, runnable example documented in its PATTERN.md."
  echo

  for lang_dir in */; do
    lang="${lang_dir%/}"
    [[ "$lang" == "scripts" || "$lang" == "templates" || "$lang" == "site" ]] && continue
    patterns=$(find "$lang" -name PATTERN.md -not -path '*/node_modules/*' | sort)
    [[ -z "$patterns" ]] && continue

    echo "## $(heading "$lang")"
    echo
    while IFS= read -r f; do
      name=$(field "$f" name)
      desc=$(field "$f" description)
      echo "- [$name]($REPO_URL/blob/main/$f): $desc"
    done <<< "$patterns"
    echo
  done
} > "$OUT"

echo "Generated $OUT"
