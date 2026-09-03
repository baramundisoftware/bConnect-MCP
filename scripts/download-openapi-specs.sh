#!/bin/bash
# Download every bConnect OpenAPI specification from a live bMS into
# openapi-specs/26R1/, then regenerate the TypeScript types from them.
#
# This product is 26R1-only. 25R2 support was withdrawn — several tools depend
# on routes that exist only from 26R1, and a build that half-works against an
# older bMS publishes inaccurate data. There is no longer a 25R2 spec directory
# and no BCONNECT_RELEASE switch; pointing this script at an older server will
# fetch specs that are missing routes the suite requires.
#
#   BCONNECT_BASE_URL=https://host:443/bconnect \
#   BCONNECT_USERNAME=... BCONNECT_PASSWORD=... \
#   bash scripts/download-openapi-specs.sh
#
# It finishes by running `npm run generate`, so the specs and the checked-in
# types can never be one refresh apart.

set -euo pipefail

BCONNECT_URL="${BCONNECT_BASE_URL:?Set BCONNECT_BASE_URL (e.g. https://host:443/bconnect)}"
BCONNECT_USER="${BCONNECT_USERNAME:?Set BCONNECT_USERNAME}"
BCONNECT_PASS="${BCONNECT_PASSWORD:?Set BCONNECT_PASSWORD}"

RELEASE="26R1"
SPECS_DIR="openapi-specs/$RELEASE"

echo "Downloading bConnect OpenAPI specifications ($RELEASE)..."
echo "Server: $BCONNECT_URL"
echo ""

mkdir -p "$SPECS_DIR"

# module URL segment : file name under openapi-specs/26R1/ : 25R2 legacy name
#
# All twelve modules the suite generates types from. `compliance` and
# `universaldynamicgroups` were absent from this list, which is one reason their
# specs were only ever fetched by hand — and why the types generated from them
# were the two that happened to stay fresh while the other ten drifted.
#
# The saved file name uses 26R1's own capitalisation (`bConnect_Activedirectory`),
# which is what the shipped specs are named and what scripts/generate-types.mjs
# looks for. 25R2 served the CamelCase spelling (`bConnect_ActiveDirectory`), so
# each fetch falls back to that spelling if the first URL 404s and normalises the
# local name either way. That fallback is UNVERIFIED against a live 26R1 bMS
# (this environment has no bConnect credentials); if it ever fires it says so on
# stdout rather than silently writing a differently-named file.
modules=(
  "activedirectory:Activedirectory:ActiveDirectory"
  "assets:Assets:Assets"
  "compliance:Compliance:Compliance"
  "defensecontrol:Defensecontrol:DefenseControl"
  "endpoints:Endpoints:Endpoints"
  "jobs:Jobs:Jobs"
  "operatingsystems:Operatingsystems:OperatingSystems"
  "servermanagement:Servermanagement:ServerManagement"
  "software:Software:Software"
  "universaldynamicgroups:Universaldynamicgroups:UniversalDynamicGroups"
  "updatemanagement:Updatemanagement:UpdateManagement"
  "variables:Variables:Variables"
)

success_count=0
fail_count=0
failed=()

for entry in "${modules[@]}"; do
  IFS=':' read -r module name legacy <<< "$entry"
  output="$SPECS_DIR/bConnect_$name.json"

  echo -n "Downloading $name... "
  if curl -k -u "$BCONNECT_USER:$BCONNECT_PASS" \
       "$BCONNECT_URL/$module/openAPI/v2.0/bConnect_$name.json" -o "$output" -f -s; then
    echo "OK"
    success_count=$((success_count + 1))
  elif curl -k -u "$BCONNECT_USER:$BCONNECT_PASS" \
       "$BCONNECT_URL/$module/openAPI/v2.0/bConnect_$legacy.json" -o "$output" -f -s; then
    echo "OK (server served the legacy name bConnect_$legacy.json; saved as bConnect_$name.json)"
    success_count=$((success_count + 1))
  else
    echo "FAILED"
    rm -f "$output"   # never leave a truncated or empty spec behind
    fail_count=$((fail_count + 1))
    failed+=("$name")
  fi
done

echo ""
echo "Download complete: $success_count succeeded, $fail_count failed"
echo "Specs saved to: $SPECS_DIR/"

if [ "$fail_count" -ne 0 ]; then
  echo ""
  echo "Missing: ${failed[*]}"
  echo "Every module above is required. Regenerating from a partial download"
  echo "would silently drop routes, so no types were regenerated. Fix the"
  echo "failures and re-run."
  exit 1
fi

echo ""
echo "Regenerating TypeScript types (npm run generate)..."
npm run generate
