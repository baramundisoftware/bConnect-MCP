#!/usr/bin/env bash
# pkg-output.test.sh
#
# Asserts that after `npm run pkg` in each server directory:
#   - dist/<server-name>.exe exists
#   - dist/<server-name>.exe.sha256 exists
#
# Usage: ./build-tests/pkg-output.test.sh [--check-only]
#   --check-only  Skip build; only check existing artifacts
#
# Exit code: 0 = all assertions pass, 1 = one or more failures

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=false
[[ "${1:-}" == "--check-only" ]] && CHECK_ONLY=true

SERVERS=(
  "bconnect-activedirectory-mcp"
  "bconnect-assets-mcp"
  "bconnect-compliance-mcp"
  "bconnect-defensecontrol-mcp"
  "bconnect-endpoints-mcp"
  "bconnect-jobs-mcp"
  "bconnect-operatingsystems-mcp"
  "bconnect-servermanagement-mcp"
  "bconnect-software-mcp"
  "bconnect-universaldynamicgroups-mcp"
  "bconnect-updatemanagement-mcp"
  "bconnect-variables-mcp"
)

PASS=0
FAIL=0

check_artifact() {
  local server="$1"
  local dir="$REPO_ROOT/$server"
  local exe="$dir/dist/${server}.exe"
  local sha="$dir/dist/${server}.exe.sha256"

  echo "Checking $server..."

  if [[ ! -f "$exe" ]]; then
    echo "  FAIL: $exe not found"
    ((FAIL++))
    return
  fi
  echo "  PASS: $exe exists ($(du -sh "$exe" | cut -f1))"

  if [[ ! -f "$sha" ]]; then
    echo "  FAIL: $sha not found"
    ((FAIL++))
    return
  fi
  echo "  PASS: $sha exists"

  ((PASS++))
}

build_server() {
  local server="$1"
  local dir="$REPO_ROOT/$server"
  echo "Building $server..."
  (cd "$dir" && npm run build && npm run pkg) 2>&1 | tail -5
}

generate_checksum() {
  local server="$1"
  local dir="$REPO_ROOT/$server"
  local exe="$dir/dist/${server}.exe"
  local sha="$dir/dist/${server}.exe.sha256"
  if [[ -f "$exe" ]]; then
    sha256sum "$exe" > "$sha"
    echo "  Generated: $sha"
  fi
}

echo "============================================"
echo "  bConnect MCP — pkg output assertion test"
echo "============================================"
echo ""

if [[ "$CHECK_ONLY" == "false" ]]; then
  echo "Phase 1: Build all servers..."
  echo ""
  for server in "${SERVERS[@]}"; do
    build_server "$server"
    generate_checksum "$server"
  done
  echo ""
fi

echo "Phase 2: Assert artifacts exist..."
echo ""
for server in "${SERVERS[@]}"; do
  check_artifact "$server"
done

echo ""
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"

[[ $FAIL -eq 0 ]]
