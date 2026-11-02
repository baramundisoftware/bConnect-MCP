/**
 * The mock-integration tier has one helper module and skips visibly (#336).
 *
 * The 13 servers each had a copy of the mock helpers; the copies preferred
 * the real BCONNECT_* settings over the mock and turned certificate checks
 * off, and a test without the mock returned early, so vitest counted it
 * passed. Now every mock test imports __tests__/lib/mock-integration.ts,
 * skips with ctx.skip() when the mock is missing, and fails instead when
 * MOCK_REQUIRED=true.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVERS } from './lib/exerciser.js';
import { mockAvailable, mockClientConfig } from './lib/mock-integration.js';

const SHARED = "from '../../../../__tests__/lib/mock-integration.js'";
const dirOf = (server: string) => join(ROOT, server, 'src', '__tests__', 'mock-integration');
const testsOf = (server: string) => readdirSync(dirOf(server)).filter((f) => f.endsWith('.mock.test.ts'));
const read = (server: string, file: string) => readFileSync(join(dirOf(server), file), 'utf8').replace(/\r\n/g, '\n');

describe('mock-integration tests: one helper module', () => {
  it.each(SERVERS)('%s has mock tests and no helper module of its own', (server) => {
    const files = readdirSync(dirOf(server));
    expect(testsOf(server).length).toBeGreaterThan(0);
    expect(files.filter((f) => !f.endsWith('.mock.test.ts'))).toEqual([]);
  });

  it.each(SERVERS)('%s imports the shared helper, reads no real BCONNECT_* setting and keeps certificate checks on', (server) => {
    for (const file of testsOf(server)) {
      const source = read(server, file);
      expect(source, file).toContain(SHARED);
      expect(source.match(/process\.env\.BCONNECT_(?!RELEASE\b)\w+/g) ?? [], file).toEqual([]);
      expect(source, file).not.toMatch(/rejectUnauthorized:\s*false/);
    }
  });

  it.each(SERVERS)('%s skips a test without the mock instead of returning early', (server) => {
    for (const file of testsOf(server)) {
      const source = read(server, file);
      expect(source, file).toMatch(/available = await mockAvailable\('[a-z]+'\);/);
      // One early return, in beforeAll; inside a test it would count as passed.
      expect(source.split('if (!available) {return;}').length - 1, file).toBe(1);
      expect(source, file).toMatch(/if \(!available\) \{ctx\.skip\(\);\}/);
    }
  });
});

describe('__tests__/lib/mock-integration.ts', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  /** A URL nothing listens on: a port that was free a moment ago. */
  async function closedUrl(): Promise<string> {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return `http://127.0.0.1:${port}`;
  }

  it('without the mock: false and a warning naming the server, so its tests skip', async () => {
    vi.stubEnv('MOCK_REQUIRED', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const url = await closedUrl();
    await expect(mockAvailable('endpoints', url)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(`⚠  bConnect-Mock not reachable at ${url} — endpoints mock tests skipped`);
  });

  it('without the mock and MOCK_REQUIRED=true: fails', async () => {
    vi.stubEnv('MOCK_REQUIRED', 'true');
    const url = await closedUrl();
    await expect(mockAvailable('endpoints', url)).rejects.toThrow(`bConnect-Mock not reachable at ${url} and MOCK_REQUIRED=true: endpoints mock tests can't run`);
  });

  it('with the mock: true', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok","bmsVersion":"26r1"}'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      vi.stubEnv('MOCK_REQUIRED', 'true');
      await expect(mockAvailable('endpoints', `http://127.0.0.1:${port}`)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('client settings: the mock URL and test credentials, whatever BCONNECT_* says, certificate checks on', () => {
    vi.stubEnv('BCONNECT_BASE_URL', 'https://bms.example');
    vi.stubEnv('BCONNECT_USERNAME', 'real-user');
    vi.stubEnv('BCONNECT_PASSWORD', 'real-password');
    const config = mockClientConfig('http://127.0.0.1:13433');
    expect(config).toEqual({ baseUrl: 'http://127.0.0.1:13433', username: 'integration-test', password: 'integration-test', timeout: 10000 });
    expect(config.rejectUnauthorized).toBeUndefined();
  });
});
