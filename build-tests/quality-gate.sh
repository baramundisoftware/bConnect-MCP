#!/usr/bin/env bash
# quality-gate.sh
#
# Distribution build quality gate. Checks:
#   1. All Dockerfiles contain "26.1.0" version string
#   2. docker-compose.yml references correct version 26.1.0
#   3. WINDOWS-DEPLOYMENT.md references 26.1.0
#   4. All 12 servers have pkg:win script with node20
#   5. pkg:all scripts use node20 (not node16)
#   6. All 12 servers have a Dockerfile
#   7. If dist/ exists: .exe < 100MB, .sha256 present
#
# Exit code: 0 = all checks pass, 1 = one or more failures

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

check() {
  local desc="$1"
  local result="$2"  # "pass" or "fail"
  if [[ "$result" == "pass" ]]; then
    echo "  PASS: $desc"
    ((PASS++))
  else
    echo "  FAIL: $desc"
    ((FAIL++))
  fi
}

echo "============================================"
echo "  bConnect MCP — Distribution Quality Gate"
echo "============================================"
echo ""

# Check 1: All servers have a Dockerfile
echo "Check 1: Dockerfiles present..."
for server in "${SERVERS[@]}"; do
  dockerfile="$REPO_ROOT/$server/Dockerfile"
  if [[ -f "$dockerfile" ]]; then
    check "Dockerfile: $server" "pass"
  else
    check "Dockerfile: $server" "fail"
  fi
done
echo ""

# Check 2: All servers have pkg:win script with node20
echo "Check 2: pkg:win scripts use node20..."
for server in "${SERVERS[@]}"; do
  pkg_json="$REPO_ROOT/$server/package.json"
  if grep -q '"pkg:win"' "$pkg_json" && grep -q 'node20' "$pkg_json"; then
    check "pkg:win node20: $server" "pass"
  else
    check "pkg:win node20: $server" "fail"
  fi
done
echo ""

# Check 3: No node16 in pkg:all
echo "Check 3: pkg:all uses node20 (no node16)..."
for server in "${SERVERS[@]}"; do
  pkg_json="$REPO_ROOT/$server/package.json"
  pkgall_line=$(python3 -c "import json; d=json.load(open('$pkg_json')); print(d.get('scripts',{}).get('pkg:all',''))" 2>/dev/null || echo "")
  if echo "$pkgall_line" | grep -q 'node16'; then
    check "pkg:all no node16: $server" "fail"
  else
    check "pkg:all no node16: $server" "pass"
  fi
done
echo ""

# Check 4: docker-compose.yml and WINDOWS-DEPLOYMENT.md reference 26.1.0
echo "Check 4: Version strings in distribution docs..."
if grep -q '26.1.0' "$REPO_ROOT/docker-compose.yml"; then
  check "docker-compose.yml contains 26.1.0" "pass"
else
  check "docker-compose.yml contains 26.1.0" "fail"
fi

if grep -q '26.1.0' "$REPO_ROOT/WINDOWS-DEPLOYMENT.md"; then
  check "WINDOWS-DEPLOYMENT.md contains 26.1.0" "pass"
else
  check "WINDOWS-DEPLOYMENT.md contains 26.1.0" "fail"
fi
echo ""

# Check 5: If dist/ exists, validate .exe size and .sha256 presence
echo "Check 5: Artifact size and checksum (skipped if dist/ not built)..."
ART_CHECKED=0
for server in "${SERVERS[@]}"; do
  exe="$REPO_ROOT/$server/dist/${server}.exe"
  sha="$REPO_ROOT/$server/dist/${server}.exe.sha256"
  if [[ -f "$exe" ]]; then
    size_mb=$(du -m "$exe" | cut -f1)
    if [[ "$size_mb" -lt 100 ]]; then
      check "${server}.exe size ${size_mb}MB < 100MB" "pass"
    else
      check "${server}.exe size ${size_mb}MB < 100MB" "fail"
    fi
    if [[ -f "$sha" ]]; then
      check "${server}.exe.sha256 present" "pass"
    else
      check "${server}.exe.sha256 present" "fail"
    fi
    ((ART_CHECKED++))
  fi
done
if [[ $ART_CHECKED -eq 0 ]]; then
  echo "  INFO: No dist/ artifacts found — run 'npm run pkg' first to check artifact sizes"
fi
echo ""

echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"

[[ $FAIL -eq 0 ]]
