/**
 * Live tier: every server against a real baramundi Management Server, read-only.
 *
 * Opt-in. Runs only when the live env file (default `.env.local`, override with
 * BCONNECT_LIVE_ENV). A missing file, a file without BCONNECT_BASE_URL, an
 * unreachable bMS or a run that exercised nothing fails the run.
 * Not part of `npm test`. Every variable the servers read comes from that file or
 * is empty (lib/env.ts): nothing leaks in from the repo `.env` or the shell.
 *
 *   npm run test:live
 *
 * 1. Startup: each built server starts over stdio with the startup probe on
 *    (TLS + authentication against the bMS), answers initialize and tools/list,
 *    and writes nothing but JSON-RPC to stdout. It runs under the same request
 *    guard (child-guard.mjs) and may send only its startup check.
 * 2. Read tools: each tool whose declared operations are all non-secret GETs is
 *    called in-process. List tools go first; the IDs they return feed the tools
 *    that need one (the ID source is the operation whose route is the part of
 *    the tool's route before its first `{param}`).
 *
 * Read-only by construction: an MSW request guard (lib/guard.mjs) passes GET
 * requests to the bMS through and fails every other method and origin, every
 * credential-returning route and every redirect before it leaves the process; the
 * write and secret gates stay closed as well.
 *
 * Where a real response differs from its OpenAPI schema, the difference is
 * reported (console and reports/live-bms.json), not failed: the spec-conformance
 * guard owns requests, this tier observes responses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { ROOT, SERVERS, connect, domainOf, type ConnectedServer, type JsonSchema } from '../lib/exerciser.js';
import { RELEASES, findOperation, loadOperations, type ApiOperation, type Release } from '../lib/spec.js';
import { operationIn } from '../lib/conformance.js';
import { createResponseValidator, type SchemaFinding } from '../lib/response-schema.js';
import { checkReachable, childEnv, loadLiveConfig } from './lib/env.js';
import { assertExercised, sanitise, sanitisedSummary, type ToolRun } from './lib/report.js';
import { createGuard } from './lib/guard.mjs';
import { expectedAnswer } from './lib/expected.js';
import { CHILD_GUARD, readGuardLog, startupProblems, type LoggedRequest } from './lib/child.js';

const ENV_FILE = process.env.BCONNECT_LIVE_ENV ?? join(ROOT, '.env.local');
// A missing or incomplete env file fails the run here, before any test (lib/env.ts).
const config = loadLiveConfig({ root: ROOT, file: ENV_FILE, shell: process.env });
const RELEASE: Release = config.release;
const PAGE_SIZE = 5;

/** Console text: no credentials, host or object IDs, whatever a server prints (lib/report.ts). */
const clean = (s: string): string => sanitise(s, { hostname: config.baseUrl.hostname, secrets: config.secrets });

let started = 0;
let bmsVersion: string | undefined;
beforeAll(async () => { ({ bmsVersion } = await checkReachable(config)); }, 30_000);
afterAll(() => assertExercised({ startups: started, calls: runs.filter((r) => r.outcome !== 'skipped').length }));

// ─── Startup over stdio ──────────────────────────────────────────────────────

interface Startup { exitCode: number | null; initialized: boolean; tools: number; nonJson: number; stderr: string; requests: LoggedRequest[] }

/** Request logs of the spawned servers (child-guard.mjs), one file per server. */
const guardLogs = mkdtempSync(join(tmpdir(), 'live-guard-'));
afterAll(() => rmSync(guardLogs, { recursive: true, force: true }));

async function startOverStdio(server: string): Promise<Startup> {
  // The server runs under the same request guard as this process, and logs what it sends.
  const log = join(guardLogs, `${server}.jsonl`);
  const env = { ...childEnv(config, process.env), LIVE_GUARD_LOG: log };
  const child = spawn(process.execPath, ['--import', CHILD_GUARD, join(ROOT, server, 'build', 'index.js')], { env, cwd: ROOT });
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
    stderr: clean(err.split('\n').slice(-8).join('\n')),
    requests: readGuardLog(log),
  };
}

describe(`live bMS (${RELEASE}): startup`, () => {
  it.each(SERVERS)('%s starts with the probe on', async (server) => {
    expect(existsSync(join(ROOT, server, 'build', 'index.js')), `${server} is not built: run the build first`).toBe(true);
    const s = await startOverStdio(server);
    if (s.initialized) started++;
    expect(s.initialized, `no initialize answer; stderr:\n${s.stderr}`).toBe(true);
    expect(s.tools, 'tools/list').toBeGreaterThan(0);
    expect(s.nonJson, 'stdout lines that are not JSON-RPC').toBe(0);
    expect(startupProblems(s.requests, domainOf(server), basePath), 'requests at startup besides the startup check').toEqual([]);
  });
});

