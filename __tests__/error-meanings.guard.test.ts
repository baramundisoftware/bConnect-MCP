/**
 * Error-meanings guard (REQ-XC-001 AC 3, ADR-0008 D3).
 *
 * `ERROR_MEANINGS` in @bconnect/mcp-core is generated from the OpenAPI specs
 * (scripts/generate-error-meanings.mjs) and committed, because the specs aren't
 * shipped with the servers. This guard derives the same table from the specs on
 * its own and fails if the two differ, so the meaning a tool reports for an
 * error can't drift from the API documentation.
 *
 * Rule: every documented error response (status >= 400) of every operation, for
 * both releases, unless its description only repeats the HTTP reason phrase
 * ("Bad Request", "Internal Server Error"). Whitespace is collapsed to one line.
 */
import { STATUS_CODES } from 'node:http';
import { describe, expect, it } from 'vitest';
import * as core from '../packages/mcp-core/src/index.js';
import { RELEASES, type Release, loadOperations, type Schema } from './lib/spec.js';

interface ErrorMeaning {
  releases: readonly Release[];
  method: string;
  domain: string;
  path: string;
  status: number;
  meaning: string;
}

const REGENERATE = 'run `node scripts/generate-error-meanings.mjs` and commit packages/mcp-core/src/error-meanings.ts';

const letters = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** "<release> <METHOD> /<domain><path> <status> <meaning>" for every documented, non-generic error. */
function fromSpecs(): string[] {
  const rows: string[] = [];
  for (const release of RELEASES) {
    for (const op of loadOperations(release)) {
      const responses: Record<string, Schema> = op.spec.paths[op.path][op.method.toLowerCase()].responses;
      for (const [code, response] of Object.entries(responses)) {
        const status = Number(code);
        if (!(status >= 400)) {continue;}
        const meaning = oneLine(String(response.description ?? ''));
        if (meaning === '' || letters(meaning) === letters(STATUS_CODES[status] ?? '')) {continue;}
        rows.push(`${release} ${op.method} /${op.domain}${op.path} ${status} ${meaning}`);
      }
    }
  }
  return rows.sort();
}

function table(): readonly ErrorMeaning[] {
  const value: unknown = Reflect.get(core, 'ERROR_MEANINGS');
  if (!Array.isArray(value)) {throw new Error(`@bconnect/mcp-core exports no ERROR_MEANINGS; ${REGENERATE}`);}
  return value as ErrorMeaning[];
}

describe('error meanings come from the specs', () => {
  it('the derivation finds the documented meanings this design relies on', () => {
    const rows = fromSpecs();
    expect(rows).toContain('26R1 GET /endpoints/v2.0/Endpoints/{id}/MaintenanceWindow 409 The endpoint with the specified ID has no maintenance window.');
    expect(rows).toContain('25R2 GET /endpoints/v2.0/Endpoints/{id}/MaintenanceWindow 409 The endpoint with the specified ID has no maintenance window.');
    expect(rows.some((r) => / 400 Bad Request$| 500 Internal Server Error$/.test(r))).toBe(false);
    expect(rows.filter((r) => / 404 /.test(r)).length).toBeGreaterThan(300); // 185 (26R1) + 166 (25R2)
  });

  it(`ERROR_MEANINGS equals the table derived from openapi-specs/ (else ${REGENERATE})`, () => {
    const actual = table()
      .flatMap((m) => m.releases.map((release) => `${release} ${m.method} /${m.domain}${m.path} ${m.status} ${m.meaning}`))
      .sort();
    const expected = fromSpecs();
    const missing = expected.filter((row) => !actual.includes(row));
    const stale = actual.filter((row) => !expected.includes(row));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
    expect(actual).toEqual(expected); // no duplicates either
  });

  it('each entry is one clean line, keyed by an upper-case method and a spec path template', () => {
    for (const m of table()) {
      expect(m.meaning).toBe(oneLine(m.meaning));
      expect(m.method).toBe(m.method.toUpperCase());
      expect(m.path.startsWith('/v2.0/')).toBe(true);
      expect(m.releases.length).toBeGreaterThan(0);
    }
  });
});
