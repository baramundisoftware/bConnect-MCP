/**
 * Job write tools send what the API declares and report what happened
 * (REQ-XC-003; #175, #178, job part of #172).
 *
 * The jobs server runs through createServer(); MSW answers as the 26R1 spec
 * declares, including the 207 problem report a group assignment returns.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const JOB = '11111111-1111-4111-8111-111111111111';
const ENDPOINT = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const TARGET = '44444444-4444-4444-8444-444444444444';
const FOLDER = '55555555-5555-4555-8555-555555555555';

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[] = [];

const PROBLEM_207 = {
  type: 'https://tools.ietf.org/html/rfc4918#section-11.1',
  title: 'Multi-Status',
  status: 207,
  detail: '1 of 3 assignments failed',
  failedAssignments: [{ endpointId: ENDPOINT, reason: 'Endpoint is offline' }],
};

const msw = setupServer(
  http.all('*', async ({ request }) => {
    const url = new URL(request.url);
    const text = await request.text();
    sent.push({ method: request.method, path: url.pathname.replace(/^\/bconnect/, ''), body: text ? JSON.parse(text) : undefined });
    if (url.pathname.endsWith('/AssignJobDefinition')) return HttpResponse.json(PROBLEM_207, { status: 207 });
    if (url.pathname.endsWith('/JobInstances')) return HttpResponse.json({ id: 'instance-1', jobDefinitionId: JOB, endpointId: ENDPOINT }, { status: 201 });
    if (url.pathname.endsWith('/KioskReleases')) return HttpResponse.json({ id: 'release-1' }, { status: 201 });
    if (url.pathname.includes('/Folders/')) return HttpResponse.json({ id: FOLDER, name: 'Renamed' });
    return HttpResponse.json({});
  }),
);

let client: Client;
const saved = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.jobs.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-jobs-mcp/src/index.ts');
  const { server } = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'job-write-tools', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterEach(() => { sent = []; });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

async function call(name: string, args: Record<string, unknown>) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  } catch (e) {
    return { isError: true, text: String((e as Error).message) };
  }
}

const tool = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name)!;

describe('create_job_instance (#175)', () => {
  it('no longer offers scheduledStartTime, requires endpointId and says the job starts at once', async () => {
    const t = await tool('create_job_instance');
    expect(Object.keys(t.inputSchema.properties ?? {}).sort()).toEqual(['endpointId', 'jobDefinitionId', 'startIfAlreadyAssigned']);
    expect(t.inputSchema.required?.slice().sort()).toEqual(['endpointId', 'jobDefinitionId']);
    expect(t.description).toMatch(/starts? (immediately|as soon as)/i);
  });

  it('sends exactly the fields the API declares', async () => {
    await call('create_job_instance', { jobDefinitionId: JOB, endpointId: ENDPOINT });
    expect(sent).toEqual([{ method: 'POST', path: '/jobs/v2.0/JobInstances', body: { jobDefinitionId: JOB, endpointId: ENDPOINT } }]);
    await call('create_job_instance', { jobDefinitionId: JOB, endpointId: ENDPOINT, startIfAlreadyAssigned: true });
    expect(sent[1].body).toEqual({ jobDefinitionId: JOB, endpointId: ENDPOINT, startIfAlreadyAssigned: true });
  });
});

describe('create_kiosk_release (#175)', () => {
  it('requires assignmentTargetId and jobDefinitionId and sends them under the API names', async () => {
    const t = await tool('create_kiosk_release');
    expect(t.inputSchema.required?.slice().sort()).toEqual(['assignmentTargetId', 'jobDefinitionId']);
    await call('create_kiosk_release', { jobDefinitionId: JOB, assignmentTargetId: TARGET });
    expect(sent).toEqual([{ method: 'POST', path: '/jobs/v2.0/KioskReleases', body: { assignmentTargetId: TARGET, jobDefinitionId: JOB } }]);
  });
});

describe('update_job_folder (#175)', () => {
  it('sends a JSON Patch built from the given fields', async () => {
    await call('update_job_folder', { id: FOLDER, name: 'Renamed', comment: 'x' });
    expect(sent).toEqual([{
      method: 'PATCH', path: `/jobs/v2.0/Folders/${FOLDER}`,
      body: [{ op: 'replace', path: '/name', value: 'Renamed' }, { op: 'replace', path: '/comment', value: 'x' }],
    }]);
  });

  it('refuses a call that changes nothing, before any request', async () => {
    const r = await call('update_job_folder', { id: FOLDER });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/name|comment/);
    expect(sent).toEqual([]);
  });
});

describe.each([
  ['assign_job_to_logical_group', 'logicalGroupId', 'LogicalGroups'],
  ['assign_job_to_static_group', 'staticGroupId', 'StaticGroups'],
  ['assign_job_to_dynamic_group', 'dynamicGroupId', 'DynamicGroups'],
  ['assign_job_to_universal_dynamic_group', 'universalDynamicGroupId', 'UniversalDynamicGroups'],
])('%s', (name, idArg, segment) => {
  it('sends only the assignment fields; the group id stays in the path (#175)', async () => {
    await call(name, { [idArg]: GROUP, jobDefinitionId: JOB });
    expect(sent).toEqual([{ method: 'POST', path: `/jobs/v2.0/${segment}/${GROUP}/AssignJobDefinition`, body: { jobDefinitionId: JOB } }]);
  });

  it('reports a 207 as partial success and passes the failures on (#172)', async () => {
    const r = await call(name, { [idArg]: GROUP, jobDefinitionId: JOB });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/partially succeeded/i);
    expect(r.text).toContain('1 of 3 assignments failed');
    expect(r.text).toContain('Endpoint is offline');
    expect(r.text).not.toMatch(/undefined/);
  });

  it('says how far the assignment reaches (#178)', async () => {
    const t = await tool(name);
    expect(t.description).toMatch(/every (member|endpoint)/i);
    expect(t.description).toMatch(/starts? unless/i);
    expect(t.description).toMatch(/confirm/i);
    if (name === 'assign_job_to_logical_group') expect(t.description).toMatch(/sub-?groups/i);
  });
});
