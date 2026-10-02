/**
 * Job-instance tools filter by date (#179 AC 2).
 *
 * `LastAction` takes an ISO 8601 date with an optional `lt`/`gt` prefix, as the
 * API documents; the value reaches bConnect unchanged, and the description
 * says how to write it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const J = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FILTER = 'gt 2026-09-30T00:00:00Z';

let sent: Array<{ path: string; query: Record<string, string> }> = [];
const msw = setupServer(http.get('*', ({ request }) => {
  const url = new URL(request.url);
  sent.push({ path: url.pathname.replace(/^\/bconnect/, ''), query: Object.fromEntries(url.searchParams) });
  return HttpResponse.json({ data: [] });
}));

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.filters.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: '', ALLOW_SECRET_READ: '',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-jobs-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'job-instance-filters', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
afterEach(() => { sent = []; });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

describe.each([
  ['list_job_instances', {}, '/jobs/v2.0/JobInstances'],
  ['list_job_instances_by_logical_group', { logicalGroupId: G }, `/jobs/v2.0/LogicalGroups/${G}/JobInstances`],
  ['list_endpoint_job_instances', { endpointId: G }, `/jobs/v2.0/Endpoints/${G}/JobInstances`],
])('%s', (name, path, route) => {
  it('sends LastAction unchanged', async () => {
    const r = await client.callTool({ name, arguments: { ...path, LastAction: FILTER } });
    expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
    expect(sent).toEqual([{ path: route, query: { LastAction: FILTER } }]);
  });

  it('says how to write the date filter', async () => {
    const t = (await client.listTools()).tools.find((x) => x.name === name)!;
    const d = String((t.inputSchema.properties as Record<string, { description?: string }>).LastAction?.description);
    expect(d).toMatch(/ISO 8601/);
    expect(d).toMatch(/'lt' or 'gt'/);
  });
});

it('list_job_instances_by_logical_group filters by job definition', async () => {
  await client.callTool({ name: 'list_job_instances_by_logical_group', arguments: { logicalGroupId: G, JobDefinitionId: J } });
  expect(sent).toEqual([{ path: `/jobs/v2.0/LogicalGroups/${G}/JobInstances`, query: { JobDefinitionId: J } }]);
});
