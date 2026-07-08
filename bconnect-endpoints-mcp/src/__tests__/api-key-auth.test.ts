/**
 * API-key authentication tests — GitHub issue #58
 *
 * Field report (BAGHUS GmbH, EAP): authenticating the MCP server with an API key
 * fails, while the *same* key succeeds via raw HTTP (`Invoke-WebRequest`) and the
 * n8n connector on the same host. Username+password works as a fallback.
 *
 * Auth is wired in the shared `BConnectClientBase.setupAuth()` (in @bconnect/mcp-core),
 * which every server's `BConnectClient` extends unchanged — so testing the base here
 * covers all 13 servers. These tests pin the expected on-the-wire behaviour:
 *
 *   - apiKey set                → request carries `X-Api-Key: <key>`, no `Authorization`
 *   - username/password only    → request carries `Authorization: Basic <b64>`, no `X-Api-Key`
 *   - both set                  → apiKey wins; no Basic `Authorization` leaks alongside it
 *
 * Headers are captured from the actual outgoing request via MSW, so this exercises
 * the real axios request path (default headers + per-request merging), not just the
 * client's configured defaults.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClientBase, type BConnectConfig } from '@bconnect/mcp-core';

const BASE_URL = 'https://bms.test.local/bconnect';

/**
 * Exposes a single real request so the test can inspect the headers the client
 * actually sends. `client` is `protected` on the base, hence the subclass.
 */
class ProbeClient extends BConnectClientBase {
  async probe(): Promise<void> {
    await this.client.get('/probe');
  }
}

let capturedHeaders: Headers | null = null;

const server = setupServer(
  http.get(`${BASE_URL}/probe`, ({ request }) => {
    capturedHeaders = request.headers;
    return HttpResponse.json({ ok: true });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  capturedHeaders = null;
});
afterAll(() => server.close());

function makeClient(cfg: Partial<BConnectConfig>): ProbeClient {
  // disableHttpsAgent lets MSW intercept the request in Node.
  return new ProbeClient({ baseUrl: BASE_URL, disableHttpsAgent: true, ...cfg });
}

describe('API-key authentication (GitHub #58)', () => {
  it('sends X-Api-Key and NOT Authorization when an apiKey is configured', async () => {
    await makeClient({ apiKey: 'secret-key-123' }).probe();

    expect(capturedHeaders?.get('x-api-key')).toBe('secret-key-123');
    expect(capturedHeaders?.get('authorization')).toBeNull();
  });

  it('sends Basic Authorization and NOT X-Api-Key with username/password only', async () => {
    await makeClient({ username: 'admin', password: 'pw' }).probe();

    const expected = 'Basic ' + Buffer.from('admin:pw').toString('base64');
    expect(capturedHeaders?.get('authorization')).toBe(expected);
    expect(capturedHeaders?.get('x-api-key')).toBeNull();
  });

  it('prefers apiKey over username/password when both are set (no Basic leak)', async () => {
    await makeClient({
      apiKey: 'secret-key-123',
      username: 'admin',
      password: 'pw',
    }).probe();

    expect(capturedHeaders?.get('x-api-key')).toBe('secret-key-123');
    // Regression guard for #58: a stray Basic header must not shadow the key.
    expect(capturedHeaders?.get('authorization')).toBeNull();
  });
});
