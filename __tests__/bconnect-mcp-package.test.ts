/**
 * The bconnect-mcp package starts one or several domains as one MCP server (#297, step 1).
 *
 * - the domain names and their order are the servers on disk and the gateway's;
 * - the argument: one domain, several, `all`; refusals for anything else;
 * - through core's startup routine with the stdio transport replaced by an
 *   in-memory client: one domain is that domain's own server, several and `all`
 *   list the tools of each domain, in order; a domain named on its own without
 *   tools in the release stops the start, `all` leaves it out;
 * - the built command, as a client starts it: the first stdout line answers
 *   `initialize`, a wrong argument exits 1 with nothing on stdout.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StartupIo } from '@bconnect/mcp-core';
import { DOMAINS, domainParts } from '../packages/bconnect-mcp/src/domains.js';
import { NAME, USAGE, chosenDomains, main } from '../packages/bconnect-mcp/src/index.js';
import { domains as gatewayDomains } from '../bconnect-mcp-gateway/src/app.js';
import { RELEASES } from './lib/spec.js';
import { ROOT, SERVERS, connect, guardEnv } from './lib/exerciser.js';

const savedEnv = { ...process.env };
afterAll(() => { process.env = savedEnv; });

describe('domains', () => {
  it('are the 13 servers on disk, in the gateway order', () => {
    expect([...DOMAINS].sort()).toEqual(SERVERS.map((server) => server.replace(/^bconnect-|-mcp$/g, '')).sort());
    expect(DOMAINS).toEqual(gatewayDomains);
  });
});

it('domainParts refuses a name that is no domain', () => {
  expect(() => domainParts(['foo'])).toThrow("Unknown MCP domain 'foo'");
});

describe('main', () => {
  const io = () => {
    const lines: string[] = [];
    const codes: number[] = [];
    const value: StartupIo = { env: process.env, error: (line) => { lines.push(line); }, exit: (code) => { codes.push(code); return undefined as never; }, connectStdio: async () => {} };
    return { value, lines, codes };
  };

  it('--help prints the usage and exits 0', async () => {
    const { value, lines, codes } = io();
    await main(['--help'], value);
    expect(lines).toEqual([USAGE]);
    expect(codes).toEqual([0]);
  });

  it('a wrong argument is one line with the reason, then the usage; exit 1', async () => {
    const { value, lines, codes } = io();
    await main(['all', 'jobs'], value);
    expect(lines[0]).toMatch(new RegExp(`^${NAME}: expects one argument, the domains`));
    expect(lines.slice(1)).toEqual([USAGE]);
    expect(codes).toEqual([1]);
  });
});

describe('the npm manifest', () => {
  const manifest = (dir: string) => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

  // That its dependencies are exactly the third-party packages core and the servers import:
  // __tests__/dependency-manifests.guard.test.ts (BUNDLES).
  it('keeps core and the servers as devDependencies: the bundle carries them', () => {
    const dev = Object.keys(manifest('packages/bconnect-mcp').devDependencies ?? {});
    expect(dev).toEqual(expect.arrayContaining(['@bconnect/mcp-core', ...SERVERS]));
  });
});

describe('chosenDomains', () => {
  it.for([
    ['endpoints', ['endpoints'], true],
    ['jobs,Endpoints', ['endpoints', 'jobs'], true],
    [' jobs , jobs ,', ['jobs'], true],
    ['all', [...DOMAINS], false],
    ['ALL', [...DOMAINS], false],
  ] as const)('%s → %j', ([arg, domains, named]) => {
    expect(chosenDomains([arg])).toEqual({ domains, named });
  });

  it.for([
    [[], /expects one argument/],
    [['endpoints', 'jobs'], /expects one argument/],
    [[' '], /the domains argument is empty/],
    [['foo'], /domains="foo" isn't valid: "foo" is not a domain/],
    [['all,jobs'], /all stands alone/],
  ] as const)('refuses %j', ([args, message]) => {
    expect(() => chosenDomains(args)).toThrow(message);
  });
});

interface Started { serverName?: string; tools: string[]; lines: string[]; exitCode?: number }

/** Starts `arg` through core's startup routine; the stdio server is connected to an in-memory client. */
async function start(arg: string, release: (typeof RELEASES)[number]): Promise<Started> {
  const env = { ...guardEnv(release, { writes: false, secretRead: false }), BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };
  Object.assign(process.env, env);
  const lines: string[] = [];
  let connected: Server | undefined;
  let exitCode: number | undefined;
  const io: StartupIo = {
    env: process.env,
    error: (line) => { lines.push(line); },
    exit: (code) => { exitCode = code; return undefined as never; },
    connectStdio: async (server) => { connected = server; },
  };
  await main([arg], io);
  if (!connected) {return { tools: [], lines, exitCode };}
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'package-test', version: '0' });
  await Promise.all([connected.connect(serverSide), client.connect(clientSide)]);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const serverName = client.getServerVersion()?.name;
  await client.close();
  return { serverName, tools, lines, exitCode };
}

