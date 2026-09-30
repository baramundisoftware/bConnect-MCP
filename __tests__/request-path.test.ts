/**
 * Canonical request paths in the shared client (REQ-SRV-018, Lock B).
 *
 * Modules build request paths from a route template and GUIDs, so a real path
 * never contains dot segments, backslashes, encoded separators or a query
 * string. The client refuses anything else before it is sent, whichever tool
 * built it and whether or not that tool validated its arguments.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { RequestPathRefusedError, assertCanonicalRequestPath } from '../packages/mcp-core/src/request-path.js';
import { SecretRouteBlockedError } from '../packages/mcp-core/src/secret-routes.js';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = 'variables/v2.0/VariableDefinitions';

const REFUSED: Record<string, string> = {
  'dot-dot segment': `/endpoints/v2.0/Endpoints/../../../${OTHER}`,
  'dot segment': `/endpoints/v2.0/./Endpoints/${ID}`,
  'trailing dot-dot': `/endpoints/v2.0/Endpoints/..`,
  backslash: `/endpoints/v2.0/Endpoints/..\\..\\..\\${OTHER.replace(/\//g, '\\')}`,
  'encoded slash': `/endpoints/v2.0/Endpoints/..%2F..%2F..%2F${OTHER}`,
  'encoded slash, lower case': `/endpoints/v2.0/Endpoints/..%2f..%2f${OTHER}`,
  'encoded dot': `/endpoints/v2.0/Endpoints/%2e%2e/${OTHER}`,
  'encoded backslash': `/endpoints/v2.0/Endpoints/..%5C${OTHER}`,
  'double encoding': `/endpoints/v2.0/Endpoints/..%252F..%252F${OTHER}`,
  'query string': `/endpoints/v2.0/Endpoints/${ID}?PageSize=1000`,
  fragment: `/endpoints/v2.0/Endpoints/${ID}#x`,
};

const ALLOWED = [
  `/endpoints/v2.0/Endpoints/${ID}`,
  `/endpoints/v2.0/Endpoints`,
  `/jobs/v2.0/JobInstances/${ID}/Start`,
  `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}/Secrets`,
  `/endpoints/v2.0/Endpoints/${ID}/EntraIdData`,
];

describe('assertCanonicalRequestPath', () => {
  it.each(Object.entries(REFUSED))('refuses a %s', (_kind, path) => {
    expect(() => assertCanonicalRequestPath(path)).toThrow(RequestPathRefusedError);
  });

  it.each(ALLOWED)('allows %s', (path) => {
    expect(() => assertCanonicalRequestPath(path)).not.toThrow();
  });

  it('does not echo the path in the error', () => {
    expect(() => assertCanonicalRequestPath(REFUSED['dot-dot segment'])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(OTHER) }),
    );
  });
});

describe('the shared client refuses a non-canonical path before sending', () => {
  const sent: string[] = [];
  const msw = setupServer(http.all('*', ({ request }) => {
    const url = new URL(request.url);
    sent.push(`${request.method} ${url.pathname}${url.search}`);
    return HttpResponse.json({ ok: true });
  }));
  const saved = process.env.ALLOW_SECRET_READ;
  const client = () =>
    new BConnectClientBase({ baseUrl: 'http://bms.routes.test/bconnect', username: 'u', password: 'p' }) as unknown as {
      client: { get: (u: string, c?: unknown) => Promise<unknown>; delete: (u: string) => Promise<unknown> };
    };

  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    sent.length = 0;
    if (saved === undefined) delete process.env.ALLOW_SECRET_READ; else process.env.ALLOW_SECRET_READ = saved;
  });
  afterAll(() => msw.close());

  it.each(Object.entries(REFUSED))('%s: nothing goes out', async (_kind, path) => {
    await expect(client().client.get(path)).rejects.toBeInstanceOf(RequestPathRefusedError);
    await expect(client().client.delete(path)).rejects.toBeInstanceOf(RequestPathRefusedError);
    expect(sent).toEqual([]);
  });

  it('still sends canonical paths, with query parameters from params', async () => {
    await client().client.get(`/endpoints/v2.0/Endpoints/${ID}`, { params: { PageSize: 1 } });
    expect(sent).toEqual([`GET /bconnect/endpoints/v2.0/Endpoints/${ID}?PageSize=1`]);
  });

  it('leaves the secret-route refusal to the secret gate', async () => {
    process.env.ALLOW_SECRET_READ = '';
    await expect(
      client().client.get(`/endpoints/v2.0/Endpoints/../../../defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`),
    ).rejects.toBeInstanceOf(SecretRouteBlockedError);
    expect(sent).toEqual([]);
  });
});
