#!/usr/bin/env bash
#
# Local CI — mirrors .github/workflows/ci.yml without consuming GitHub Actions
# minutes. Run before merging when hosted CI is unavailable.
#
#   npm run ci            # full run
#   npm run ci -- --fast  # skip the semgrep SAST step (no docker pull)
#
# Exit non-zero if build, tests, or the duplication guard fail. Audit and
# semgrep are reported but non-blocking (matching the hosted workflow).

set -uo pipefail
cd "$(dirname "$0")/.."

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

fail=0
section() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }
check()   { if [ "$1" -ne 0 ]; then echo "  ✗ $2"; fail=1; else echo "  ✓ $2"; fi; }

section "Build shared core (@bconnect/mcp-core)"
npm run build -w @bconnect/mcp-core >/dev/null 2>&1; check $? "core build"

section "Build + test servers and template"
for d in bconnect-*-mcp bconnect-server-template; do
  [ -d "$d" ] || continue
  npm run build -w "$d" >/dev/null 2>&1; check $? "$d build"
  if grep -q '"test"' "$d/package.json" 2>/dev/null; then
    ( cd "$d" && npx vitest run --passWithNoTests >/dev/null 2>&1 ); check $? "$d test"
  fi
done

section "Build + test gateway (non-workspace)"
( cd bconnect-mcp-gateway && npx tsc >/dev/null 2>&1 ); check $? "gateway build"
( cd bconnect-mcp-gateway && npx vitest run --passWithNoTests >/dev/null 2>&1 ); check $? "gateway test"

section "Duplication guard (jscpd — config in .jscpd.json)"
npx --yes jscpd@5.0.11 bconnect-*-mcp/src bconnect-server-template/src >/dev/null 2>&1
check $? "no copy-pasted client/util code"

section "Dependency audit (non-blocking)"
npm audit --omit=dev 2>/dev/null | tail -3 || true

section "SAST — Semgrep (non-blocking)"
if [ "$FAST" -eq 1 ]; then
  echo "  skipped (--fast)"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$PWD":/src -w /src semgrep/semgrep \
    semgrep scan --config p/security-audit --config p/secrets --config p/typescript \
    --config p/nodejs --metrics=off \
    --exclude build --exclude node_modules --exclude tests --exclude __tests__ \
    --exclude fixtures --exclude '*.test.ts' --exclude index.ts 2>&1 | tail -3 || true
else
  echo "  docker not found — skipped"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo -e "\033[31m❌ LOCAL CI FAILED\033[0m"; exit 1
else
  echo -e "\033[32m✅ LOCAL CI PASSED\033[0m"; exit 0
fi
