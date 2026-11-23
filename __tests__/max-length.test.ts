/**
 * Over-long query parameters are refused before the request (#358).
 *
 * The bMS 26R2 spec declares `maxLength` on query parameters (Name, HostName,
 * SearchQuery, …); 25R2 and 26R1 declare none. The generated tables carry the
 * limit into the tool's schema, and the core refuses a longer string with
 * InvalidParams, naming the parameter and the limit, before anything is sent.
 *
 * - AC 1: for every listed route and every limited parameter, through the MCP
 *   client: one character over is refused and sends nothing; at the limit, the
 *   length is not what refuses it;
 * - AC 2: the limits come from the selected release's spec: the same tool takes
 *   the long value on 26R1;
 * - AC 3: every route's table entry carries exactly the limits its operation's
 *   query parameters declare in the spec, read here from the specs, not from the
 *   generator (a merged tool keeps a limit only where its routes agree).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASES, loadOperations, type Release, type Schema } from './lib/spec.js';
import { ROOT, SERVERS, callsOf, connect, createRecorder, domainOf, guardEnv, requiredArguments } from './lib/exerciser.js';

const INVALID_PARAMS = -32602;
const recorder = createRecorder(() => ({ data: [], totalItems: 0 }));
const savedEnv = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = savedEnv; });

type Table = Record<string, Record<string, Record<string, { maxLength?: number }>>>;
const tablesOf = async (server: string) => ({
  queries: (await import(pathToFileURL(join(ROOT, server, 'src', 'query-params.ts')).href)).QUERY_PARAMETERS as Table,
  operations: (await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href)).TOOL_OPERATIONS as Record<string, string[]>,
});

/** A query parameter's maxLength in the spec, resolving a $ref. */
function specLimit(spec: Schema, parameter: Schema): number | undefined {
  let schema: Schema = parameter.schema ?? {};
  while (schema.$ref) {schema = String(schema.$ref).replace(/^#\//, '').split('/').reduce((node: Schema, key: string) => node[key], spec);}
  return Number.isInteger(schema.maxLength) && !Array.isArray(schema.enum) ? schema.maxLength : undefined;
}

/** Per (domain, operationId) of a GET: every query parameter, with its limit (undefined: none). */
function specParameters(release: Release): Map<string, Map<string, number | undefined>> {
  const out = new Map<string, Map<string, number | undefined>>();
  for (const op of loadOperations(release).filter((o) => o.method === 'GET')) {
    const params: Schema[] = op.spec.paths?.[op.path]?.get?.parameters ?? [];
    out.set(`${op.domain} ${op.operationId}`, new Map(params.filter((x) => x.in === 'query').map((x) => [x.name, specLimit(op.spec, x)])));
  }
  return out;
}

describe.each(RELEASES)('bMS %s', (release) => {
  it('every route\'s table entry carries the limits of its operation in the spec (AC 3)', async () => {
    const parameters = specParameters(release);
    let checked = 0;
    for (const server of SERVERS) {
      const { queries, operations } = await tablesOf(server);
      for (const [key, ids] of Object.entries(operations)) {
        const entry = queries[release]?.[key];
        if (!entry) {continue;}
        // As the generator: a parameter is defined by the first of the route's operations that has it.
        const expected: Record<string, number> = {};
        const seen = new Set<string>();
        for (const id of ids) {
          for (const [name, max] of parameters.get(`${domainOf(server)} ${id}`) ?? []) {
            if (seen.has(name)) {continue;}
            seen.add(name);
            if (max !== undefined && name in entry) {expected[name] = max;}
          }
        }
        const offered = Object.fromEntries(Object.entries(entry).filter(([, p]) => typeof p.maxLength === 'number').map(([name, p]) => [name, p.maxLength]));
        expect(offered, `${server} ${key}`).toEqual(expected);
        checked += Object.keys(offered).length;
      }
    }
    if (release === '26R2') {expect(checked).toBeGreaterThan(100);} else {expect(checked).toBe(0);}
  });

  it.for(SERVERS)('%s: one character over the limit is refused, naming it, and sends nothing; the limit itself passes (AC 1)', async (server, { expect }) => {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    const conn = await connect(server);
    for (const c of await callsOf(server, conn.tools, release)) {
      const limited = Object.entries<Schema>(c.inputSchema.properties ?? {}).filter(([, p]) => typeof p.maxLength === 'number');
      for (const [arg, property] of limited) {
        const base = { ...requiredArguments(c.inputSchema), ...c.select };
        recorder.take();
        const over = await conn.call(c.name, { ...base, [arg]: 'x'.repeat(property.maxLength + 1) });
        expect(over.code, `${c.key} ${arg}: ${over.text}`).toBe(INVALID_PARAMS);
        expect(over.text).toContain(`${arg} must be at most ${property.maxLength} characters (${c.name}; it has ${property.maxLength + 1})`);
        expect(recorder.take(), `${c.key} ${arg} sent a request`).toEqual([]);
        const at = await conn.call(c.name, { ...base, [arg]: 'x'.repeat(property.maxLength) });
        expect(at.text, `${c.key} ${arg} at the limit`).not.toContain('must be at most');
      }
    }
    await conn.close();
  });
});

describe('the limit follows the selected release (AC 2)', () => {
  const longHostName = 'h'.repeat(300);

  it.for([['26R2', true], ['26R1', false]] as const)('list_endpoints HostName of 300 characters on %s: refused = %s', async ([release, refused]) => {
    Object.assign(process.env, guardEnv(release, { writes: false, secretRead: false }));
    const conn = await connect('bconnect-endpoints-mcp');
    recorder.take();
    const result = await conn.call('list_endpoints', { HostName: longHostName });
    const sent = recorder.take();
    await conn.close();
    if (refused) {
      expect(result.code).toBe(INVALID_PARAMS);
      expect(result.text).toMatch(/HostName must be at most \d+ characters/);
      expect(sent).toEqual([]);
    } else {
      expect(result.isError).toBe(false);
      expect(sent.map((r) => r.url.searchParams.get('HostName'))).toEqual([longHostName]);
    }
  });
});
