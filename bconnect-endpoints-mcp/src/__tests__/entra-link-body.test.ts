/**
 * link_entra_id_data transmits the parameters it advertises.
 *
 * ── Why this exists (TOOL-REVIEW-MATRIX.md, finding H4) ─────────────────────
 * The tool advertised the three spec-correct fields (entraIdDeviceId,
 * entraIdTenantId, entraIdUserId) — and no code path read any of them. The
 * dispatch arm forwarded `args!.deviceId`, a parameter the schema never
 * declared: always undefined, and unreachable by a caller because the
 * unknown-parameter validator refuses undeclared keys before dispatch. The
 * module then posted `{ deviceId }`, a property the 26R1 request schema
 * rejects (`EntraIdEndpointDataForCreation`, additionalProperties: false).
 * Net effect: every "successful" call sent an empty body.
 *
 * Rule I in descriptions-match-routes.test.ts now catches the
 * read-of-undeclared statically; this test pins the runtime half — what the
 * wire actually carries — through the REAL handler over InMemoryTransport.
 *
 * Falsified: against the pre-fix dispatch the captured body is `{}` (the
 * undefined deviceId serializes away), and this file was watched failing
 * before the fix was trusted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const ENDPOINT_ID = 'e57a7e00-0000-4000-8000-000000000027';
const ENTRA_DEVICE = 'e57a7e00-0000-4000-8000-000000000035';
const ENTRA_TENANT = 'e57a7e00-0000-4000-8000-000000000041';
const ENTRA_USER = 'e57a7e00-0000-4000-8000-000000000043';

let capturedBody: unknown;
let capturedPathId: string | undefined;

const mockApi = setupServer(
  http.post(`${BASE_URL}/endpoints/v2.0/Endpoints/:id/EntraIdData`, async ({ request, params }) => {
    capturedBody = await request.json();
    capturedPathId = params.id as string;
    return HttpResponse.json({
      entraIdDeviceId: ENTRA_DEVICE,
      entraIdTenantId: ENTRA_TENANT,
      entraIdUserId: ENTRA_USER,
    });
  }),
);

let savedGate: string | undefined;
beforeAll(() => {
  savedGate = process.env.ALLOW_WRITE_OPERATIONS;
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  mockApi.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  process.env.ALLOW_WRITE_OPERATIONS = savedGate ?? '';
  mockApi.close();
});
afterEach(() => {
  capturedBody = undefined;
  capturedPathId = undefined;
  mockApi.resetHandlers();
});

describe('link_entra_id_data puts the advertised identifiers on the wire', () => {
  it('posts exactly the entraId* fields the schema declares, to the endpoint path', async () => {
    const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'entra-link-probe', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'link_entra_id_data',
      arguments: {
        endpointId: ENDPOINT_ID,
        entraIdDeviceId: ENTRA_DEVICE,
        entraIdTenantId: ENTRA_TENANT,
        entraIdUserId: ENTRA_USER,
      },
    });
    expect(result.isError).toBeFalsy();

    expect(capturedPathId).toBe(ENDPOINT_ID);
    // The whole defect: pre-fix this body was {} — deviceId (undefined)
    // serialized away and the three real identifiers were read by nothing.
    expect(capturedBody).toEqual({
      entraIdDeviceId: ENTRA_DEVICE,
      entraIdTenantId: ENTRA_TENANT,
      entraIdUserId: ENTRA_USER,
    });
  });
});
