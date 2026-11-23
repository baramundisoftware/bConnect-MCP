/**
 * The endpoint update tools offer exactly the fields their route's PATCH example declares (#328).
 *
 * Each PATCH route of the endpoints spec has an example listing "all modifiable properties". Per
 * release and per update route the release has (src/tool-releases.ts), the patch paths the tool
 * offers (src/update-fields.ts) must equal the example's paths: nothing missing (nested paths
 * included), nothing the example doesn't declare. Read from the bundled specs, not copied.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';
import { RELEASES } from './lib/spec.js';
import { TOOL_OPERATIONS } from '../bconnect-endpoints-mcp/src/operations.js';
import { TOOL_RELEASES } from '../bconnect-endpoints-mcp/src/tool-releases.js';
import { UPDATE_FIELDS, updateFieldsFor } from '../bconnect-endpoints-mcp/src/update-fields.js';

interface Operation { operationId?: string; requestBody?: { content?: Record<string, { example?: Array<{ path?: string }> }> } }

/** operationId → the PATCH example's paths, per release. */
function examplePaths(release: string): Map<string, string[]> {
  const spec = JSON.parse(readFileSync(join(ROOT, 'openapi-specs', release, 'bConnect_Endpoints.json'), 'utf8')) as { paths: Record<string, Record<string, Operation>> };
  const out = new Map<string, string[]>();
  for (const methods of Object.values(spec.paths)) {
    const op = methods.patch;
    if (!op?.operationId) {continue;}
    const example = Object.values(op.requestBody?.content ?? {})[0]?.example ?? [];
    out.set(op.operationId, [...new Set(example.map((e) => e.path ?? ''))].sort());
  }
  return out;
}

const ROUTES = Object.keys(UPDATE_FIELDS).filter((key) => key.startsWith('update_endpoint[') || key === 'update_logical_group');

describe.each(RELEASES)('bMS %s', (release) => {
  const examples = examplePaths(release);
  const routes = ROUTES.filter((key) => (TOOL_RELEASES[key] ?? []).includes(release));

  it('checks every endpoint update route the release has (not vacuous)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(release === '25R2' ? 8 : 7);
  });

  it.each(routes)('%s offers exactly the paths of its PATCH example', (key) => {
    const [operationId] = TOOL_OPERATIONS[key];
    const example = examples.get(operationId);
    expect(example, `${operationId} has no PATCH example in ${release}`).toBeDefined();
    const offered = Object.values(updateFieldsFor(key, release)).map((f) => f.path).sort();
    expect(offered).toEqual(example);
  });
});

it('Android and iOS no longer offer serialNumber, which no example declares', () => {
  for (const release of RELEASES) {
    expect(Object.keys(updateFieldsFor('update_endpoint[type=AndroidEndpoint]', release))).not.toContain('serialNumber');
  }
});
