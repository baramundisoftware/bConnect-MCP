/**
 * M5, end to end through the real client stack.
 *
 * The unit tests in `__tests__/suite-absent-empty-zero.test.ts` prove the
 * policy's own behaviour. They do NOT prove the thing most likely to be wrong:
 * that a real 404 from this route arrives at `readSubResource` as a
 * `BConnectApiError` at all. `ComplianceModule` is handed a bare
 * `AxiosInstance`, and the conversion happens in an interceptor installed by
 * `BConnectClientBase` — so the catch fires only if the module is holding the
 * INTERCEPTED client. Inspection says it is (`bconnect-client.ts` passes
 * `this.client`); inspection is not evidence.
 *
 * So this drives the real `BConnectClient` against a real socket. No stubbed
 * axios, no hand-built error: the 404 travels the same interceptor path a live
 * one does. The response body is the one the production estate actually
 * returned for WIN10CLIENT3 on 2026-08-03, copied verbatim including the
 * `traceId` shape:
 *
 *   {"type":"https://httpstatuses.io/404","title":"Not Found","status":404,
 *    "traceId":"00-dad2fd4db696789e08e289057908f2ac-221ba87d7e0dcae4-00"}
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BConnectClient } from '../bconnect-client.js';
import { isDataUnavailable } from '@bconnect/mcp-core';

const LIVE_404_BODY = JSON.stringify({
  type: 'https://httpstatuses.io/404',
  title: 'Not Found',
  status: 404,
  traceId: '00-dad2fd4db696789e08e289057908f2ac-221ba87d7e0dcae4-00',
});

/** WIN10CLIENT3 — a present, managed Windows endpoint that answers 404. */
const NO_DATA_ID = 'e57a7e00-0000-4000-8000-000000000012';
/** WIN10CLIENT4 — answers 200 with totalItems 1. */
const HAS_DATA_ID = 'e57a7e00-0000-4000-8000-000000000006';

let server: Server;
let client: BConnectClient;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url.includes(NO_DATA_ID)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(LIVE_404_BODY);
      return;
    }
    if (url.includes(HAS_DATA_ID)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ totalItems: 1, totalPages: 1, data: [{ cveId: 'CVE-2026-0001' }] }));
      return;
    }
    // Anything else — including the startup health check — answers 200 so the
    // test exercises the route under test and nothing else.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ totalItems: 0, totalPages: 1, data: [] }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  client = new BConnectClient({
    baseUrl: `http://127.0.0.1:${port}`,
    username: 'test@example.com',
    password: 'not-a-real-secret',
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('list_detected_vulnerabilities_by_endpoint — the 404 policy on the real client', () => {
  it('turns the live 404 into an explicit unavailable result, not an error and not a zero', async () => {
    const result = await client.compliance.getDetectedVulnerabilitiesByEndpoint(NO_DATA_ID);

    // Before M5 this threw, and the message read "Resource not found." — whose
    // most dangerous reading is "nothing found, therefore zero".
    expect(isDataUnavailable(result)).toBe(true);
  });

  it('does not report a count of zero for a machine we know nothing about', async () => {
    const result = await client.compliance.getDetectedVulnerabilitiesByEndpoint(NO_DATA_ID);
    if (!isDataUnavailable(result)) { throw new Error('expected the unavailable envelope'); }

    expect(result.totalItems).toBeNull();
    expect(result.totalItems).not.toBe(0);
    expect(result.data).toBeNull();
    expect(result.data).not.toEqual([]);
  });

  it('names the platform possibility rather than asserting "never scanned"', async () => {
    const result = await client.compliance.getDetectedVulnerabilitiesByEndpoint(NO_DATA_ID);
    if (!isDataUnavailable(result)) { throw new Error('expected the unavailable envelope'); }

    // A11: WIN10CLIENT3 and WIN10CLIENT10 are both WindowsEndpoint, so no
    // field distinguishes "never scanned" from the other causes.
    expect(result.possibleCauses.some((c) => /Windows endpoints only/i.test(c))).toBe(true);
    expect(result.possibleCauses.length).toBeGreaterThanOrEqual(4);
  });

  it('still returns real rows for an endpoint that has them', async () => {
    const result = await client.compliance.getDetectedVulnerabilitiesByEndpoint(HAS_DATA_ID);

    expect(isDataUnavailable(result)).toBe(false);
    if (isDataUnavailable(result)) { return; }
    expect(result.totalItems).toBe(1);
    expect(result.data?.[0]?.cveId).toBe('CVE-2026-0001');
  });
});
