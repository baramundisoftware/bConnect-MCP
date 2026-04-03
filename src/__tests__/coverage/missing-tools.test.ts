/**
 * Missing Tools Coverage Test — RED phase
 *
 * Asserts that the top 10 highest-value missing tools (identified in
 * ENDPOINT-COVERAGE-AUDIT.md) are registered in src/index.ts.
 *
 * This test is intentionally RED until all 10 tools are implemented.
 * Each failing assertion names the missing tool so the developer knows
 * exactly what to implement next.
 *
 * Run:
 *   npm test src/__tests__/coverage/missing-tools.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Repository root — three levels up from src/__tests__/coverage/ */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Helper: extract registered tool names from src/index.ts
//
// Uses the same regex strategy as endpoint-coverage.test.ts:
//   Match  name: "some_tool_name"  or  name: 'some_tool_name'
// ---------------------------------------------------------------------------

function collectRegisteredTools(): Set<string> {
  const indexPath = path.join(REPO_ROOT, 'src', 'index.ts');
  const source = fs.readFileSync(indexPath, 'utf8');

  const toolNames = new Set<string>();
  const pattern = /name:\s*["']([a-z][a-z0-9_]*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    toolNames.add(match[1]);
  }
  // Remove the server identity entry — it is not a tool
  toolNames.delete('bconnect-mcp-server');
  return toolNames;
}

// ---------------------------------------------------------------------------
// Top 10 missing tools from ENDPOINT-COVERAGE-AUDIT.md (HIGH priority)
// ---------------------------------------------------------------------------

/**
 * Each entry documents the tool name to assert and the bConnect operationId
 * it maps to, so developers can look up the API spec quickly.
 */
const TOP_10_MISSING_TOOLS: Array<{ name: string; operationId: string }> = [
  {
    name: 'list_windows_endpoints_by_logical_group',
    operationId: 'GetWindowsEndpointsByLogicalGroupId',
  },
  {
    name: 'list_endpoints_by_logical_group',
    operationId: 'GetEndpointsByLogicalGroupId',
  },
  {
    name: 'list_job_instances_by_definition',
    operationId: 'GetJobInstancesByJobDefinitionId',
  },
  {
    name: 'list_job_instances_by_logical_group',
    operationId: 'GetJobInstancesByLogicalGroupId',
  },
  {
    name: 'list_job_definitions_by_folder',
    operationId: 'GetJobDefinitionsByFolderId',
  },
  {
    name: 'get_linux_endpoint',
    operationId: 'GetLinuxEndpoint',
  },
  {
    name: 'get_mac_endpoint',
    operationId: 'GetMacEndpoint',
  },
  {
    name: 'start_android_enrollment',
    operationId: 'StartAndroidEndpointEnrollment',
  },
  {
    name: 'start_ios_enrollment',
    operationId: 'StartIosEndpointEnrollment',
  },
  {
    name: 'get_ad_object_memberships',
    operationId: 'GetADObjectMemberships',
  },
];

// ---------------------------------------------------------------------------
// Derive the registered-tool set once at module load time
// ---------------------------------------------------------------------------

