/**
 * The software server's startup check doesn't depend on a slow route (#202).
 *
 * On bMS 26.1.161, GET /software/v2.0/InstalledWindowsSoftware answered after a
 * constant 30 s, so the startup check timed out and the server exited. 26R1
 * has lighter list routes; 25R2 has only InstalledWindowsSoftware. The probe
 * therefore follows BCONNECT_RELEASE: /Bundles on 26R1, InstalledWindowsSoftware
 * on 25R2.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { delay, http, HttpResponse } from 'msw';
import { BConnectClient } from '../bconnect-software-mcp/src/bconnect-client.js';

const BASE = 'http://bms.software-probe.test/bconnect';
const sent: string[] = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  const path = new URL(request.url).pathname;
  sent.push(path);
  if (path.endsWith('/InstalledWindowsSoftware')) {await delay('infinite');}
  return HttpResponse.json({ data: [], totalItems: 0, hasNextPage: false });
}));

const savedRelease = process.env.BCONNECT_RELEASE;
const savedSkip = process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;
beforeAll(() => {
  delete process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;
  msw.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => { sent.length = 0; });
afterAll(() => {
  msw.close();
  if (savedRelease === undefined) {delete process.env.BCONNECT_RELEASE;} else {process.env.BCONNECT_RELEASE = savedRelease;}
  if (savedSkip !== undefined) {process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK = savedSkip;}
});

const client = () => new BConnectClient({ baseUrl: BASE, apiKey: 'k', timeout: 1500 });

describe('software startup check (#202)', () => {
  it('probes /Bundles on 26R1 and starts although InstalledWindowsSoftware never answers', async () => {
    process.env.BCONNECT_RELEASE = '26R1';
    expect(await client().testConnection()).toBe(true);
    expect(sent).toEqual(['/bconnect/software/v2.0/Bundles']);
  });

  it('probes InstalledWindowsSoftware on 25R2, the only list route that release has', async () => {
    process.env.BCONNECT_RELEASE = '25R2';
    expect(await client().testConnection()).toBe(false); // never answers here: the check times out
    expect(sent).toEqual(['/bconnect/software/v2.0/InstalledWindowsSoftware']);
  });

  it('defaults to 26R1 when BCONNECT_RELEASE is unset', async () => {
    delete process.env.BCONNECT_RELEASE;
    expect(await client().testConnection()).toBe(true);
    expect(sent).toEqual(['/bconnect/software/v2.0/Bundles']);
  });
});
