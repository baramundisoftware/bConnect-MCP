#!/usr/bin/env node

/**
 * List all endpoints (all types) and their CVE vulnerabilities
 * Uses bConnect API V2.0 (endpoints) and V1.1 (compliance violations)
 */

import { BConnectClient } from '../build/bconnect-client.js';

async function main() {
  console.log('🔍 Querying baramundi Management Suite for all endpoints and vulnerabilities...\n');

  // Initialize client
  if (!process.env.BCONNECT_BASE_URL || !process.env.BCONNECT_USERNAME || !process.env.BCONNECT_PASSWORD) {
    console.error('Required env vars: BCONNECT_BASE_URL, BCONNECT_USERNAME, BCONNECT_PASSWORD');
    process.exit(1);
  }

  const client = new BConnectClient({
    baseUrl: process.env.BCONNECT_BASE_URL,
    username: process.env.BCONNECT_USERNAME,
    password: process.env.BCONNECT_PASSWORD,
    rejectUnauthorized: false
  });

  try {
    // Step 1: Get all endpoints
    console.log('📋 Fetching all endpoints...');
    const allEndpoints = await client.endpoints.getEndpoints({ PageSize: 100 });

    if (!allEndpoints.value || allEndpoints.value.length === 0) {
      console.log('ℹ️  No endpoints found in the system.');
      return;
    }

    console.log(`✅ Found ${allEndpoints.value.length} endpoint(s) total\n`);

    // Filter by OS type
    const windowsEndpoints = allEndpoints.value.filter(e =>
      e.OSVersionString?.toLowerCase().includes('windows')
    );
    const linuxEndpoints = allEndpoints.value.filter(e =>
      e.OSVersionString?.toLowerCase().includes('linux') ||
      e.OSVersionString?.toLowerCase().includes('ubuntu') ||
      e.OSVersionString?.toLowerCase().includes('debian') ||
      e.OSVersionString?.toLowerCase().includes('rhel')
    );
    const macEndpoints = allEndpoints.value.filter(e =>
      e.OSVersionString?.toLowerCase().includes('mac')
    );

    console.log(`   🪟 Windows: ${windowsEndpoints.length}`);
    console.log(`   🐧 Linux: ${linuxEndpoints.length}`);
    console.log(`   🍎 Mac: ${macEndpoints.length}`);
    console.log(`   📱 Other: ${allEndpoints.value.length - windowsEndpoints.length - linuxEndpoints.length - macEndpoints.length}`);

    console.log('\n═'.repeat(100));

    // Step 2: For each endpoint, get compliance violations (CVE vulnerabilities)
    for (const endpoint of allEndpoints.value) {
      const isLinux = linuxEndpoints.includes(endpoint);
      const emoji = isLinux ? '🐧' :
                    windowsEndpoints.includes(endpoint) ? '🪟' :
                    macEndpoints.includes(endpoint) ? '🍎' : '📱';

      console.log(`\n${emoji} Endpoint: ${endpoint.DisplayName || 'N/A'}`);
      console.log('─'.repeat(100));
      console.log(`   ID: ${endpoint.GuidString}`);
      console.log(`   Hostname: ${endpoint.HostName || 'N/A'}`);
      console.log(`   IP Address: ${endpoint.PrimaryIPAddress || 'N/A'}`);
      console.log(`   OS: ${endpoint.OSVersionString || 'N/A'}`);
      console.log(`   Type: ${endpoint.Type || 'N/A'}`);
      console.log(`   Last Seen: ${endpoint.LastInventory || 'N/A'}`);
      console.log(`   Agent Version: ${endpoint.AgentVersionString || 'N/A'}`);

      // Get vulnerabilities for this endpoint
      try {
        console.log(`\n   🔐 Checking for CVE vulnerabilities...`);
        const violations = await client.complianceViolationsV1.getComplianceViolationsByEndpoint(
          endpoint.GuidString
        );

        if (!violations || violations.length === 0) {
          console.log(`   ✅ No CVE vulnerabilities found (endpoint is compliant)`);
        } else {
          console.log(`   ⚠️  Found ${violations.length} CVE vulnerability/vulnerabilities:\n`);

          // Display all violations
          violations.forEach((v, idx) => {
            console.log(`      ${idx + 1}. Violation ID: ${v.ViolationId || 'Unknown'}`);
            console.log(`         Type: ${v.ViolationType || 'N/A'}`);
            console.log(`         Description: ${v.Description || 'N/A'}`);
            console.log(`         Severity: ${v.Severity || 'N/A'}`);
            console.log(`         Detected: ${v.DetectedDate || 'N/A'}`);
            if (v.CVEId) console.log(`         CVE ID: ${v.CVEId}`);
            if (v.AffectedSoftware) console.log(`         Affected: ${v.AffectedSoftware}`);
            console.log('');
          });
        }
      } catch (error) {
        if (error.response?.status === 404) {
          console.log(`   ℹ️  ComplianceViolations endpoint not available or no data`);
        } else {
          console.log(`   ❌ Error fetching vulnerabilities: ${error.message}`);
        }
      }

      console.log('─'.repeat(100));
    }

    console.log('\n═'.repeat(100));
    console.log(`\n✅ Scan complete. Analyzed ${allEndpoints.value.length} endpoint(s).`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.status, error.response.statusText);
      if (error.response.data) {
        console.error('Details:', JSON.stringify(error.response.data, null, 2));
      }
    }
    process.exit(1);
  }
}

main();
