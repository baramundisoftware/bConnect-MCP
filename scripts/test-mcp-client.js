#!/usr/bin/env node

/**
 * Test MCP Client - Demonstrates using the bConnect MCP Server
 * This script acts as an MCP client and communicates with the server
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

// Start the MCP server
console.log('🚀 Starting bConnect MCP Server...\n');

const server = spawn('node', ['build/index.js'], {
  cwd: '/workspaces/claudinno/bConnect-MCP',
  env: {
    ...process.env,
    BCONNECT_BASE_URL: 'https://bms-win22srv:444/bconnect',
    BCONNECT_USERNAME: 'Administrator',
    BCONNECT_PASSWORD: 'baramundi-2008',
    NODE_TLS_REJECT_UNAUTHORIZED: '0'
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 1;

// Helper to send MCP request
function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    });

    let responseData = '';

    // Listen for response
    const responseHandler = (data) => {
      responseData += data.toString();
      try {
        const lines = responseData.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          if (response.id === id) {
            server.stdout.off('data', responseHandler);
            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result);
            }
          }
        }
      } catch (e) {
        // Not complete yet, wait for more data
      }
    };

    server.stdout.on('data', responseHandler);

    // Send request
    server.stdin.write(request + '\n');

    // Timeout after 10 seconds
    setTimeout(() => {
      server.stdout.off('data', responseHandler);
      reject(new Error('Request timeout'));
    }, 10000);
  });
}

// Main function
async function main() {
  try {
    // Wait a moment for server to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('📋 Listing Linux endpoints...\n');

    // List tools to verify connection
    const tools = await sendRequest('tools/list');
    console.log(`✅ Connected! Found ${tools.tools.length} MCP tools available.\n`);

    // Call list_linux_endpoints
    const linuxEndpointsResult = await sendRequest('tools/call', {
      name: 'list_linux_endpoints',
      arguments: { PageSize: 100 }
    });

    const linuxEndpointsText = linuxEndpointsResult.content[0].text;
    console.log('📄 Raw MCP response:', linuxEndpointsText.substring(0, 500), '...\n');

    const linuxEndpoints = JSON.parse(linuxEndpointsText);

    // Handle different response formats
    const endpointsList = linuxEndpoints.value || linuxEndpoints.data || linuxEndpoints;

    if (!endpointsList || endpointsList.length === 0) {
      console.log('ℹ️  No Linux endpoints found.\n');
      server.kill();
      process.exit(0);
    }

    console.log(`🐧 Found ${endpointsList.length} Linux endpoint(s):\n`);
    console.log('═'.repeat(100));

    // For each Linux endpoint, get vulnerabilities
    for (const endpoint of endpointsList) {
      console.log(`\n🐧 ${endpoint.DisplayName || endpoint.displayName || 'Unknown'}`);
      console.log('─'.repeat(100));
      console.log(`   ID: ${endpoint.GuidString || endpoint.id}`);
      console.log(`   IP: ${endpoint.PrimaryIPAddress || endpoint.primaryIP || 'N/A'}`);
      console.log(`   SSH: ${endpoint.SSHConfiguration?.SSHVersion || endpoint.sshConfiguration?.sshVersion || 'N/A'}`);
      console.log(`   Last Seen: ${endpoint.LastInventory || endpoint.lastSeen || 'N/A'}`);

      // Get vulnerabilities
      try {
        console.log(`\n   🔐 Checking CVE vulnerabilities...`);

        const violationsResult = await sendRequest('tools/call', {
          name: 'list_compliance_violations_by_endpoint_v1',
          arguments: { endpointId: endpoint.GuidString || endpoint.id }
        });

        const violationsText = violationsResult.content[0].text;
        const violations = JSON.parse(violationsText);

        if (!violations || violations.length === 0) {
          console.log(`   ✅ No CVE vulnerabilities found (endpoint is compliant)`);
        } else {
          console.log(`   ⚠️  Found ${violations.length} vulnerability/vulnerabilities:\n`);

          violations.forEach((v, idx) => {
            const emoji = {
              'Critical': '🔴',
              'High': '🟠',
              'Medium': '🟡',
              'Low': '🟢'
            }[v.Severity] || '⚪';

            console.log(`      ${emoji} ${idx + 1}. ${v.Name || 'Unknown CVE'}`);
            console.log(`         Severity: ${v.Severity || 'N/A'} (CVSS: ${v.CvssScore || 'N/A'})`);
            console.log(`         Products: ${v.Products || 'N/A'}`);
            const desc = v.Description || 'No description';
            console.log(`         Description: ${desc.substring(0, 150)}${desc.length > 150 ? '...' : ''}`);
            console.log('');
          });
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }

      console.log('─'.repeat(100));
    }

    console.log('\n═'.repeat(100));
    console.log(`\n✅ MCP Server test complete! Analyzed ${endpointsList.length} Linux endpoint(s).\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    server.kill();
    process.exit(0);
  }
}

// Handle server stderr
server.stderr.on('data', (data) => {
  // Suppress server initialization messages
});

// Handle server exit
server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`\n❌ MCP Server exited with code ${code}`);
  }
});

main();
