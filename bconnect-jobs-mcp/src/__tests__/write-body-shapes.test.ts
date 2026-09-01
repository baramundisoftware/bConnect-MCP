/**
 * What the write arms actually put on the wire.
 *
 * ── Why these exist (TOOL-REVIEW-MATRIX.md, findings H1–H3) ─────────────────
 * Three write tools advertised one thing and transmitted another, and every
 * layer looked fine on its own:
 *
 *   update_job_folder    sent the raw `{id,name,comment}` args object as the
 *                        body of a route whose only content type is
 *                        `application/json-patch+json` — an array of
 *                        operations. The MODULE's own test asserts exactly
 *                        that contract, which is why a module-level test
 *                        could never catch the dispatch arm violating it.
 *   create_kiosk_release advertised `targetId`; the body schema requires
 *                        `assignmentTargetId`, so the required key was never
 *                        sent under its right name on any call.
 *   create_job_instance  advertised `scheduledStartTime`, a field the body
 *                        schema does not declare — bConnect answers 200 and
 *                        drops the key (D6), so a model believed a deployment
 *                        deferred that was not.
 *
 * So these drive the REAL handler over InMemoryTransport and read the REAL
 * request body off a mock transport (msw) — per the project rule that a unit
 * test of a helper proves nothing about whether the tool calls it.
 *
 * Falsified: all of them fail against the pre-fix dispatch (the defects
 * above), and were watched failing before the fix was trusted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const JOBS = `${BASE_URL}/jobs/v2.0`;

const FOLDER_ID = 'E57A7E00-0000-4000-8000-000000000004';
const JOB_DEF_ID = 'e57a7e00-0000-4000-8000-000000000017';
const ENDPOINT_ID = 'e57a7e00-0000-4000-8000-000000000038';
const TARGET_ID = 'E57A7E00-0000-4000-8000-000000000005';

/** The last body each route received, reset per test. */
let captured: { folderPatch?: unknown; kioskRelease?: unknown; jobInstance?: unknown } = {};

const mockApi = setupServer(
  http.patch(`${JOBS}/Folders/:id`, async ({ request }) => {
    captured.folderPatch = await request.json();
    return HttpResponse.json({ id: FOLDER_ID, name: 'New name', comment: 'New comment', parentId: null, parent: null });
  }),
  http.post(`${JOBS}/KioskReleases`, async ({ request }) => {
    captured.kioskRelease = await request.json();
    return HttpResponse.json({ id: TARGET_ID, jobDefinitionId: JOB_DEF_ID });
  }),
  http.post(`${JOBS}/JobInstances`, async ({ request }) => {
    captured.jobInstance = await request.json();
    return HttpResponse.json({ id: TARGET_ID, jobDefinitionId: JOB_DEF_ID, endpointId: ENDPOINT_ID });
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
  captured = {};
  mockApi.resetHandlers();
});

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'write-body-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('update_job_folder sends a JSON-Patch array, not the args object', () => {
  it('builds replace operations for the fields the caller passed', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'update_job_folder',
      arguments: { id: FOLDER_ID, name: 'New name', comment: 'New comment' },
    });
    expect(result.isError).toBeFalsy();

    // The whole defect: the body must be the ARRAY OF OPERATIONS, never the
    // target resource shape. (jobs-module-writes.test.ts asserts the same
    // contract of the module; this asserts it of the arm that calls it.)
    expect(Array.isArray(captured.folderPatch), `body was not an array: ${JSON.stringify(captured.folderPatch)}`).toBe(true);
    const ops = captured.folderPatch as Array<{ op: string; path: string; value: unknown }>;
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.op === 'replace')).toBe(true);
    expect(new Map(ops.map((o) => [o.path, o.value]))).toEqual(
      new Map([['/name', 'New name'], ['/comment', 'New comment']])
    );
  });

  it('omits the field the caller did not pass, rather than nulling it', async () => {
    const client = await connect();
    await client.callTool({ name: 'update_job_folder', arguments: { id: FOLDER_ID, name: 'Only name' } });
    const ops = captured.folderPatch as Array<{ path: string }>;
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.map((o) => o.path)).toEqual(['/name']);
  });

  it('refuses an id-only call instead of sending an empty patch', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'update_job_folder', arguments: { id: FOLDER_ID } })
    ).rejects.toThrow(/name|comment/i);
    // And nothing reached the wire — an empty patch is not a smaller defect,
    // it is a request that changes nothing while reporting success.
    expect(captured.folderPatch).toBeUndefined();
  });
});

describe('create_kiosk_release transmits the required key under its right name', () => {
  it('sends assignmentTargetId exactly as the body schema requires', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'create_kiosk_release',
      arguments: { jobDefinitionId: JOB_DEF_ID, assignmentTargetId: TARGET_ID },
    });
    expect(result.isError).toBeFalsy();
    expect(captured.kioskRelease).toEqual({ jobDefinitionId: JOB_DEF_ID, assignmentTargetId: TARGET_ID });
  });
});

describe('create_job_instance carries only fields the body schema declares', () => {
  it('sends exactly jobDefinitionId and endpointId', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'create_job_instance',
      arguments: { jobDefinitionId: JOB_DEF_ID, endpointId: ENDPOINT_ID },
    });
    expect(result.isError).toBeFalsy();
    expect(captured.jobInstance).toEqual({ jobDefinitionId: JOB_DEF_ID, endpointId: ENDPOINT_ID });
  });

  it('refuses scheduledStartTime — the field the body schema never declared', async () => {
    // Pre-fix, this parameter was ADVERTISED, accepted, sent, and silently
    // dropped by bConnect (D6) — a deployment the model believed deferred was
    // not. The honest shape is refusal before dispatch.
    const client = await connect();
    await expect(
      client.callTool({
        name: 'create_job_instance',
        arguments: { jobDefinitionId: JOB_DEF_ID, endpointId: ENDPOINT_ID, scheduledStartTime: '2026-09-01T00:00:00Z' },
      })
    ).rejects.toThrow(/scheduledStartTime/);
    expect(captured.jobInstance).toBeUndefined();
  });

  it('declares endpointId required, as the spec does', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'create_job_instance');
    expect(tool?.inputSchema?.required).toContain('endpointId');
    expect(tool?.inputSchema?.required).toContain('jobDefinitionId');
    expect(Object.keys(tool?.inputSchema?.properties ?? {})).not.toContain('scheduledStartTime');
  });
});
