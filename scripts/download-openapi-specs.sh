#!/bin/bash
# Download all bConnect OpenAPI specifications

set -e

BCONNECT_URL="${BCONNECT_BASE_URL:-https://bms-win22srv:444/bconnect}"
BCONNECT_USER="${BCONNECT_USERNAME:-Administrator}"
BCONNECT_PASS="${BCONNECT_PASSWORD:-baramundi-2008}"
SPECS_DIR="openapi-specs"

echo "Downloading bConnect OpenAPI specifications..."
echo "Server: $BCONNECT_URL"
echo ""

mkdir -p "$SPECS_DIR"

# Define modules with their proper case names
declare -A modules=(
  ["endpoints"]="Endpoints"
  ["jobs"]="Jobs"
  ["assets"]="Assets"
  ["activedirectory"]="ActiveDirectory"
  ["servermanagement"]="ServerManagement"
  ["defensecontrol"]="DefenseControl"
  ["variables"]="Variables"
  ["operatingsystems"]="OperatingSystems"
  ["software"]="Software"
  ["updatemanagement"]="UpdateManagement"
)

success_count=0
fail_count=0

for module in "${!modules[@]}"; do
  filename="${modules[$module]}"
  url="$BCONNECT_URL/$module/openAPI/v2.0/bConnect_$filename.json"
  output="$SPECS_DIR/bConnect_$filename.json"

  echo -n "Downloading $filename... "
  if curl -k -u "$BCONNECT_USER:$BCONNECT_PASS" "$url" -o "$output" -f -s; then
    echo "✓"
    ((success_count++))
  else
    echo "✗ Failed"
    ((fail_count++))
  fi
done

echo ""
echo "Download complete: $success_count succeeded, $fail_count failed"
echo "Specs saved to: $SPECS_DIR/"
