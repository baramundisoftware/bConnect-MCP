#!/usr/bin/env bash
#
# release.sh — build the release archive and (optionally) create a GitHub Release
# locally, without GitHub Actions. Replaces .github/workflows/release.yml now that
# the org's Actions budget is blocked.
#
# The archive is assembled from git-tracked files only (`git ls-files`), so
# gitignored internal docs (Bugs_*, NEXT-STEPS, SECURITY-AUDIT-*, docs/adr/,
# Tasks.md) are automatically excluded from what customers receive.
#
# Usage:
#   scripts/release.sh [options]
#
# Options:
#   -n, --dry-run      Build + package the archive, but DO NOT create the Release
#       --version VER  Override version (default: root package.json)
#       --skip-tests   Skip `npm test`
#       --skip-build   Reuse existing build/ output (no npm ci / rebuild)
#   -h, --help         Show this help
#
# Requires: node, npm, zip, git; and `gh` (authenticated) unless --dry-run.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

DRY_RUN=0
SKIP_TESTS=0
SKIP_BUILD=0
VERSION=""

log()  { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run)  DRY_RUN=1 ;;
    --skip-tests)  SKIP_TESTS=1 ;;
    --skip-build)  SKIP_BUILD=1 ;;
    --version)     VERSION="${2:?--version needs a value}"; shift ;;
    -h|--help)     sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

command -v node >/dev/null || die "node not found"
command -v zip  >/dev/null || die "zip not found"
[ "${DRY_RUN}" -eq 1 ] || command -v gh >/dev/null || die "gh not found (needed to create the Release; use --dry-run to skip)"

[ -n "${VERSION}" ] || VERSION="$(node -p "require('./package.json').version" 2>/dev/null)" \
  || die "could not read version from package.json"
[ -n "${VERSION}" ] || die "empty version"

ARCHIVE="bconnect-mcp-suite-${VERSION}.zip"
PKG="release-package"

# --- build shared core + all servers --------------------------------------
if [ "${SKIP_BUILD}" -eq 0 ]; then
  log "Installing workspaces (npm ci)"
  npm ci
  log "Building shared core + all servers"
  npm run build -w @bconnect/mcp-core
  npm run build
else
  warn "Skipping build — packaging whatever is already in build/ dirs"
fi

if [ "${SKIP_TESTS}" -eq 0 ]; then
  log "Running tests"
  npm test
else
  warn "Skipping tests (--skip-tests)"
fi

# --- assemble the archive (mirrors release.yml) ---------------------------
log "Assembling ${ARCHIVE}"
rm -rf "${PKG}" "${ARCHIVE}" "${ARCHIVE}.sha256"
mkdir -p "${PKG}"

# Root workspace files — `npm ci` at the extracted root wires @bconnect/mcp-core.
cp package.json package-lock.json README.md LICENSE CHANGELOG.md .env.example "${PKG}/"

# Documentation — TRACKED files only. `git ls-files` never lists gitignored
# internal docs, so they are automatically excluded from the release.
git ls-files docs/ SUPPORT.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md | while read -r f; do
  mkdir -p "${PKG}/$(dirname "$f")"
  cp "$f" "${PKG}/$f"
done

# Shared core (built) + server-template manifest (workspace members — their
# package.json must be present for `npm ci` to validate the lockfile).
mkdir -p "${PKG}/packages/mcp-core" "${PKG}/bconnect-server-template"
cp -r packages/mcp-core/build "${PKG}/packages/mcp-core/"
cp packages/mcp-core/package.json "${PKG}/packages/mcp-core/"
cp bconnect-server-template/package.json "${PKG}/bconnect-server-template/"

# Each server: built output + manifest + docs
for dir in bconnect-*-mcp; do
  echo "  packaging ${dir}"
  mkdir -p "${PKG}/${dir}"
  cp -r "${dir}/build" "${PKG}/${dir}/"
  cp "${dir}/package.json" "${PKG}/${dir}/"
  [ -f "${dir}/.env.example" ] && cp "${dir}/.env.example" "${PKG}/${dir}/" || true
  [ -f "${dir}/README.md" ] && cp "${dir}/README.md" "${PKG}/${dir}/" || true
done

cat > "${PKG}/INSTALL.md" <<'INSTALLEOF'
# Installation

## Prerequisites
- Node.js 20 or later (https://nodejs.org/) — 22.15+ recommended (honors the OS/Windows CA trust store)
- Your bMS server address and credentials

## Steps
1. Extract this archive.
2. From the extracted root, install runtime dependencies for the whole suite:

       npm ci --omit=dev

   This wires the shared `@bconnect/mcp-core` package that every server imports.
3. Copy `.env.example` to `.env` and fill in your credentials.
4. Start a server, e.g.:

       node bconnect-endpoints-mcp/build/index.js

For the HTTP gateway and Docker options, see README.md and the docs/ folder.
INSTALLEOF

( cd "${PKG}" && zip -qr "../${ARCHIVE}" . )
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
log "Built ${ARCHIVE} ($(du -h "${ARCHIVE}" | cut -f1)) + .sha256"

# --- release notes from CHANGELOG -----------------------------------------
NOTES="$(mktemp)"
awk "/^## \[${VERSION}\]/{f=1;next} /^## \[/{if(f)exit} f{print}" CHANGELOG.md > "${NOTES}"
[ -s "${NOTES}" ] || echo "Release ${VERSION}" > "${NOTES}"

# --- create the GitHub Release --------------------------------------------
if [ "${DRY_RUN}" -eq 1 ]; then
  log "Dry run — archive built, Release NOT created."
  echo "  notes preview:"; sed 's/^/    /' "${NOTES}" | head -20
  rm -f "${NOTES}"
  exit 0
fi

TAG="v${VERSION}"
log "Creating GitHub Release ${TAG} (prerelease) at $(git rev-parse --short HEAD)"
gh release create "${TAG}" \
  --title "${TAG}" \
  --notes-file "${NOTES}" \
  --prerelease \
  --target "$(git rev-parse HEAD)" \
  "${ARCHIVE}" "${ARCHIVE}.sha256"
rm -f "${NOTES}"
log "Done — Release ${TAG} published with ${ARCHIVE}."
