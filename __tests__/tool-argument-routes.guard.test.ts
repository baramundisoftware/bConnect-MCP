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
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { RELEASES, type Release } from './lib/spec-secrets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'http://bms.routes.test/bconnect';
const BASE_PATH = new URL(BASE_URL).pathname;
const ID = '00000000-0000-4000-8000-000000000001';
const MARKER = '11111111-2222-4333-8444-555555555555';

const SERVERS = readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d)).sort();
const RULE_MAP_SERVERS = ['bconnect-endpoints-mcp', 'bconnect-groups-mcp', 'bconnect-jobs-mcp'];

const domainOf = (server: string) => {
  const name = server.replace(/^bconnect-/, '').replace(/-mcp$/, '');
  return name === 'groups' ? 'endpoints' : name;
};

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

type JsonSchema = Record<string, any>;

function sample(name: string, schema: JsonSchema): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (schema.type) {
    case 'string': return /id$/i.test(name) ? ID : 'x';
    case 'integer':
    case 'number': return 1;
    case 'boolean': return false;
    case 'array': return /patch|operations/i.test(name) ? [{ op: 'replace', path: '/name', value: 'x' }] : [];
    case 'object': return { name: 'x' };
    default: return 'x';
  }
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

let recorded: URL[] = [];
const msw = setupServer(
  http.all('*', ({ request }) => {
    recorded.push(new URL(request.url));
    return HttpResponse.json({});
  }),
);

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
  Object.assign(process.env, {
    BCONNECT_BASE_URL: BASE_URL,
    BCONNECT_USERNAME: 'guard',
    BCONNECT_PASSWORD: 'guard',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true',
    BCONNECT_RELEASE: release,
    ALLOW_WRITE_OPERATIONS: 'true',
    ALLOW_SECRET_READ: 'true',
  });
  const findings: Finding[] = [];
  let pathIds = 0;
  for (const server of SERVERS) {
    const domain = domainOf(server);
    const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'index.ts')).href);
    const { server: mcp } = mod.createServer();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'argument-route-guard', version: '0' });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);

    const call = async (tool: string, args: Record<string, unknown>) => {
      recorded = [];
      let text: string;
      let isError = false;
      try {
        const result = await client.callTool({ name: tool, arguments: args });
        text = JSON.stringify(result.content ?? '');
        isError = result.isError === true;
      } catch (error) {
        text = String((error as Error).message);
        isError = true;
      }
      return { requests: [...recorded], text, isError };
    };

    for (const tool of (await client.listTools()).tools) {
      const schema = tool.inputSchema as JsonSchema;
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
    await client.close();
  }
  return { findings, pathIds };
}

const savedEnv = { ...process.env };
beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterAll(() => {
  msw.close();
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
    const { server: mcp } = (await import(pathToFileURL(join(ROOT, server, 'src', 'index.ts')).href)).createServer();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'rule-map-guard', version: '0' });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    tools = (await client.listTools()).tools as typeof tools;
    await client.close();
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
