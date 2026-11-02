#!/usr/bin/env bash
#
# Local CI: runs what .github/workflows/ci.yml runs, on this machine (#337).
#
#   npm run ci                 # everything below
#   npm run ci -- --no-mock    # without the mock tier (no Docker needed)
#   npm run ci -- --fast       # without the mock tier and Semgrep
#
# Blocking, as in CI (`gate`, `coverage`, `mock`):
#   build, lint, no new casts, the root test suite, the coverage floors, and the
#   mock tier for 26r1 and 25r2 against the bConnect-Mock image ci.yml pins
#   (started here in its own containers, rate limit off).
# Reported, not blocking, as in CI (`strict`): npm audit --audit-level=high.
# Local extras, not in CI: jscpd duplication check (blocking), Semgrep (reported).
#
# Expects `npm ci` to have run. __tests__/ci-local.guard.test.ts fails when a
# command CI runs is missing here.

set -uo pipefail
cd "$(dirname "$0")/.."

MOCK=1
SEMGREP=1
for arg in "$@"; do
  case "$arg" in
    --no-mock) MOCK=0 ;;
    --fast) MOCK=0; SEMGREP=0 ;;
    *) echo "unknown option: $arg (use --no-mock or --fast)"; exit 2 ;;
  esac
done

fail=0
section() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }
check()   { if [ "$1" -ne 0 ]; then echo "  ✗ $2"; fail=1; else echo "  ✓ $2"; fi; }

section "Build (core, servers, template)"
npm run build >/dev/null 2>&1; check $? "npm run build"

section "Lint and casts"
npm run lint >/dev/null 2>&1; check $? "npm run lint"
bash scripts/check-new-casts.sh >/dev/null 2>&1; check $? "scripts/check-new-casts.sh (vs origin/main)"

section "Tests (every server, the gateway and the suite-wide guards)"
npx vitest run >/dev/null 2>&1; check $? "npx vitest run"

section "Coverage floors"
npm run test:coverage >/dev/null 2>&1; check $? "npm run test:coverage"

section "Mock tier (26r1, 25r2)"
if [ "$MOCK" -eq 0 ]; then
  echo "  skipped (--no-mock / --fast)"
elif ! command -v docker >/dev/null 2>&1; then
  echo "  ✗ docker not found: install it, or run with --no-mock"; fail=1
else
  image=$(sed -n 's/^ *BCONNECT_MOCK_IMAGE: *//p' .github/workflows/ci.yml | head -1)
  for release in 26r1 25r2; do
    name="bconnect-mock-ci-local-$release"
    docker rm -f "$name" >/dev/null 2>&1
    # Docker picks a free port on 127.0.0.1: a fixed one may be taken by another mock.
    if docker run -d --rm --name "$name" -p "127.0.0.1::3433" \
        -e BCONNECT_BMS_VERSION="$release" -e RATE_LIMIT_ENABLED=false "$image" >/dev/null 2>&1; then
      address=$(docker port "$name" 3433/tcp | head -1)
      BCONNECT_MOCK_URL="http://$address" node scripts/mock-tier.mjs "$release" >/dev/null 2>&1
      check $? "node scripts/mock-tier.mjs $release ($image)"
      docker stop "$name" >/dev/null 2>&1
    else
      check 1 "start $image for $release"
    fi
  done
fi

section "Dependency audit (reported, not blocking)"
if npm audit --audit-level=high >/dev/null 2>&1; then
  echo "  ✓ npm audit: no high or critical advisories"
else
  echo "  ⚠ npm audit reports high/critical advisories (not blocking): run npm audit"
fi

section "Duplication guard (jscpd, local only; config in .jscpd.json)"
npx --yes jscpd@5.0.11 bconnect-*-mcp/src bconnect-server-template/src >/dev/null 2>&1
check $? "no copy-pasted client/util code"

section "SAST: Semgrep (local only, reported)"
if [ "$SEMGREP" -eq 0 ]; then
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
