#!/usr/bin/env bash
#
# Local CI — the RICHER gate, run by hand. Build + test all workspaces +
# gateway, jscpd, lint, coverage, audit, semgrep.
#
# GitHub Actions now also runs a gate (.github/workflows/ci.yml). The two are
# not copies of each other and neither is redundant:
#
#   this script   everything, including the steps that need something CI does
#                 not have — a docker pull for semgrep, and the opt-in
#                 mock-integration tier that needs a live bConnect-Mock.
#   the workflow  build, the root `vitest run` (which covers every per-server
#                 suite and every suite-wide guard), and the coverage floors —
#                 on Linux AND Windows, which is the leg that would have caught
#                 the CRLF defect this repo actually shipped.
#
# The workflow deliberately does not restate the per-server loop below, so
# there is no second list here to drift out of step with.
#
#   npm run ci            # full run
#   npm run ci -- --fast  # skip the semgrep SAST step (no docker pull)
#
# WHAT THIS GATE DOES AND DOES NOT PROVE (QA-1/EVAL-2026-08-02.md):
# the per-server `vitest run` step below and the suite-wide __tests__/ run
# only ever issue MCP `tools/list` requests — they check tool registration,
# naming collisions and schema shape. They never issue `tools/call`, so a
# registered tool whose handler is broken, throws on valid input, or returns
# wrong data still passes this gate 100%. The only tests that actually
# instantiate a BConnectClient and call through module logic (jobs.ts,
# exposure.ts, diagnose-job.ts, etc.) are the opt-in mock-integration tier
# below, and it only runs when BCONNECT_MOCK_URL points at a live
# bConnect-Mock instance. If that section prints SKIPPED, this run validated
# wiring only, not behavior — do not read a green summary as "tools work".
#
# Exit non-zero if build, tests, coverage, or the duplication guard fail.
# Lint is BLOCKING on errors; warnings are ratcheted (see the lint section).
# Audit and semgrep are reported but non-blocking.

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

section "Suite-wide tests (__tests__/ — cross-server invariants)"
# Per-server suites cannot catch "12 of 13 were fixed". These can: tool-name
# collisions (D23) and client lifetime / subsystem wiring (R3, B11, D21).
npx vitest run --dir __tests__ >/dev/null 2>&1; check $? "suite-wide tests"

section "Coverage ratchet (per-workspace floor, see vitest.config.ts in each)"
# QA-2: every server's vitest.config.ts used to declare a 60% threshold that
# nothing ever enforced (test:coverage was never wired into this script), so
# actual coverage had silently drifted to single digits in some servers
# while the file claimed 60%. Each server's vitest.config.ts now pins
# `thresholds` to that server's measured floor instead, so this step is a
# real, currently-passing gate: it fails if coverage regresses below the
# floor, not against a number nobody could hit. Raise a server's floor in
# its own vitest.config.ts after adding tests that justify it — the 60%
# target returns as the honest default once QA-1's mock tier is wired in,
# since that's where the module logic under test actually lives.
#
# The list is spelled out rather than globbed, and the condition is the config
# file rather than a package.json script. `bconnect-*-mcp` matches the 13
# servers and nothing else — `bconnect-mcp-gateway` ends in `-gateway` and
# `packages/mcp-core` is not at the root — so the two workspaces where a
# regression costs most (the only socket listener, and the kernel all 13
# servers link against) were ratcheting nothing. Gating on `"test:coverage"`
# would have re-excluded mcp-core, which declares only a build script; the
# presence of a vitest.config.ts is the fact that actually decides whether
# there is a floor to enforce. `__tests__/suite-coverage-floors.test.ts` fails
# if this list stops covering every workspace that pins one.
for d in bconnect-*-mcp bconnect-mcp-gateway packages/mcp-core; do
  [ -f "$d/vitest.config.ts" ] || continue
  ( cd "$d" && npx vitest run --coverage >/dev/null 2>&1 ); check $? "$d coverage floor"
done

section "Mock-integration tests (opt-in tier — set BCONNECT_MOCK_URL to enable)"
# QA-1: this is the only tier that calls through real client/module logic
# instead of just tool registration. It is off by default because it needs
# a live bConnect-Mock instance; when it's off, say so loudly instead of
# reporting a quiet green that could be misread as "logic verified".
if [ -n "${BCONNECT_MOCK_URL:-}" ]; then
  mock_reachable=0
  if command -v curl >/dev/null 2>&1; then
    curl -sf --max-time 5 "${BCONNECT_MOCK_URL%/}/health" >/dev/null 2>&1 && mock_reachable=1
  fi
  if [ "$mock_reachable" -ne 1 ]; then
    echo "  ✗ BCONNECT_MOCK_URL=${BCONNECT_MOCK_URL} is set but ${BCONNECT_MOCK_URL%/}/health did not respond"
    fail=1
  else
    for d in bconnect-*-mcp; do
      [ -d "$d" ] || continue
      if grep -q '"test:mock"' "$d/package.json" 2>/dev/null; then
        ( cd "$d" && npx vitest run -c vitest.mock.config.ts >/dev/null 2>&1 ); check $? "$d test:mock"
      fi
    done
  fi
else
  printf '\n\033[1;33m  \xE2\x9A\xA0 SKIPPED\033[0m — BCONNECT_MOCK_URL is not set, so mock-integration tests did not run.\n'
  printf '    This means the tests that call real client/module logic did NOT run in this pass.\n'
  printf '    Set BCONNECT_MOCK_URL to a live bConnect-Mock instance to run them. See QA-1/EVAL-2026-08-02.md.\n'
fi

section "Build + test gateway (non-workspace)"
( cd bconnect-mcp-gateway && npx tsc >/dev/null 2>&1 ); check $? "gateway build"
( cd bconnect-mcp-gateway && npx vitest run --passWithNoTests >/dev/null 2>&1 ); check $? "gateway test"

section "Typecheck TESTS (tsconfig.typecheck.json — BLOCKING)"
# The build configs exclude src/__tests__/** so tests never land in build/, and
# eslint runs without `project`, so there was no type-aware checking anywhere.
# Net effect: NO test in this repo was type-checked. Found the hard way — a
# required field added to ExposureAnalysis left a hand-built fixture yielding
# `undefined` and every gate stayed green. First run of this project surfaced
# 494 errors across 37 files, including two mock tests reading a field the API
# does not return (`.id` where the row carries `assetId` / `endpointId`).
#
# Blocking from the start, because it is at zero now and the whole point is
# that a contract change to a shared interface cannot pass unnoticed again.
npx tsc -p tsconfig.typecheck.json; check $? "typecheck (tests included)"

section "Lint (eslint.config.cjs — BLOCKING)"
# QA-5 is closed. Lint was configured and wired into nothing, then wired in
# non-blocking so that flipping it would not red the gate for every territory
# over a pre-existing backlog. That backlog is now zero ERRORS.
#
# Two decisions worth keeping straight:
#   - Errors block. 0 today.
#   - Warnings are RATCHETED, not blocking: `--max-warnings 48` in the lint
#     script is the current count of explicit-function-return-type. It cannot
#     grow, and lowering the number is how it gets driven down. Same shape as
#     the per-server coverage floors, and for the same reason: a bar nothing
#     can fail is not a bar, and a bar everything fails gets switched off.
#
# What made this affordable was not effort. 33 of the 139 problems were eqeqeq
# firing on `x == null`, which is the correct idiom — one config line, not 33
# edits — and 72 were `curly`, which --fix handles.
npm run lint --silent; check $? "lint (0 errors, warnings ratcheted)"

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