// ─── Read tools in-process, behind the network guard ─────────────────────────

interface Exchange { method: string; path: string; status: number; body: unknown; op?: ApiOperation }

const runs: ToolRun[] = [];
/** Spec route of a list operation (`<domain> <path>`) → IDs its responses carried. */
const idsByRoute = new Map<string, string[]>();

let exchanges: Exchange[] = [];
let pending: Array<Promise<void>> = [];
const basePath = config.baseUrl.pathname.replace(/\/$/, '');
const origin = config.baseUrl.origin;

// Only GETs to the bMS that return no credentials leave the process; redirects fail the run (lib/guard.mjs).
const guard = createGuard({ origin, onResponse: (request, response) => {
  const url = new URL(request.url);
  const path = url.pathname.slice(basePath.length);
  pending.push(response.clone().arrayBuffer().then((raw) => {
    // The bypass copy is the body as sent: IIS compresses (br), axios decompresses only its own copy.
    const decoded = decode(Buffer.from(raw), response.headers.get('content-encoding'));
    const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;  // UTF-8 BOM
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text */ }
    exchanges.push({ method: request.method, path, status: response.status, body, op: findOperation(RELEASE, request.method, path) });
  }));
} });

function decode(raw: Buffer, encoding: string | null): string {
  switch (encoding?.trim().toLowerCase()) {
    case 'br': return brotliDecompressSync(raw).toString('utf8');
    case 'gzip': return gunzipSync(raw).toString('utf8');
    case 'deflate': return inflateSync(raw).toString('utf8');
    default: return raw.toString('utf8');
  }
}

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
  // In the server's own spec, as the conformance guard does: operationIds such as GetFolder recur across specs.
  const ops = ids.map((id) => operationIn(loadOperations(RELEASE), domainOf(server), id))
    .filter((op): op is ApiOperation => op !== undefined);
  if (ops.length !== ids.length) return `operation not in the ${RELEASE} spec`;
  if (ops.some((op) => op.method !== 'GET')) return 'write tool';
  if (ops.some((op) => op.secretFields.length > 0)) return 'returns credentials (secret gate)';
  return ops;
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
  // Only a listed tool with its listed answer is expected (lib/expected.ts); its reason is reported.
  const reason = expectedAnswer(tool.name, exchanges.filter((e) => e.status < 200 || e.status > 299));
  if (reason) return { ...base, outcome: 'expected', detail: reason };
  return { ...base, outcome: 'failed', detail: result.text.slice(0, 300) };
}

describe(`live bMS (${RELEASE}): read tools`, () => {
  const saved = { ...process.env };
  const conns = new Map<string, ConnectedServer>();
  const tables = new Map<string, Readonly<Record<string, readonly string[]>>>();
  const validator = createResponseValidator();

  beforeAll(async () => {
    expect(RELEASES).toContain(RELEASE);
    Object.assign(process.env, config.env);
    guard.server.listen({ onUnhandledRequest: 'error' });
    for (const server of SERVERS) {
      const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
      tables.set(server, mod.TOOL_OPERATIONS);
      conns.set(server, await connect(server));
    }
  }, 120_000);

  afterAll(async () => {
    for (const conn of conns.values()) await conn.close();
    guard.server.close();
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
      expect(guard.refused, 'requests the guard stopped (must be none: tools are read-only)').toEqual([]);
      const failed = mine.filter((r) => r.outcome === 'failed').map((r) => clean(`${r.tool} [${r.requests?.join(', ')}] ${r.detail}`));
      expect(failed, `${server} read tools that failed on the live bMS`).toEqual([]);
    }, 300_000);
  }
});

/**
 * reports/live-bms.json keeps everything, host and raw details included (gitignored).
 * reports/live-bms-summary.md and the console get the sanitised summary only.
 */
function writeReport(): void {
  const dir = join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  const summary = sanitisedSummary({
    release: RELEASE, bmsVersion, tlsVerified: config.tlsVerified, caFile: config.caFile,
    startups: { ok: started, total: SERVERS.length }, runs,
  });
  writeFileSync(join(dir, 'live-bms.json'), JSON.stringify({
    bms: config.baseUrl.href, release: RELEASE, bmsVersion, tlsVerified: config.tlsVerified, caFile: config.caFile,
    at: new Date().toISOString(), node: process.version, platform: process.platform, runs,
  }, null, 2));
  writeFileSync(join(dir, 'live-bms-summary.md'), summary);
  console.log(`${summary}\nLocal report (not for publishing): reports/live-bms.json\nPublishable summary: reports/live-bms-summary.md`);
}
