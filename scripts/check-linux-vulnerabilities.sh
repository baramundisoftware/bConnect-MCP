#!/bin/bash

# Check compliance violations for all Linux endpoints

echo "🐧 Linux Endpoint Vulnerability Report"
echo "========================================"
echo ""

BASE_URL="https://bms-win22srv:444"
AUTH="Administrator:baramundi-2008"

# Array of Linux endpoint IDs and names
declare -A ENDPOINTS=(
    ["3389230b-4aa6-46ae-9212-9f194b9f79f7"]="rhela.mshome.net"
    ["5c3f67f0-787a-4cfb-901f-7a1f92ee0a2d"]="ubuntu-22-04-xdr"
    ["9c692f78-d7eb-49b5-9e71-102e5426db67"]="ubuntu-22-04-wazuh"
    ["ccdf7bcb-ae39-4e6b-82fe-14f9939f7111"]="ubuntu-22-04-VM"
    ["fb1178e8-2c7e-42bd-b0ad-a5fa609b2e3e"]="rhel.mshome.net"
)

for endpoint_id in "${!ENDPOINTS[@]}"; do
    endpoint_name="${ENDPOINTS[$endpoint_id]}"

    echo "────────────────────────────────────────────────────────────────────────────────"
    echo "🐧 Linux Endpoint: $endpoint_name"
    echo "   ID: $endpoint_id"
    echo ""

    # Get endpoint details
    endpoint_json=$(curl -s -k -u "$AUTH" "$BASE_URL/bconnect/endpoints/v2.0/LinuxEndpoints/$endpoint_id")

    ip=$(echo "$endpoint_json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('primaryIP', 'N/A'))" 2>/dev/null)
    last_seen=$(echo "$endpoint_json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('lastSeen', 'N/A'))" 2>/dev/null)
    ssh_version=$(echo "$endpoint_json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('sshConfiguration', {}).get('sshVersion', 'N/A'))" 2>/dev/null)

    echo "   IP: $ip"
    echo "   Last Seen: $last_seen"
    echo "   SSH Version: $ssh_version"
    echo ""

    # Get compliance violations
    violations_json=$(curl -s -k -u "$AUTH" "$BASE_URL/bConnect/V1.1/ComplianceViolations?EndpointId=$endpoint_id")

    violation_count=$(echo "$violations_json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data))" 2>/dev/null)

    if [ "$violation_count" = "0" ]; then
        echo "   ✅ No CVE vulnerabilities found (endpoint is compliant)"
    else
        echo "   ⚠️  Found $violation_count CVE vulnerability/vulnerabilities:"
        echo ""

        # Parse and display violations
        echo "$violations_json" | python3 -c "
import sys, json

data = json.load(sys.stdin)
for idx, v in enumerate(data, 1):
    severity = v.get('Severity', 'Unknown')
    emoji = {
        'Critical': '🔴',
        'High': '🟠',
        'Medium': '🟡',
        'Low': '🟢'
    }.get(severity, '⚪')

    print(f\"      {emoji} {idx}. {v.get('Name', 'Unknown CVE')}\")
    print(f\"         Severity: {severity} (CVSS: {v.get('CvssScore', 'N/A')})\")
    print(f\"         Products: {v.get('Products', 'N/A')}\")
    desc = v.get('Description', 'No description')
    if len(desc) > 150:
        desc = desc[:150] + '...'
    print(f\"         Description: {desc}\")
    print()
"
    fi
    echo ""
done

echo "════════════════════════════════════════════════════════════════════════════════"
echo "✅ Scan complete. Analyzed ${#ENDPOINTS[@]} Linux endpoints."
