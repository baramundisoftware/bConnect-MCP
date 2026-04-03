#!/usr/bin/env node

/**
 * List all Linux endpoints and their CVE vulnerabilities
 * Uses bConnect API V2.0 (endpoints) and V1.1 (compliance violations)
 */

import { BConnectClient } from '../build/bconnect-client.js';

async function main() {
  console.log('🔍 Querying baramundi Management Suite for Linux endpoints and vulnerabilities...\n');

  // Initialize client
  const client = new BConnectClient({
    baseUrl: process.env.BCONNECT_BASE_URL || 'https://bms-win22srv:444/bconnect',
    username: process.env.BCONNECT_USERNAME || 'Administrator',
    password: process.env.BCONNECT_PASSWORD || 'baramundi-2008',
    rejectUnauthorized: false
  });

  try {
    // Step 1: Get all Linux endpoints
    console.log('📋 Fetching Linux endpoints...');
    const linuxEndpoints = await client.endpoints.getLinuxEndpoints({ PageSize: 100 });

    if (!linuxEndpoints.value || linuxEndpoints.value.length === 0) {
      console.log('ℹ️  No Linux endpoints found in the system.');
      return;
    }

    console.log(`✅ Found ${linuxEndpoints.value.length} Linux endpoint(s)\n`);
    console.log('═'.repeat(100));

    // Step 2: For each Linux endpoint, get compliance violations (CVE vulnerabilities)
    for (const endpoint of linuxEndpoints.value) {
      console.log(`\n🐧 Linux Endpoint: ${endpoint.DisplayName || 'N/A'}`);
      console.log('─'.repeat(100));
      console.log(`   ID: ${endpoint.GuidString}`);
      console.log(`   Hostname: ${endpoint.HostName || 'N/A'}`);
      console.log(`   IP Address: ${endpoint.PrimaryIPAddress || 'N/A'}`);
      console.log(`   OS: ${endpoint.OSVersionString || 'N/A'}`);
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

          // Group by severity if available
          const critical = violations.filter(v => v.Severity === 'Critical');
          const high = violations.filter(v => v.Severity === 'High');
          const medium = violations.filter(v => v.Severity === 'Medium');
          const low = violations.filter(v => v.Severity === 'Low');

          if (critical.length > 0) {
            console.log(`      🔴 CRITICAL (${critical.length}):`);
            critical.forEach(v => {
              console.log(`         • ${v.ViolationType || 'CVE'}: ${v.Description || v.ViolationId || 'Unknown'}`);
            });
          }

          if (high.length > 0) {
            console.log(`      🟠 HIGH (${high.length}):`);
            high.forEach(v => {
              console.log(`         • ${v.ViolationType || 'CVE'}: ${v.Description || v.ViolationId || 'Unknown'}`);
            });
          }

          if (medium.length > 0) {
            console.log(`      🟡 MEDIUM (${medium.length}):`);
            medium.forEach(v => {
              console.log(`         • ${v.ViolationType || 'CVE'}: ${v.Description || v.ViolationId || 'Unknown'}`);
            });
          }

          if (low.length > 0) {
            console.log(`      🟢 LOW (${low.length}):`);
            low.forEach(v => {
              console.log(`         • ${v.ViolationType || 'CVE'}: ${v.Description || v.ViolationId || 'Unknown'}`);
            });
          }

          // Show details if no severity grouping worked
          if (critical.length === 0 && high.length === 0 && medium.length === 0 && low.length === 0) {
            violations.forEach((v, idx) => {
              console.log(`      ${idx + 1}. ${JSON.stringify(v, null, 2)}`);
            });
          }
        }
      } catch (error) {
        console.log(`   ❌ Error fetching vulnerabilities: ${error.message}`);
      }

      console.log('\n' + '─'.repeat(100));
    }

    console.log('\n═'.repeat(100));
    console.log(`\n✅ Scan complete. Analyzed ${linuxEndpoints.value.length} Linux endpoint(s).`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.status, error.response.statusText);
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
