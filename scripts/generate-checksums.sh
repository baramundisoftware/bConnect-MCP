#!/usr/bin/env bash
# generate-checksums.sh
#
# Generates SHA-256 checksum files for all .exe artifacts in each server's dist/ directory.
# Run after `npm run pkg` (or `pkg:all`) to produce .sha256 sidecar files.
#
# Usage: ./scripts/generate-checksums.sh [--all-platforms]
#   --all-platforms  Also checksum Linux and macOS binaries (in addition to .exe)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALL_PLATFORMS=false
[[ "${1:-}" == "--all-platforms" ]] && ALL_PLATFORMS=true

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

GENERATED=0
MISSING=0

checksum_file() {
  local filepath="$1"
  local sha_file="${filepath}.sha256"
  sha256sum "$filepath" > "$sha_file"
  echo "  Generated: $(basename "$sha_file")"
  ((GENERATED++))
}

echo "============================================"
echo "  bConnect MCP — SHA-256 Checksum Generator"
echo "============================================"
echo ""

for server in "${SERVERS[@]}"; do
  dist_dir="$REPO_ROOT/$server/dist"
  echo "$server:"

  if [[ ! -d "$dist_dir" ]]; then
    echo "  SKIP: dist/ directory not found (run npm run pkg first)"
    ((MISSING++))
    continue
  fi

  # Windows .exe
  exe="$dist_dir/${server}.exe"
  if [[ -f "$exe" ]]; then
    checksum_file "$exe"
  else
    echo "  SKIP: ${server}.exe not found"
    ((MISSING++))
  fi

  if [[ "$ALL_PLATFORMS" == "true" ]]; then
    # Linux binary (no extension)
    linux_bin="$dist_dir/${server}-linux"
    if [[ -f "$linux_bin" ]]; then
      checksum_file "$linux_bin"
    fi

    # macOS binary
    macos_bin="$dist_dir/${server}-macos"
    if [[ -f "$macos_bin" ]]; then
      checksum_file "$macos_bin"
    fi
  fi
done

echo ""
echo "============================================"
echo "  Generated: $GENERATED checksums"
[[ $MISSING -gt 0 ]] && echo "  Missing:   $MISSING artifacts (build first)"
echo "============================================"
