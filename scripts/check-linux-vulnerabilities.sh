#!/bin/bash

# Check compliance violations for all Linux endpoints

echo "🐧 Linux Endpoint Vulnerability Report"
echo "========================================"
echo ""

BASE_URL="${BCONNECT_BASE_URL:?Set BCONNECT_BASE_URL (e.g. https://host:443)}"
AUTH="${BCONNECT_USERNAME:?Set BCONNECT_USERNAME}:${BCONNECT_PASSWORD:?Set BCONNECT_PASSWORD}"

# Array of Linux endpoint IDs and names
# Replace with your own endpoint GUIDs and hostnames from bMS
declare -A ENDPOINTS=(
    ["00000000-0000-0000-0000-000000000001"]="linux-server-01.example.com"
    ["00000000-0000-0000-0000-000000000002"]="ubuntu-desktop-01.example.com"
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
