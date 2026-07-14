#!/usr/bin/env bash
#
# publish-image.sh — Build and push the multi-arch bConnect MCP **gateway** image
# to GHCR from a local machine, without GitHub Actions.
#
# Per ADR-003 only the gateway is distributed as a container (the 13 domain
# servers run over stdio). Builds linux/amd64 + linux/arm64 (one native, the
# other via QEMU emulation) into a single manifest list and pushes it to the
# GitHub Container Registry. Mirrors the tag scheme of
# .github/workflows/docker-publish.yml (X.Y.Z, X.Y, latest), deriving the
# version from the root package.json.
#
# Usage:
#   scripts/publish-image.sh [options]
#
# Options:
#   -y, --yes           Skip the confirmation prompt (non-interactive)
#   -n, --dry-run       Build both arches but DO NOT push (validation only)
#       --version VER   Override the version (default: root package.json version)
#       --platforms P   Comma-separated platforms (default: linux/amd64,linux/arm64)
#       --no-latest     Do not also tag/push :latest
#   -h, --help          Show this help
#
# Environment overrides:
#   REGISTRY     (default: ghcr.io)
#   IMAGE_OWNER  (default: baramundisoftware)
#   IMAGE_NAME   (default: bconnect-mcp-gateway)
#   GHCR_USER / GHCR_TOKEN   If set, used for `docker login`. Otherwise the
#                            script tries `gh auth token`, else assumes you are
#                            already logged in to the registry.
#
set -euo pipefail

# --- locate repo root (script lives in <root>/scripts) ---------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# --- config ----------------------------------------------------------------
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_OWNER="${IMAGE_OWNER:-baramundisoftware}"
IMAGE_NAME="${IMAGE_NAME:-bconnect-mcp-gateway}"
IMAGE="${REGISTRY}/${IMAGE_OWNER}/${IMAGE_NAME}"
DOCKERFILE="bconnect-mcp-gateway/Dockerfile"       # context is the repo root
BUILDER="bconnect-mcp-publisher"
PLATFORMS="linux/amd64,linux/arm64"
BUILD_ONLY=0
ASSUME_YES=0
TAG_LATEST=1
VERSION=""

log()  { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- args ------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)       ASSUME_YES=1 ;;
    -n|--dry-run)   BUILD_ONLY=1 ;;
    --no-latest)    TAG_LATEST=0 ;;
    --version)      VERSION="${2:?--version needs a value}"; shift ;;
    --platforms)    PLATFORMS="${2:?--platforms needs a value}"; shift ;;
    -h|--help)      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

command -v docker >/dev/null || die "docker not found"
docker buildx version >/dev/null 2>&1 || die "docker buildx not available"
[ -f "${DOCKERFILE}" ] || die "gateway Dockerfile not found at ${DOCKERFILE}"

# --- version + tags --------------------------------------------------------
if [ -z "${VERSION}" ]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null)" \
    || die "could not read version from package.json"
fi
[ -n "${VERSION}" ] || die "empty version"

MAJOR="${VERSION%%.*}"
MINOR="${VERSION#*.}"; MINOR="${MINOR%%.*}"

# Match docker-publish.yml: X.Y.Z, X.Y, latest (no bare-major tag).
TAG_ARGS=(-t "${IMAGE}:${VERSION}" -t "${IMAGE}:${MAJOR}.${MINOR}")
TAG_LIST="${IMAGE}:${VERSION}, ${IMAGE}:${MAJOR}.${MINOR}"
if [ "${TAG_LATEST}" -eq 1 ]; then
  TAG_ARGS+=(-t "${IMAGE}:latest")
  TAG_LIST="${TAG_LIST}, ${IMAGE}:latest"
fi

