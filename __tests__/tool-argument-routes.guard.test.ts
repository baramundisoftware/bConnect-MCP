/**
 * Tool-argument route guard (REQ-SRV-018).
 *
 * A tool sends its request to its own route and nowhere else, whatever its
 * arguments contain. Every tool of every server is called, for both bMS
 * releases, and each string argument named like an ID gets a set of hostile
 * values; MSW records the requests the tools send.
 *
 * Path IDs are found from the traffic, not a hand list: an argument whose
 * marker GUID shows up in the request path is a path ID. For those, the
 * server's own validation must refuse the hostile value before any request
 * (Lock A). For every argument, no request may leave the server's domain or
 * carry a non-canonical path (Lock A or Lock B; Lock B has its own unit test).
 *
 * The three servers that validate through a TOOL_RULES map must have an entry
 * for every registered tool, and every rule must name an argument of its tool,
 * so a renamed argument can't silently switch its rule off.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASES, type Release } from './lib/spec.js';
import {
  BASE_PATH, ID, ROOT, SERVERS, connect, createRecorder, domainOf, guardEnv, sample, type JsonSchema,
} from './lib/exerciser.js';

const MARKER = '11111111-2222-4333-8444-555555555555';
const RULE_MAP_SERVERS = ['bconnect-endpoints-mcp', 'bconnect-groups-mcp', 'bconnect-jobs-mcp'];

/** Hostile values aimed at a route of another domain. */
function payloads(domain: string): Record<string, string> {
  const other = domain === 'variables' ? 'jobs/v2.0/JobDefinitions' : 'variables/v2.0/VariableDefinitions';
  const plain = `../../../${other}`;
  return {
    traversal: plain,
    encoded: encodeURIComponent(plain),
    'double-encoded': encodeURIComponent(encodeURIComponent(plain)),
    backslash: plain.replace(/\//g, '\\'),
    'query-injection': `${ID}?PageSize=1000`,
  };
}

function argumentsWith(inputSchema: JsonSchema, target: string, value: string): Record<string, unknown> {
  const required: string[] = inputSchema.required ?? [];
  const args: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries<JsonSchema>(inputSchema.properties ?? {})) {
    if (name === target) args[name] = value;
    else if (required.includes(name)) args[name] = sample(name, schema);
  }
  return args;
}

const recorder = createRecorder();

interface Finding { release: Release; server: string; tool: string; arg: string; payload: string; problem: string }

/** Why a recorded request is out of bounds for this server, or undefined if it isn't. */
function escapeOf(url: URL, domain: string): string | undefined {
  const path = url.pathname.slice(BASE_PATH.length);
  if (path.split('/')[1] !== domain) return `left the domain: ${path}`;
  if (/%2e|%2f|%5c|%25|\\/i.test(path)) return `non-canonical path: ${path}`;
  if (url.searchParams.get('PageSize') === '1000') return `query injected: ${url.search}`;
  return undefined;
}

async function sweep(release: Release): Promise<{ findings: Finding[]; pathIds: number }> {
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
  const findings: Finding[] = [];
  let pathIds = 0;
  for (const server of SERVERS) {
    const domain = domainOf(server);
    const conn = await connect(server);

    const call = async (tool: string, args: Record<string, unknown>) => {
      recorder.take();
      const { text, isError } = await conn.call(tool, args);
      return { requests: recorder.take().map((r) => r.url), text, isError };
    };

    for (const tool of conn.tools) {
      const schema = tool.inputSchema;
      const idArgs = Object.entries<JsonSchema>(schema.properties ?? {})
        .filter(([name, s]) => s.type === 'string' && /id$/i.test(name))
        .map(([name]) => name);
      for (const arg of idArgs) {
        const probe = await call(tool.name, argumentsWith(schema, arg, MARKER));
        const isPathId = probe.requests.some((u) => u.pathname.includes(MARKER));
        if (isPathId) pathIds++;
        for (const [payload, value] of Object.entries(payloads(domain))) {
          const { requests, text, isError } = await call(tool.name, argumentsWith(schema, arg, value));
          const base = { release, server, tool: tool.name, arg, payload };
          for (const url of requests) {
            const problem = escapeOf(url, domain);
            if (problem) findings.push({ ...base, problem });
          }
          if (isPathId && !(isError && requests.length === 0 && text.includes(arg))) {
            findings.push({ ...base, problem: 'path ID not refused by the tool\'s validation' });
          }
        }
      }
    }
    await conn.close();
  }
  return { findings, pathIds };
}

const savedEnv = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => {
  recorder.close();
  process.env = savedEnv;
});

describe.each(RELEASES)('tool arguments, bMS %s', (release) => {
  let result: Awaited<ReturnType<typeof sweep>>;
  beforeAll(async () => { result = await sweep(release); }, 300_000);

  it('finds the path-ID arguments from the traffic', () => {
    expect(result.pathIds).toBeGreaterThan(150);
  });

  it('keeps every request on its own route, and validation refuses hostile path IDs', () => {
    const lines = result.findings.map((f) => `${f.server} ${f.tool}(${f.arg}) [${f.payload}]: ${f.problem}`);
    expect(lines).toEqual([]);
  });
});

describe.each(RULE_MAP_SERVERS)('%s validation rules', (server) => {
  let rules: Record<string, () => Array<{ name: string }>>;
  let tools: Array<{ name: string; inputSchema: JsonSchema }>;

  beforeAll(async () => {
    process.env.BCONNECT_RELEASE = '26R1';
    const utils = await import(pathToFileURL(join(ROOT, server, 'src', 'utils', 'mcp-tool-validation-rules.ts')).href);
    rules = utils.TOOL_RULES;
    const conn = await connect(server);
    tools = conn.tools;
    await conn.close();
  });

  it('has a TOOL_RULES entry for every registered tool', () => {
    expect(rules, 'TOOL_RULES is not exported').toBeDefined();
    expect(tools.map((t) => t.name).filter((name) => !(name in rules))).toEqual([]);
  });

  it('names only arguments the tool declares', () => {
    const stray = tools.flatMap((t) => (rules?.[t.name]?.() ?? [])
      .map((r) => r.name)
      .filter((name) => !(name in (t.inputSchema.properties ?? {})))
      .map((name) => `${t.name}: ${name}`));
    expect(stray).toEqual([]);
  });
});
