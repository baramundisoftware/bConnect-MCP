/**
 * The family collapse, proved route by route.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * Six per-platform tool families became five tools that take the platform as an
 * enum argument:
 *
 *   list_*_endpoints        (8) → list_endpoints({ type })
 *   get_*_endpoint          (8) → get_endpoint({ type })
 *   delete_*_endpoint       (8) → delete_endpoint({ type })
 *   update_*_endpoint       (7) → update_endpoint({ type })
 *   start_*_enrollment      (4) → start_enrollment({ type })
 *   list_*_by_logical_group (2) → list_endpoints_by_logical_group({ type })
 *
 * plus five industrial tools deleted outright, because 26R1 deleted the API.
 *
 * ── What this file has to establish ─────────────────────────────────────────
 * A collapse is only lossless if every route the old tools reached is still
 * reachable. Asserting the tool ACCEPTS an enum value proves nothing — it could
 * accept `LinuxEndpoint` and call the Windows route. So each case here compares
 * the URL the server actually requested against the path the 26R1 spec declares
 * for that operation, read from the same operation index the schemas were built
 * from. If the two disagree the test fails, whatever the tool said.
 *
 * `create_*_endpoint` is deliberately absent: those six did NOT collapse. See
 * the note in tool-catalogue.ts.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { createServer } from '../index.js';
import { ENDPOINT_TYPES, routeFor } from '../endpoint-types.js';
import { REMOVED_TOOLS } from '../removed-tools.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const MODULE_PREFIX = '/bconnect/endpoints';
const ID = '00000000-0000-4000-8000-000000000000';
const GROUP_ID = 'E57A7E00-0000-4000-8000-000000000004';

interface Seen {
  method: string;
  /** Normalised back to the spec's own template, e.g. `/v2.0/MacEndpoints/{id}`. */
  path: string;
  body?: unknown;
}

let seen: Seen[] = [];

/** `/bconnect/endpoints/v2.0/MacEndpoints/<guid>` → `/v2.0/MacEndpoints/{id}`. */
function normalise(rawPath: string): string {
  return rawPath
    .replace(MODULE_PREFIX, '')
    .replace(GROUP_ID, '{logicalGroupId}')
    .replace(ID, '{id}');
}

const record = async ({ request }: { request: Request }): Promise<Response> => {
  const url = new URL(request.url);
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    body = await request.clone().json().catch(() => undefined);
  }
  seen.push({ method: request.method, path: normalise(url.pathname), body });
  return HttpResponse.json({ totalItems: 0, totalPages: 0, currentPage: 0, data: [] });
};

const mockApi = setupServer(
  http.get(`${BASE_URL}/endpoints/*`, record),
  http.post(`${BASE_URL}/endpoints/*`, record),
  http.patch(`${BASE_URL}/endpoints/*`, record),
  http.delete(`${BASE_URL}/endpoints/*`, record)
);

beforeAll(() => mockApi.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mockApi.close());

const savedWriteGate = process.env.ALLOW_WRITE_OPERATIONS;
beforeEach(() => {
  seen = [];
});
afterEach(() => {
  if (savedWriteGate === undefined) {
    delete process.env.ALLOW_WRITE_OPERATIONS;
  } else {
    process.env.ALLOW_WRITE_OPERATIONS = savedWriteGate;
  }
});

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'family-collapse', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

async function call(name: string, args: Record<string, unknown>): Promise<void> {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  expect(
    result.isError,
    `${name}(${JSON.stringify(args)}) failed: ${JSON.stringify(result.content)}`
  ).not.toBe(true);
}

/** The one request the call made, and the route the spec says it should be. */
function onlyRequest(): Seen {
  expect(seen, 'expected exactly one bConnect request').toHaveLength(1);
  return seen[0];
}

// ───────────────────────────────────────────────────────────────────────────
// Reads
// ───────────────────────────────────────────────────────────────────────────

describe('list_endpoints reaches every route the eight list tools reached', () => {
  it.each([undefined, ...ENDPOINT_TYPES])('type=%s hits the declared route', async (type) => {
    await call('list_endpoints', type === undefined ? {} : { type });
    const expected = routeFor('list', type)!;
    expect(onlyRequest()).toMatchObject({ method: 'GET', path: expected.path });
  });

  it('covers all eight — seven platforms plus the type-agnostic route', () => {
    const paths = new Set(
      [undefined, ...ENDPOINT_TYPES].map((type) => routeFor('list', type)!.path)
    );
    expect(paths.size).toBe(8);
  });
});

describe('get_endpoint reaches every route the eight get tools reached', () => {
  it.each([undefined, ...ENDPOINT_TYPES])('type=%s hits the declared route', async (type) => {
    await call('get_endpoint', type === undefined ? { id: ID } : { id: ID, type });
    expect(onlyRequest()).toMatchObject({ method: 'GET', path: routeFor('get', type)!.path });
  });
});

