#!/usr/bin/env bash
# docker-smoke.test.sh
#
# Smoke test: Build bconnect-activedirectory-mcp Docker image, start a fresh
# container, send an MCP initialize request via stdin, assert response contains
# serverInfo.name = "bconnect-activedirectory-mcp".
#
# Usage: ./build-tests/docker-smoke.test.sh [--skip-build]
#   --skip-build  Use existing Docker image instead of building
#
# Exit code: 0 = PASS, 1 = FAIL

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="bconnect-activedirectory-mcp"
IMAGE="${SERVER}:26.1.0"
SKIP_BUILD=false
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=true

echo "============================================"
echo "  bConnect MCP — Docker Smoke Test"
echo "  Server: $SERVER"
echo "============================================"
echo ""

# Phase 1: Build image
if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "Phase 1: Building Docker image..."
  docker build -t "$IMAGE" "$REPO_ROOT/$SERVER" 2>&1 | tail -5
  echo "  Built: $IMAGE"
else
  echo "Phase 1: Skipping build (--skip-build)"
  if ! docker image inspect "$IMAGE" &>/dev/null; then
    echo "  FAIL: Image $IMAGE not found. Run without --skip-build first."
    exit 1
  fi
  echo "  Image found: $IMAGE"
fi
echo ""

# Phase 2: Send MCP initialize request via stdin to a fresh container
echo "Phase 2: Sending MCP initialize request..."

MCP_INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}'

RESPONSE=$(echo "$MCP_INIT" | timeout 15 docker run --rm -i \
  --env BCONNECT_BASE_URL=https://test.invalid/bconnect \
  --env BCONNECT_USERNAME=test \
  --env BCONNECT_PASSWORD=test \
  "$IMAGE" \
  node build/index.js 2>/dev/null | head -1 || true)

echo "  Response received (${#RESPONSE} bytes)"
echo ""

# Phase 3: Assert response
echo "Phase 3: Asserting response..."

if [[ -z "$RESPONSE" ]]; then
  echo "  FAIL: Empty response from container"
  exit 1
fi

if echo "$RESPONSE" | grep -q '"serverInfo"'; then
  echo "  PASS: Response contains serverInfo"
else
  echo "  FAIL: Response missing serverInfo"
  echo "  Response: $RESPONSE"
  exit 1
fi

if echo "$RESPONSE" | grep -q '"bconnect-activedirectory-mcp"'; then
  echo "  PASS: serverInfo.name = bconnect-activedirectory-mcp"
else
  echo "  FAIL: serverInfo.name not found or wrong"
  echo "  Response: $RESPONSE"
  exit 1
fi

if echo "$RESPONSE" | grep -q '"protocolVersion"'; then
  echo "  PASS: Response contains protocolVersion"
else
  echo "  FAIL: Response missing protocolVersion"
  exit 1
fi

echo ""
echo "============================================"
echo "  PASS: Docker smoke test succeeded"
echo "============================================"
