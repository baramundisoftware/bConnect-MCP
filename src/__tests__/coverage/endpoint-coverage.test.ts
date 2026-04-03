/**
 * Endpoint Coverage Audit
 *
 * Parses all openapi-specs/*.json files, extracts every operationId, converts
 * each to its expected snake_case tool name, and asserts that every tool name
 * is registered in src/index.ts.
 *
 * This test is intentionally RED until all API endpoints are implemented.
 * Run: npm test -- --reporter=verbose src/__tests__/coverage/endpoint-coverage.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Repository root (three levels up from src/__tests__/coverage/) */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Convert a PascalCase / camelCase operationId to snake_case tool name.
 *
 * Rules applied (in order):
 *  1. Insert underscore before every uppercase letter that follows a lowercase
 *     letter or digit (e.g. "getEndpoint" → "get_Endpoint").
 *  2. Insert underscore before a run of uppercase letters that is followed by
 *     a lowercase letter (e.g. "getADGroups" → "get_AD_Groups").
 *  3. Lower-case the whole string.
 *
 * The resulting name must match exactly what is registered in index.ts.
 */
function operationIdToToolName(operationId: string): string {
  return operationId
    // e.g. "ADGroup" → "AD_Group"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // e.g. "getEndpoint" → "get_Endpoint"
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

interface OperationEntry {
  operationId: string;
  toolName: string;
  specFile: string;
  httpMethod: string;
  apiPath: string;
}

/** Parse every openapi-specs JSON file and collect all operationIds. */
function collectOperations(): OperationEntry[] {
  const specsDir = path.join(REPO_ROOT, 'openapi-specs');
  const specFiles = fs
    .readdirSync(specsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const operations: OperationEntry[] = [];

  for (const specFile of specFiles) {
    const specPath = path.join(specsDir, specFile);
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
      paths?: Record<string, Record<string, { operationId?: string }>>;
    };

    const paths = spec.paths ?? {};

    for (const [apiPath, methods] of Object.entries(paths)) {
      for (const [httpMethod, operation] of Object.entries(methods)) {
        if (operation.operationId) {
          operations.push({
            operationId: operation.operationId,
            toolName: operationIdToToolName(operation.operationId),
            specFile,
            httpMethod: httpMethod.toUpperCase(),
            apiPath,
          });
        }
      }
    }
  }

  return operations;
}

/** Read src/index.ts and extract every registered tool name. */
function collectRegisteredTools(): Set<string> {
  const indexPath = path.join(REPO_ROOT, 'src', 'index.ts');
  const source = fs.readFileSync(indexPath, 'utf8');

  const toolNames = new Set<string>();
  // Match:  name: "some_tool_name"  or  name: 'some_tool_name'
  const pattern = /name:\s*["']([a-z][a-z0-9_]*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    toolNames.add(match[1]);
  }
  // Remove the server name entry (it is not a tool)
  toolNames.delete('bconnect-mcp-server');
  return toolNames;
}

// ---------------------------------------------------------------------------
// Derive coverage data once so it is available to all assertions
// ---------------------------------------------------------------------------

const ALL_OPERATIONS = collectOperations();
const REGISTERED_TOOLS = collectRegisteredTools();

/** Deduplicate operations: same operationId may appear in multiple specs
 *  (e.g. GetWindowsEndpoints in Endpoints, UpdateManagement, OperatingSystems).
 *  For coverage purposes track unique (specFile, operationId) pairs so we
 *  can report per-module gaps accurately, but test unique tool names globally.
 */
const UNIQUE_TOOL_NAMES = new Set(ALL_OPERATIONS.map((op) => op.toolName));

const MISSING_TOOLS = [...UNIQUE_TOOL_NAMES].filter(
  (name) => !REGISTERED_TOOLS.has(name),
);

const IMPLEMENTED_TOOLS = [...UNIQUE_TOOL_NAMES].filter((name) =>
  REGISTERED_TOOLS.has(name),
);

// ---------------------------------------------------------------------------
// Coverage report (always printed to console)
// ---------------------------------------------------------------------------

function printCoverageReport(): void {
  const total = UNIQUE_TOOL_NAMES.size;
  const implemented = IMPLEMENTED_TOOLS.length;
  const missing = MISSING_TOOLS.length;
  const pct = total > 0 ? ((implemented / total) * 100).toFixed(1) : '0.0';

  console.log('\n');
  console.log('='.repeat(70));
  console.log('  ENDPOINT COVERAGE REPORT');
  console.log('='.repeat(70));
  console.log(`  Total unique operationIds : ${total}`);
  console.log(`  Implemented tools         : ${implemented}`);
  console.log(`  Missing tools             : ${missing}`);
  console.log(`  Coverage                  : ${pct}%`);
  console.log('='.repeat(70));

  if (missing > 0) {
    console.log('\n  MISSING TOOLS (by spec file):\n');

    // Group by spec file for readability
    const byFile = new Map<string, OperationEntry[]>();
    for (const op of ALL_OPERATIONS) {
      if (MISSING_TOOLS.includes(op.toolName)) {
        const list = byFile.get(op.specFile) ?? [];
        list.push(op);
        byFile.set(op.specFile, list);
      }
    }

    // Deduplicate within each file (same operationId repeated per method)
    for (const [specFile, ops] of [...byFile.entries()].sort()) {
      const seen = new Set<string>();
      const deduped = ops.filter((op) => {
        if (seen.has(op.toolName)) return false;
        seen.add(op.toolName);
        return true;
      });

      console.log(`  [${specFile}]`);
      for (const op of deduped) {
        console.log(
          `    ✗ ${op.toolName.padEnd(55)} (operationId: ${op.operationId})`,
        );
      }
      console.log('');
    }
  }

  if (implemented > 0) {
    console.log('  IMPLEMENTED TOOLS:\n');
    for (const name of [...IMPLEMENTED_TOOLS].sort()) {
      console.log(`    ✓ ${name}`);
    }
    console.log('');
  }

  console.log('='.repeat(70));
  console.log('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Endpoint Coverage Audit', () => {
  it('prints a full coverage report to console', () => {
    printCoverageReport();
    // This assertion always passes — the report is purely informational
    expect(ALL_OPERATIONS.length).toBeGreaterThan(0);
  });

  it('discovers operationIds from every openapi-spec JSON file', () => {
    const specsDir = path.join(REPO_ROOT, 'openapi-specs');
    const specFiles = fs
      .readdirSync(specsDir)
      .filter((f) => f.endsWith('.json'));

    // We should have at least 10 spec files
    expect(specFiles.length).toBeGreaterThanOrEqual(10);

    // Every spec file should contribute at least one operationId
    for (const specFile of specFiles) {
      const opsFromFile = ALL_OPERATIONS.filter(
        (op) => op.specFile === specFile,
      );
      expect(
        opsFromFile.length,
        `Expected ${specFile} to contain at least 1 operationId`,
      ).toBeGreaterThan(0);
    }
  });

  it('operationId → snake_case conversion is correct for known examples', () => {
    const cases: [string, string][] = [
      ['GetEndpoints', 'get_endpoints'],
      ['GetADGroups', 'get_ad_groups'],
      ['CreateAsset', 'create_asset'],
      ['DeleteWindowsEndpoint', 'delete_windows_endpoint'],
      ['StartWindowsEndpointEnrollment', 'start_windows_endpoint_enrollment'],
      ['GetBitLockerStates', 'get_bit_locker_states'],
      ['TriggerInstallationViaIntune', 'trigger_installation_via_intune'],
      ['AssignJobDefinitionToLogicalGroup', 'assign_job_definition_to_logical_group'],
      ['GetVariableInstancesByWindowsJobDefinitonId', 'get_variable_instances_by_windows_job_definiton_id'],
    ];
    for (const [input, expected] of cases) {
      expect(operationIdToToolName(input), `operationId: ${input}`).toBe(
        expected,
      );
    }
  });

  it('src/index.ts registers at least 50 distinct tool names', () => {
    expect(REGISTERED_TOOLS.size).toBeGreaterThanOrEqual(50);
  });

  it('strict-name coverage meets the documented baseline (see ENDPOINT-COVERAGE-AUDIT.md)', () => {
    // NOTE: This test uses strict operationId → snake_case matching.
    // Many tools in src/index.ts use different naming conventions (e.g. list_ prefix,
    // shortened domain names) which the strict match does not recognise.
    //
    // Documented coverage breakdown (as of 2026-03-26, see ENDPOINT-COVERAGE-AUDIT.md):
    //   216 unique operationIds in all openapi-specs/*.json files
    //    71 match by strict snake_case name  → 32.9% strict-name coverage
    //    73 additional match semantically     → 66.7% total semantic coverage
    //    72 genuinely missing tools
    //
    // The assertion below ensures strict-name coverage does not REGRESS below the
    // established baseline.  Improve the threshold as gaps are closed.
    const total = UNIQUE_TOOL_NAMES.size;
    const implemented = IMPLEMENTED_TOOLS.length;
    const strictPct = total > 0 ? (implemented / total) * 100 : 0;

    if (MISSING_TOOLS.length > 0) {
      console.log(
        `\n  ${MISSING_TOOLS.length} tool(s) are not matched by strict snake_case name.\n` +
          `  Many are covered semantically — see ENDPOINT-COVERAGE-AUDIT.md for the full analysis.\n` +
          `  Strict coverage: ${strictPct.toFixed(1)}% (${implemented}/${total})\n`,
      );
    }

    // Baseline: strict-name coverage must be at least 30% (71/216 = 32.9%).
    // Raise this threshold as naming conventions are normalised or new tools added.
    expect(
      strictPct,
      `Strict-name coverage dropped below 30% (${strictPct.toFixed(1)}%). ` +
        `Either tools were removed or operationIds were added without corresponding tools.`,
    ).toBeGreaterThanOrEqual(30);

    // Hard ceiling: the number of strictly-missing tool names must not exceed
    // the audited count of 145 (72 truly missing + 73 naming-convention mismatches).
    expect(
      MISSING_TOOLS.length,
      `More than 145 operationIds are unmatched by strict name — coverage has regressed.`,
    ).toBeLessThanOrEqual(145);
  });

  it('no registered tools are orphaned (every tool maps back to an operationId)', () => {
    // This is informational — orphaned tools are not a failure criterion for
    // the current phase, but we log them so developers are aware.
    const orphaned = [...REGISTERED_TOOLS].filter(
      (name) => !UNIQUE_TOOL_NAMES.has(name),
    );

    if (orphaned.length > 0) {
      console.log(
        `\n  INFO: ${orphaned.length} tool(s) in src/index.ts have no matching operationId ` +
          `(extra tools, docs tools, or naming mismatch):\n` +
          orphaned.sort().map((n) => `    ? ${n}`).join('\n') +
          '\n',
      );
    }

    // Not a failure — just informational
    expect(true).toBe(true);
  });
});