describe('list_endpoints_by_logical_group reaches the group route of every platform', () => {
  // Five of these seven had no tool at all before: only the Windows one and the
  // type-agnostic one existed. The collapse ADDS capability here.
  const GROUP_TYPES = [undefined, 'WindowsEndpoint', 'LinuxEndpoint', 'MacEndpoint',
    'AndroidEndpoint', 'IOSEndpoint', 'NetworkEndpoint'] as const;

  it.each(GROUP_TYPES)('type=%s hits the declared route', async (type) => {
    await call(
      'list_endpoints_by_logical_group',
      type === undefined ? { logicalGroupId: GROUP_ID } : { logicalGroupId: GROUP_ID, type }
    );
    expect(onlyRequest()).toMatchObject({
      method: 'GET',
      path: routeFor('listByGroup', type)!.path,
    });
  });

  it('refuses UnmanagedEndpoint, which 26R1 gives no group route', async () => {
    const client = await connect();
    await expect(
      client.callTool({
        name: 'list_endpoints_by_logical_group',
        arguments: { logicalGroupId: GROUP_ID, type: 'UnmanagedEndpoint' },
      })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Writes
// ───────────────────────────────────────────────────────────────────────────

describe('the collapsed write families reach every route', () => {
  beforeEach(() => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
  });

  it.each([undefined, ...ENDPOINT_TYPES])('delete_endpoint type=%s', async (type) => {
    await call('delete_endpoint', type === undefined ? { id: ID } : { id: ID, type });
    expect(onlyRequest()).toMatchObject({ method: 'DELETE', path: routeFor('delete', type)!.path });
  });

  const UPDATABLE = ['WindowsEndpoint', 'LinuxEndpoint', 'MacEndpoint', 'AndroidEndpoint',
    'IOSEndpoint', 'NetworkEndpoint'] as const;

  it.each(UPDATABLE)('update_endpoint type=%s', async (type) => {
    await call('update_endpoint', { id: ID, type, displayName: 'Renamed' });
    const request = onlyRequest();
    expect(request).toMatchObject({ method: 'PATCH', path: routeFor('update', type)!.path });
    // A JSON Patch document, not the raw argument object. Three of the seven
    // tools this replaces — Windows, Linux and Mac — posted
    // `{ id, displayName, comment }` to a route whose only content type is
    // application/json-patch+json, so they cannot have worked.
    expect(request.body).toEqual([{ op: 'replace', path: '/displayName', value: 'Renamed' }]);
  });

  it('refuses UnmanagedEndpoint, which has no PATCH route', async () => {
    const client = await connect();
    await expect(
      client.callTool({
        name: 'update_endpoint',
        arguments: { id: ID, type: 'UnmanagedEndpoint', displayName: 'x' },
      })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('refuses an update with nothing to update rather than sending an empty patch', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'update_endpoint', arguments: { id: ID, type: 'MacEndpoint' } })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(seen).toHaveLength(0);
  });

  it('refuses serialNumber for a type whose patch example does not carry it', async () => {
    const client = await connect();
    await expect(
      client.callTool({
        name: 'update_endpoint',
        arguments: { id: ID, type: 'MacEndpoint', serialNumber: 'C02X' },
      })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  const ENROLLABLE = ['WindowsEndpoint', 'MacEndpoint', 'AndroidEndpoint', 'IOSEndpoint'] as const;

  it.each(ENROLLABLE)('start_enrollment type=%s', async (type) => {
    await call('start_enrollment', {
      id: ID,
      type,
      enrollmentMailAddress: 'ops@example.com',
    });
    const request = onlyRequest();
    expect(request).toMatchObject({ method: 'POST', path: routeFor('enroll', type)!.path });
    // ── The defect this collapse fixed ──────────────────────────────────────
    // start_windows_enrollment and start_mac_enrollment advertised
    // `emailRecipient` and posted their whole argument object. No bConnect
    // enrollment schema has a field of that name — all four declare
    // `enrollmentMailAddress` — so the address was dropped and no mail was sent.
    expect(request.body).toEqual({ enrollmentMailAddress: 'ops@example.com' });
  });

  /**
   * ARCH-2 — the enrollment RESPONSE, which nothing asserted until 2026-08-14.
   *
   * The test above pins the request and stops there, which is exactly why the
   * defect survived: `startWindowsEndpointEnrollment` and
   * `startMacEndpointEnrollment` were `Promise<void>`, so the handler's
   * `?? { success: true }` fallback fired on EVERY call and replaced the
   * enrollment artefacts with a sentence asserting success. 353 tests passed
   * over it.
   */
  describe('ARCH-2 — the enrollment body reaches the caller', () => {
    async function callText(name: string, args: Record<string, unknown>): Promise<string> {
      const client = await connect();
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('');
    }

    it('returns the Mac enrollment PROFILE, not a fabricated success', async () => {
      // Six fields, and the QR code is the one a technician scans at the
      // machine. Losing it and being told "enrollment started" is worse than
      // an error, because it reads as confirmation.
      mockApi.use(
        http.post(`${BASE_URL}/endpoints/v2.0/MacEndpoints/*/StartEnrollment`, () =>
          HttpResponse.json({
            fqdn: 'bms.test.local',
            token: 'tok-abc',
            tokenValidUntilUTC: '2026-08-15T00:00:00Z',
            url: 'https://bms.test.local/enroll',
            qrCodeText: 'QR-PAYLOAD',
            qrCodeImageBase64: 'aGVsbG8=',
          })
        )
      );
      const text = await callText('start_enrollment', { id: ID, type: 'MacEndpoint' });
      expect(text).toContain('QR-PAYLOAD');
      expect(text).toContain('tok-abc');
      expect(text).toContain('bms.test.local');
      // The fabrication must be gone, not merely accompanied.
      expect(text).not.toContain('enrollment started');
    });

    it('returns the Windows installCommand, not a fabricated success', async () => {
      mockApi.use(
        http.post(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints/*/StartEnrollment`, () =>
          HttpResponse.json({
            installCommand: 'msiexec /i bMA.msi TOKEN=xyz',
            validUntil: '2026-08-15T00:00:00Z',
          })
        )
      );
      const text = await callText('start_enrollment', { id: ID, type: 'WindowsEndpoint' });
      expect(text).toContain('msiexec /i bMA.msi TOKEN=xyz');
      expect(text).not.toContain('enrollment started');
    });

    it('reports an EMPTY body as accepted-with-no-artefact, never as success', async () => {
      // The route declares a body. If the server sends none anyway, the honest
      // answer is that nothing came back — not the success the response
      // declined to assert.
      mockApi.use(
        http.post(`${BASE_URL}/endpoints/v2.0/MacEndpoints/*/StartEnrollment`, () =>
          HttpResponse.json(null)
        )
      );
      const text = await callText('start_enrollment', { id: ID, type: 'MacEndpoint' });
      expect(text).toContain('accepted');
      expect(text).toMatch(/enrollmentArtifacts["\s:]*null/);
      expect(text).toMatch(/NO body/i);
      expect(text).toMatch(/Do not read this as an enrolled endpoint/i);
      expect(text).not.toMatch(/"success"\s*:\s*true/);
    });
  });

  it('refuses the Android-only enrollment flags for other platforms', async () => {
    const client = await connect();
    await expect(
      client.callTool({
        name: 'start_enrollment',
        arguments: { id: ID, type: 'IOSEndpoint', includeWifiInQrCode: true },
      })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('accepts them for Android and sends them', async () => {
    await call('start_enrollment', {
      id: ID,
      type: 'AndroidEndpoint',
      includeWifiInQrCode: true,
      forceMobileDataOnEnrollment: false,
    });
    expect(onlyRequest().body).toEqual({
      forceMobileDataOnEnrollment: false,
      includeWifiInQrCode: true,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A removed tool explains itself (product decision 4)
// ───────────────────────────────────────────────────────────────────────────

describe('removed tool names', () => {
  beforeEach(() => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
  });

  it('are not advertised, with the gate open', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const removed of Object.keys(REMOVED_TOOLS)) {
      expect(names, `${removed} must not be advertised`).not.toContain(removed);
    }
  });

  it.each(Object.keys(REMOVED_TOOLS))(
    '%s fails with a reason, not a bare "Unknown tool"',
    async (removed) => {
      const client = await connect();
      await expect(
        client.callTool({ name: removed, arguments: {} })
      ).rejects.toMatchObject({
        code: ErrorCode.MethodNotFound,
        message: expect.not.stringContaining('Unknown tool'),
      });
    }
  );

  it('names 26R1 as the reason the industrial tools are gone', async () => {
    const client = await connect();
    await client
      .callTool({ name: 'get_industrial_endpoint', arguments: { id: ID } })
      .then(
        () => {
          throw new Error('expected a rejection');
        },
        (error: { message: string }) => {
          expect(error.message).toContain('26R1 removed the underlying API');
          expect(error.message).toContain('/v2.0/IndustrialEndpoints');
          expect(error.message).toContain('no replacement');
        }
      );
  });

  it('points a collapsed name at its replacement and the type to pass', async () => {
    const client = await connect();
    await client.callTool({ name: 'list_linux_endpoints', arguments: {} }).then(
      () => {
        throw new Error('expected a rejection');
      },
      (error: { message: string }) => {
        expect(error.message).toContain('list_endpoints');
        expect(error.message).toContain("type: 'LinuxEndpoint'");
      }
    );
  });

  it('makes no bConnect request for a removed name', async () => {
    const client = await connect();
    await client
      .callTool({ name: 'delete_industrial_endpoint', arguments: { id: ID } })
      .catch(() => undefined);
    expect(seen, 'a removed tool must not reach the API').toHaveLength(0);
  });

  it('still answers a name that was never a tool with the generic message', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'no_such_tool_ever', arguments: {} })
    ).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound,
      message: expect.stringContaining('Unknown tool'),
    });
  });
});
