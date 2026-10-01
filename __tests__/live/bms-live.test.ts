/**
 * Live tier: every server against a real baramundi Management Server, read-only.
 *
 * Opt-in. Runs only when the live env file (default `.env.local`, override with
 * BCONNECT_LIVE_ENV) sets BCONNECT_BASE_URL; otherwise every test is skipped.
 * Not part of `npm test`.
 *
 *   npm run test:live
 *
 * 1. Startup: each built server starts over stdio with the startup probe on
 *    (TLS + authentication against the bMS), answers initialize and tools/list,
 *    and writes nothing but JSON-RPC to stdout.
 * 2. Read tools: each tool whose declared operations are all non-secret GETs is
 *    called in-process. List tools go first; the IDs they return feed the tools
 *    that need one (the ID source is the operation whose route is the part of
 *    the tool's route before its first `{param}`).
 *
 * Read-only by construction: an MSW network guard passes GET requests to the bMS
 * host through and fails every other request before it leaves the process; the
 * write and secret gates stay closed as well.
 *
 * Where a real response differs from its OpenAPI schema, the difference is
 * reported (console and reports/live-bms.json), not failed: the spec-conformance
 * guard owns requests, this tier observes responses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { setupServer } from 'msw/node';
import { http, HttpResponse, passthrough } from 'msw';
import { ROOT, SERVERS, connect, domainOf, type ConnectedServer, type JsonSchema } from '../lib/exerciser.js';
import { RELEASES, findOperation, loadOperations, type ApiOperation, type Release } from '../lib/spec.js';
import { createResponseValidator, type SchemaFinding } from '../lib/response-schema.js';

const ENV_FILE = process.env.BCONNECT_LIVE_ENV ?? join(ROOT, '.env.local');
const fileEnv = existsSync(ENV_FILE) ? parse(readFileSync(ENV_FILE)) : {};
const BASE_URL = fileEnv.BCONNECT_BASE_URL ?? '';
const LIVE = BASE_URL !== '';
const RELEASE = (fileEnv.BCONNECT_RELEASE ?? '26R1') as Release;
const PAGE_SIZE = 5;
/** Statuses that mean "this bMS does not offer it" (module not licensed, route absent), not a defect. */
const UNAVAILABLE = new Set([403, 501]);

/** What the servers see: the bMS, its credentials and CA from the file; gates closed; probe on. */
const liveEnv: Record<string, string> = {
  BCONNECT_BASE_URL: BASE_URL,
  BCONNECT_RELEASE: RELEASE,
  ...pick(fileEnv, ['BCONNECT_API_KEY', 'BCONNECT_USERNAME', 'BCONNECT_PASSWORD', 'BCONNECT_CA_CERT_PATH']),
  // Empty, not deleted: dotenv never overrides a key that is present.
  ALLOW_WRITE_OPERATIONS: '',
  ALLOW_SECRET_READ: '',
  BCONNECT_SKIP_CONNECTIVITY_CHECK: '',
};

function pick(from: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => from[k]).map((k) => [k, from[k]]));
}

/** Credentials never reach test output, whatever a server prints. */
const SECRETS = [fileEnv.BCONNECT_PASSWORD, fileEnv.BCONNECT_API_KEY,
  fileEnv.BCONNECT_USERNAME && fileEnv.BCONNECT_PASSWORD
    ? Buffer.from(`${fileEnv.BCONNECT_USERNAME}:${fileEnv.BCONNECT_PASSWORD}`).toString('base64') : undefined,
].filter((s): s is string => !!s && s.length >= 4);
const redact = (s: string): string => SECRETS.reduce((out, secret) => out.split(secret).join('***'), s);

// ─── Startup over stdio ──────────────────────────────────────────────────────

interface Startup { exitCode: number | null; initialized: boolean; tools: number; nonJson: number; stderr: string }

async function startOverStdio(server: string): Promise<Startup> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...liveEnv, NODE_ENV: 'production' };
  delete env.VITEST;
  const child = spawn(process.execPath, [join(ROOT, server, 'build', 'index.js')], { env, cwd: ROOT });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const messages = (): Array<Record<string, unknown> | null> => out.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  });
  const answer = (id: number, ms: number) => new Promise<Record<string, any> | undefined>((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const m = messages().find((x) => x?.id === id);
      if (m || child.exitCode !== null || Date.now() - started > ms) { clearInterval(poll); resolve(m ?? undefined); }
    }, 50);
  });
  const send = (m: object): void => { child.stdin.write(JSON.stringify(m) + '\n'); };

  // The probe runs before the transport connects; initialize waits behind it.
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live', version: '0' } } });
  const init = await answer(1, 30_000);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const list = await answer(2, 15_000);
  child.kill();
  return {
    exitCode: child.exitCode,
    initialized: !!init?.result,
    tools: list?.result?.tools?.length ?? 0,
    nonJson: messages().filter((m) => m === null || m.jsonrpc !== '2.0').length,
    stderr: redact(err.split('\n').slice(-8).join('\n')),
  };
}