const REGISTERED_TOOLS = collectRegisteredTools();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Missing Tools — Top 10 HIGH-priority endpoints (RED phase)', () => {
  it('src/index.ts is readable and contains at least one tool', () => {
    expect(REGISTERED_TOOLS.size).toBeGreaterThan(0);
  });

  it('prints a summary of which tools are present and which are absent', () => {
    const present: string[] = [];
    const absent: string[] = [];

    for (const { name } of TOP_10_MISSING_TOOLS) {
      if (REGISTERED_TOOLS.has(name)) {
        present.push(name);
      } else {
        absent.push(name);
      }
    }

    console.log('\n');
    console.log('='.repeat(70));
    console.log('  MISSING TOOLS — TOP 10 HIGH-PRIORITY ENDPOINTS');
    console.log('='.repeat(70));
    console.log(`  Total to implement : ${TOP_10_MISSING_TOOLS.length}`);
    console.log(`  Already present    : ${present.length}`);
    console.log(`  Still missing      : ${absent.length}`);
    console.log('='.repeat(70));

    if (present.length > 0) {
      console.log('\n  IMPLEMENTED (already registered in src/index.ts):');
      for (const name of present) {
        console.log(`    ✓ ${name}`);
      }
    }

    if (absent.length > 0) {
      console.log('\n  NOT YET IMPLEMENTED (must be added to src/index.ts):');
      for (const { name, operationId } of TOP_10_MISSING_TOOLS) {
        if (absent.includes(name)) {
          console.log(`    ✗ ${name.padEnd(50)} (operationId: ${operationId})`);
        }
      }
    }

    console.log('\n' + '='.repeat(70) + '\n');

    // Informational assertion — always passes; individual tool assertions follow
    expect(TOP_10_MISSING_TOOLS.length).toBe(10);
  });

  // Individual assertions — one per missing tool.
  // Each will FAIL until the corresponding tool is registered in src/index.ts.

  it('registers list_windows_endpoints_by_logical_group (GetWindowsEndpointsByLogicalGroupId)', () => {
    expect(
      REGISTERED_TOOLS.has('list_windows_endpoints_by_logical_group'),
      'Tool "list_windows_endpoints_by_logical_group" is not registered in src/index.ts. ' +
        'Implement it to expose GetWindowsEndpointsByLogicalGroupId.',
    ).toBe(true);
  });

  it('registers list_endpoints_by_logical_group (GetEndpointsByLogicalGroupId)', () => {
    expect(
      REGISTERED_TOOLS.has('list_endpoints_by_logical_group'),
      'Tool "list_endpoints_by_logical_group" is not registered in src/index.ts. ' +
        'Implement it to expose GetEndpointsByLogicalGroupId.',
    ).toBe(true);
  });

  it('registers list_job_instances_by_definition (GetJobInstancesByJobDefinitionId)', () => {
    expect(
      REGISTERED_TOOLS.has('list_job_instances_by_definition'),
      'Tool "list_job_instances_by_definition" is not registered in src/index.ts. ' +
        'Implement it to expose GetJobInstancesByJobDefinitionId.',
    ).toBe(true);
  });

  it('registers list_job_instances_by_logical_group (GetJobInstancesByLogicalGroupId)', () => {
    expect(
      REGISTERED_TOOLS.has('list_job_instances_by_logical_group'),
      'Tool "list_job_instances_by_logical_group" is not registered in src/index.ts. ' +
        'Implement it to expose GetJobInstancesByLogicalGroupId.',
    ).toBe(true);
  });

  it('registers list_job_definitions_by_folder (GetJobDefinitionsByFolderId)', () => {
    expect(
      REGISTERED_TOOLS.has('list_job_definitions_by_folder'),
      'Tool "list_job_definitions_by_folder" is not registered in src/index.ts. ' +
        'Implement it to expose GetJobDefinitionsByFolderId.',
    ).toBe(true);
  });

  it('registers get_linux_endpoint (GetLinuxEndpoint)', () => {
    expect(
      REGISTERED_TOOLS.has('get_linux_endpoint'),
      'Tool "get_linux_endpoint" is not registered in src/index.ts. ' +
        'Implement it to expose GetLinuxEndpoint.',
    ).toBe(true);
  });

  it('registers get_mac_endpoint (GetMacEndpoint)', () => {
    expect(
      REGISTERED_TOOLS.has('get_mac_endpoint'),
      'Tool "get_mac_endpoint" is not registered in src/index.ts. ' +
        'Implement it to expose GetMacEndpoint.',
    ).toBe(true);
  });

  it('registers start_android_enrollment (StartAndroidEndpointEnrollment)', () => {
    expect(
      REGISTERED_TOOLS.has('start_android_enrollment'),
      'Tool "start_android_enrollment" is not registered in src/index.ts. ' +
        'Implement it to expose StartAndroidEndpointEnrollment.',
    ).toBe(true);
  });

  it('registers start_ios_enrollment (StartIosEndpointEnrollment)', () => {
    expect(
      REGISTERED_TOOLS.has('start_ios_enrollment'),
      'Tool "start_ios_enrollment" is not registered in src/index.ts. ' +
        'Implement it to expose StartIosEndpointEnrollment.',
    ).toBe(true);
  });

  it('registers get_ad_object_memberships (GetADObjectMemberships)', () => {
    expect(
      REGISTERED_TOOLS.has('get_ad_object_memberships'),
      'Tool "get_ad_object_memberships" is not registered in src/index.ts. ' +
        'Implement it to expose GetADObjectMemberships.',
    ).toBe(true);
  });

  it('all 10 high-priority tools are registered (composite gate assertion)', () => {
    const missingTools = TOP_10_MISSING_TOOLS.filter(
      ({ name }) => !REGISTERED_TOOLS.has(name),
    );

    const missingList = missingTools
      .map(({ name, operationId }) => `  • ${name}  (operationId: ${operationId})`)
      .join('\n');

    expect(
      missingTools.length,
      missingTools.length > 0
        ? `${missingTools.length} of the 10 high-priority tools are not yet registered in ` +
            `src/index.ts:\n${missingList}\n\nAdd each tool to the ListToolsRequestSchema handler.`
        : 'All 10 tools are registered — remove this RED-phase test or convert it to a regression guard.',
    ).toBe(0);
  });
});