/** The tool names a domain server lists by itself. */
async function ownTools(domain: string): Promise<string[]> {
  const conn = await connect(`bconnect-${domain}-mcp`);
  const names = conn.tools.map((tool) => tool.name);
  await conn.close();
  return names;
}

describe.each(RELEASES)('started in %s', (release) => {
  it('one domain is that domain\'s own server', async () => {
    const started = await start('endpoints', release);
    expect(started.exitCode).toBeUndefined();
    expect(started.serverName).toBe('bconnect-endpoints-mcp');
    expect(started.tools).toEqual(await ownTools('endpoints'));
    expect(started.lines).toContain(`${NAME} started on stdio`);
  });

  it('several domains are one server with the tools of each, in domain order', async () => {
    const started = await start('jobs,endpoints', release);
    expect(started.serverName).toBe(NAME);
    expect(started.tools).toEqual([...await ownTools('endpoints'), ...await ownTools('jobs')]);
  });

  it('all lists every domain\'s tools; a domain without tools in the release adds none', async () => {
    const started = await start('all', release);
    expect(started.exitCode).toBeUndefined();
    const expected: string[] = [];
    for (const domain of DOMAINS) {expected.push(...await ownTools(domain));}
    expect(started.tools).toEqual(expected);
    expect(started.tools.length).toBeGreaterThanOrEqual(100);
  });
});

it('a domain named on its own without tools in the release stops the start', async () => {
  const started = await start('compliance,jobs', '25R2');
  expect(started.exitCode).toBe(1);
  expect(started.lines.at(-1)).toBe(
    `${NAME}: the domain compliance has no tools in bMS 25R2: none of its APIs exist in that release. Choose other domains, or all.`,
  );
});

it('two such domains are named together', async () => {
  const started = await start('universaldynamicgroups,compliance', '25R2');
  expect(started.exitCode).toBe(1);
  expect(started.lines.at(-1)).toBe(
    `${NAME}: the domains compliance, universaldynamicgroups have no tools in bMS 25R2: none of their APIs exist in that release. Choose other domains, or all.`,
  );
});

describe('the built command', () => {
  const cli = join(ROOT, 'packages', 'bconnect-mcp', 'build', 'cli.js');
  const env = { PATH: process.env.PATH ?? '', BCONNECT_BASE_URL: 'https://bms.example.test/bconnect', BCONNECT_API_KEY: 'package-test-key', BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };

  it('answers initialize on its first stdout line', async () => {
    const child = spawn(process.execPath, [cli, 'endpoints,jobs'], { env, cwd: ROOT });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`);
    const first = await new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        out += chunk;
        if (out.includes('\n')) {resolve(out.split('\n')[0]);}
      });
      child.once('exit', (code) => reject(new Error(`exited ${code} before answering`)));
    });
    child.kill();
    expect(JSON.parse(first)).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: NAME } } });
  });

  it('exits 1 on a wrong argument, with the reason on stderr and nothing on stdout', () => {
    const result = spawnSync(process.execPath, [cli, 'foo'], { env, cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`${NAME}: domains="foo" isn't valid`);
  });
});