describe.skipIf(!LIVE)(`live bMS ${BASE_URL} (${RELEASE}): startup`, () => {
  it.each(SERVERS)('%s starts with the probe on', async (server) => {
    expect(existsSync(join(ROOT, server, 'build', 'index.js')), `${server} is not built: run the build first`).toBe(true);
    const s = await startOverStdio(server);
    expect(s.initialized, `no initialize answer; stderr:\n${s.stderr}`).toBe(true);
    expect(s.tools, 'tools/list').toBeGreaterThan(0);
    expect(s.nonJson, 'stdout lines that are not JSON-RPC').toBe(0);
  });
});

// ─── Read tools in-process, behind the network guard ─────────────────────────

interface Exchange { method: string; path: string; status: number; body: unknown; op?: ApiOperation }
type Outcome = 'ok' | 'unavailable' | 'failed' | 'skipped';
interface ToolRun {
  server: string; tool: string; outcome: Outcome; detail: string;
  args?: Record<string, unknown>; ms?: number; statuses?: number[]; requests?: string[]; schema?: SchemaFinding[];
}

const runs: ToolRun[] = [];
const blocked: string[] = [];
/** Spec route of a list operation (`<domain> <path>`) → IDs its responses carried. */
const idsByRoute = new Map<string, string[]>();

let exchanges: Exchange[] = [];
let pending: Array<Promise<void>> = [];
const basePath = LIVE ? new URL(BASE_URL).pathname.replace(/\/$/, '') : '';
const origin = LIVE ? new URL(BASE_URL).origin : '';

const guard = setupServer(
  http.all('*', ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== origin) {
      blocked.push(`${request.method} ${url.origin}${url.pathname}`);
      return HttpResponse.error();
    }
    return passthrough();
  }),
);
guard.events.on('response:bypass', ({ request, response }) => {
  const url = new URL(request.url);
  const path = url.pathname.slice(basePath.length);
  pending.push(response.clone().text().then((text) => {
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text */ }
    exchanges.push({ method: request.method, path, status: response.status, body, op: findOperation(RELEASE, request.method, path) });
  }));
});

/** The items of a list response: the body if it is an array, else its first array-valued property. */
function itemsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') return Object.values(body).find(Array.isArray) ?? [];
  return [];
}

const routeKey = (op: ApiOperation, path = op.path): string => `${op.domain} ${path}`;
/** `/v2.0/Endpoints/{id}/Software` → `/v2.0/Endpoints`; undefined when the route has no parameter. */
const parentRoute = (path: string): string | undefined => (path.includes('{') ? path.slice(0, path.indexOf('/{')) : undefined);

/** The operations a tool declares, or why it is not exercised here. */
function readOperations(server: string, table: Readonly<Record<string, readonly string[]>>, tool: string): ApiOperation[] | string {
  const ids = table[tool];
  if (!ids?.length) return 'no operation declared';
  // In the server's own spec: operationIds such as GetFolder recur across specs.
  const ops = ids.map((id) => loadOperations(RELEASE).find((op) => op.domain === domainOf(server) && op.operationId === id));
  if (ops.some((op) => !op)) return `operation not in the ${RELEASE} spec`;
  if (ops.some((op) => op!.method !== 'GET')) return 'write tool';
  if (ops.some((op) => op!.secretFields.length > 0)) return 'returns credentials (secret gate)';
  return ops as ApiOperation[];
}

/** Arguments for a tool, or why none can be built: required args must be one ID fed from its parent list. */
function argumentsFor(tool: { inputSchema: JsonSchema }, op: ApiOperation): Record<string, unknown> | string {
  const props: Record<string, JsonSchema> = tool.inputSchema.properties ?? {};
  const required: string[] = tool.inputSchema.required ?? [];
  const args: Record<string, unknown> = {};
  if (props.PageSize) args.PageSize = PAGE_SIZE;
  if (required.length === 0) return args;
  if (required.length > 1 || !/id$/i.test(required[0])) return `needs ${required.join(', ')}`;
  const parent = parentRoute(op.path);
  const ids = parent ? idsByRoute.get(routeKey(op, parent)) : undefined;
  if (!ids?.length) return `no ID from ${parent ?? 'a parent route'} on this bMS`;
  return { ...args, [required[0]]: ids[0] };
}