REVISION="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- summary ---------------------------------------------------------------
log "bConnect MCP gateway image publish"
echo "  image      : ${IMAGE}"
echo "  version    : ${VERSION}"
echo "  dockerfile : ${DOCKERFILE}"
echo "  platforms  : ${PLATFORMS}"
echo "  tags       : ${TAG_LIST}"
echo "  revision   : ${REVISION}"
echo "  mode       : $([ "${BUILD_ONLY}" -eq 1 ] && echo 'DRY RUN (build only, no push)' || echo 'BUILD + PUSH to GHCR')"
echo

# --- buildx builder (multi-platform) ---------------------------------------
if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  log "Creating buildx builder '${BUILDER}' (docker-container driver)"
  docker buildx create --name "${BUILDER}" --driver docker-container --bootstrap >/dev/null
fi

# verify the requested platforms are actually supported by this builder
AVAIL="$(docker buildx inspect "${BUILDER}" --bootstrap 2>/dev/null | awk -F': ' '/Platforms/{print $2}')"
IFS=',' read -ra WANT <<< "${PLATFORMS}"
for p in "${WANT[@]}"; do
  case ",${AVAIL//[[:space:]]/}," in
    *",${p},"*) : ;;
    *) warn "Platform '${p}' not advertised by builder. If this is an emulated arch, register QEMU with:"
       warn "    docker run --privileged --rm tonistiigi/binfmt --install all"
       ;;
  esac
done

# --- push path: ensure logged in + confirm ---------------------------------
if [ "${BUILD_ONLY}" -eq 0 ]; then
  if [ -n "${GHCR_TOKEN:-}" ]; then
    log "Logging in to ${REGISTRY} as ${GHCR_USER:-$IMAGE_OWNER} (GHCR_TOKEN)"
    printf '%s' "${GHCR_TOKEN}" | docker login "${REGISTRY}" -u "${GHCR_USER:-$IMAGE_OWNER}" --password-stdin >/dev/null
  elif command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
    log "Logging in to ${REGISTRY} via gh auth token"
    gh auth token | docker login "${REGISTRY}" -u "$(gh api user -q .login)" --password-stdin >/dev/null
  else
    warn "No GHCR_TOKEN and no usable gh auth — assuming you are already \`docker login\`ed to ${REGISTRY}."
  fi

  if [ "${ASSUME_YES}" -eq 0 ]; then
    printf 'Push %s (%s) to %s? [y/N] ' "${VERSION}" "${PLATFORMS}" "${REGISTRY}"
    read -r reply
    case "${reply}" in
      y|Y|yes|YES) : ;;
      *) die "Aborted." ;;
    esac
  fi
fi

# --- build (+push) ---------------------------------------------------------
COMMON_ARGS=(
  --builder "${BUILDER}"
  --file "${DOCKERFILE}"
  --platform "${PLATFORMS}"
  "${TAG_ARGS[@]}"
  --label "org.opencontainers.image.title=bconnect-mcp-gateway"
  --label "org.opencontainers.image.description=bConnect MCP HTTP gateway (multi-user / n8n)"
  --label "org.opencontainers.image.source=https://github.com/${IMAGE_OWNER}/bConnect-MCP"
  --label "org.opencontainers.image.version=${VERSION}"
  --label "org.opencontainers.image.revision=${REVISION}"
  --label "org.opencontainers.image.created=${CREATED}"
  --label "org.opencontainers.image.vendor=baramundi software GmbH"
)

if [ "${BUILD_ONLY}" -eq 1 ]; then
  log "Building (dry run — no push)"
  docker buildx build "${COMMON_ARGS[@]}" --output type=cacheonly .
  log "Dry run OK — requested platforms built, nothing pushed."
  exit 0
fi

log "Building and pushing multi-arch image"
docker buildx build "${COMMON_ARGS[@]}" --push .

# --- verify ----------------------------------------------------------------
log "Verifying published manifest"
docker buildx imagetools inspect "${IMAGE}:${VERSION}" | grep -E 'Name:|Platform:' || true
log "Done — ${IMAGE}:${VERSION} published (${PLATFORMS})."
