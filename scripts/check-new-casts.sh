#!/usr/bin/env bash
# REQ-QA-002 AC 3: new or changed code has no type-defeating casts.
#
# ESLint's suppressions (eslint-suppressions.json) count casts per file, so a
# cast removed from one handler and added to another keeps the count and
# passes lint. This check looks at the lines a change adds instead: any added
# line in server, template or core source (tests excluded) that contains
# `as never` or `as unknown as` fails. Touching a line that holds an old cast
# therefore means removing the cast.
#
#   scripts/check-new-casts.sh            # compare with the merge base of origin/main
#   scripts/check-new-casts.sh HEAD^1     # CI: the PR merge commit vs. its base
set -euo pipefail

base="${1:-$(git merge-base origin/main HEAD)}"

added=$(git diff -U0 "$base" -- \
  'bconnect-*-mcp/src/*' 'bconnect-server-template/src/*' 'packages/mcp-core/src/*' \
  ':(exclude,glob)**/__tests__/**' \
  | grep -E '^\+[^+]' | grep -E '\bas never\b|\bas unknown as\b' || true)

if [ -n "$added" ]; then
  echo "::error::Added lines contain type-defeating casts (REQ-QA-002). Build the value with the generated types instead:"
  echo "$added"
  exit 1
fi
echo "No added type-defeating casts (compared with ${base})."
