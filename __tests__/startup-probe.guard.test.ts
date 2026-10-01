/**
 * Startup-probe guard (REQ-SRV-013, defect #111).
 *
 * Every server's BConnectClient runs testConnection() against MSW; the one
 * request it sends must be a GET list route of the server's own domain that
 * exists in every bundled spec release carrying that domain, and it must ask
 * for a single item via PageSize (bConnect ignores $top).
 *
 * The expected routes come from the specs, not a hand list, so a server that
 * drops its probe route or points it at a route bConnect doesn't have fails here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { RELEASES, findOperation, loadOperations } from './lib/spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'http://bms.probe.test/bconnect';
const BASE_PATH = new URL(BASE_URL).pathname;

const SERVERS = readdirSync(ROOT)
  .filter((d) => /^bconnect-.+-mcp$/.test(d) && existsSync(join(ROOT, d, 'src', 'bconnect-client.ts')))
  .sort();

/** The bConnect domain a server talks to; groups lives on the endpoints API. */
const domainOf = (server: string) => {
  const name = server.replace(/^bconnect-/, '').replace(/-mcp$/, '');
  return name === 'groups' ? 'endpoints' : name;
};

let recorded: URL[] = [];
const msw = setupServer(
  http.all('*', ({ request }) => {
    recorded.push(new URL(request.url));
    return HttpResponse.json([]);
  }),
);

const savedSkip = process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;

beforeAll(() => {
  delete process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;
  msw.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => { recorded = []; });
afterAll(() => {
  msw.close();
  if (savedSkip !== undefined) process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK = savedSkip;
});

async function probe(server: string, healthCheckPath?: string): Promise<{ ok: boolean; requests: URL[] }> {
  const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'bconnect-client.ts')).href);
  const client = new mod.BConnectClient({
    baseUrl: BASE_URL, username: 'probe', password: 'probe', disableHttpsAgent: true,
    ...(healthCheckPath && { healthCheckPath }),
  });
  recorded = [];
  const ok = await client.testConnection();
  return { ok, requests: [...recorded] };
}

it('finds all 13 servers', () => {
  expect(SERVERS).toHaveLength(13);
});

describe.each(SERVERS)('%s startup probe', (server) => {
  const domain = domainOf(server);
  const releases = RELEASES.filter((r) => loadOperations(r).some((op) => op.domain === domain));

  it('sends exactly one GET to its own domain, a route in every spec release with that domain', async () => {
    expect(releases.length).toBeGreaterThan(0);
    const { ok, requests } = await probe(server);
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const path = requests[0].pathname.slice(BASE_PATH.length);
    expect(path.split('/')[1]).toBe(domain);
    for (const release of releases) {
      const op = findOperation(release, 'GET', path);
      expect(op, `${release}: GET ${path} is not in the spec`).toBeDefined();
      expect(op!.path, `${release}: probe must be a list route`).not.toMatch(/\{/);
      expect(op!.queryParams, `${release}: GET ${path} has no PageSize`).toContain('PageSize');
    }
  });

  it('asks for one item with PageSize=1 and sends no $top', async () => {
    const { requests } = await probe(server);
    expect(requests[0]?.searchParams.get('PageSize')).toBe('1');
    expect(requests[0]?.searchParams.has('$top')).toBe(false);
  });

  it('honours config.healthCheckPath', async () => {
    const { requests } = await probe(server, '/custom/v2.0/Probe');
    expect(requests.map((u) => u.pathname)).toEqual([`${BASE_PATH}/custom/v2.0/Probe`]);
  });
});

it('fails without sending a request when a client sets no probe route', async () => {
  const { BConnectClientBase } = await import('@bconnect/mcp-core');
  const client = new BConnectClientBase({ baseUrl: BASE_URL, username: 'probe', password: 'probe', disableHttpsAgent: true });
  recorded = [];
  expect(await client.testConnection()).toBe(false);
  expect(recorded).toEqual([]);
});