async function exercise(server: string, conn: ConnectedServer, tool: ConnectedServer['tools'][number],
  ops: ApiOperation[], args: Record<string, unknown>, validator: ReturnType<typeof createResponseValidator>): Promise<ToolRun> {
  let result: Awaited<ReturnType<ConnectedServer['call']>>;
  let started = Date.now();
  // A throttled call (429) is retried after a pause, not counted as a failure.
  for (let attempt = 0; ; attempt++) {
    exchanges = [];
    pending = [];
    started = Date.now();
    result = await conn.call(tool.name, args);
    await Promise.all(pending);
    if (attempt === 3 || !exchanges.some((e) => e.status === 429)) break;
    await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
  }
  const ms = Date.now() - started;
  const statuses = exchanges.map((e) => e.status);
  const schema: SchemaFinding[] = [];
  for (const e of exchanges) {
    if (!e.op || e.status < 200 || e.status > 299) continue;
    schema.push(...validator.check(e.op, e.body));
    const ids = itemsOf(e.body).map((i) => (i as Record<string, unknown>)?.id).filter((id): id is string => typeof id === 'string');
    if (ids.length) idsByRoute.set(routeKey(e.op), ids);
  }
  const requests = exchanges.map((e) => `${e.method} ${e.path} ${e.status}`);
  const base = { server, tool: tool.name, args, ms, statuses, requests, schema };
  if (!result.isError) return { ...base, outcome: 'ok', detail: `${ops[0].method} ${ops[0].path}` };
  const detail = redact(result.text).slice(0, 300);
  if (statuses.length && statuses.every((s) => UNAVAILABLE.has(s))) return { ...base, outcome: 'unavailable', detail };
  return { ...base, outcome: 'failed', detail };
}

describe.skipIf(!LIVE)(`live bMS ${BASE_URL} (${RELEASE}): read tools`, () => {
  const saved = { ...process.env };
  const conns = new Map<string, ConnectedServer>();
  const tables = new Map<string, Readonly<Record<string, readonly string[]>>>();
  const validator = createResponseValidator();

  beforeAll(async () => {
    expect(RELEASES).toContain(RELEASE);
    Object.assign(process.env, liveEnv);
    guard.listen({ onUnhandledRequest: 'error' });
    for (const server of SERVERS) {
      const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
      tables.set(server, mod.TOOL_OPERATIONS);
      conns.set(server, await connect(server));
    }
  }, 120_000);

  afterAll(async () => {
    for (const conn of conns.values()) await conn.close();
    guard.close();
    process.env = saved;
    writeReport();
  });

  // Two passes over all servers: lists first, so IDs exist across servers (groups uses endpoints routes).
  for (const pass of ['lists', 'by ID'] as const) {
    it.each(SERVERS)(`%s: ${pass}`, async (server) => {
      const conn = conns.get(server)!;
      const mine: ToolRun[] = [];
      for (const tool of conn.tools) {
        const needsId = (tool.inputSchema.required ?? []).length > 0;
        if ((pass === 'lists') === needsId) continue;
        const ops = readOperations(server, tables.get(server)!, tool.name);
        if (typeof ops === 'string') { runs.push({ server, tool: tool.name, outcome: 'skipped', detail: ops }); continue; }
        const args = argumentsFor(tool, ops[0]);
        if (typeof args === 'string') { runs.push({ server, tool: tool.name, outcome: 'skipped', detail: args }); continue; }
        const run = await exercise(server, conn, tool, ops, args, validator);
        runs.push(run);
        mine.push(run);
      }
      expect(blocked, 'requests the network guard stopped (must be none: tools are read-only)').toEqual([]);
      const failed = mine.filter((r) => r.outcome === 'failed').map((r) => `${r.tool} [${r.requests?.join(", ")}] ${r.detail}`);
      expect(failed, `${server} read tools that failed on the live bMS`).toEqual([]);
    }, 300_000);
  }
});

function writeReport(): void {
  const count = (o: Outcome): number => runs.filter((r) => r.outcome === o).length;
  const withSchema = runs.filter((r) => r.schema?.length);
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  const file = join(ROOT, 'reports', 'live-bms.json');
  writeFileSync(file, JSON.stringify({
    bms: BASE_URL, release: RELEASE, at: new Date().toISOString(), node: process.version, platform: process.platform,
    totals: { ok: count('ok'), unavailable: count('unavailable'), failed: count('failed'), skipped: count('skipped'), schemaDrift: withSchema.length },
    runs,
  }, null, 2));
  const lines = [
    `live bMS ${BASE_URL} (${RELEASE}): ${count('ok')} ok, ${count('unavailable')} unavailable, ${count('failed')} failed, ${count('skipped')} skipped`,
    ...runs.filter((r) => r.outcome === 'unavailable').map((r) => `  unavailable  ${r.server} ${r.tool} [${r.statuses?.join(',')}]`),
    `schema drift in ${withSchema.length} tool responses:`,
    ...withSchema.flatMap((r) => [`  ${r.server} ${r.tool}`, ...r.schema!.slice(0, 5).map((f) => `      ${f.path} ${f.message}`),
      ...(r.schema!.length > 5 ? [`      … ${r.schema!.length - 5} more`] : [])]),
    `report: ${file}`,
  ];
  console.log(lines.join('\n'));
}
