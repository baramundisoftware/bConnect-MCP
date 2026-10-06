/**
 * Detected findings per endpoint: 404 means "no endpoint" or "no findings"
 * (REQ-XC-005 AC 4, #166 AC 2).
 *
 * bConnect answers 404 both for an endpoint that doesn't exist and for an
 * endpoint without findings. On a 404 the tool checks whether the endpoint
 * exists: if it does, the result is empty with a note; if it doesn't, the
 * result says so; if the check fails, the original 404 stays, never "no findings".
 * A real HTTP server on loopback answers as bConnect would.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const ENDPOINT_ID = '11111111-2222-3333-4444-555555555555';

/** Answers by path; anything not listed is a 404. */
let answers: Record<string, { status: number; body: unknown }> = {};
let requests: string[] = [];
const api = http.createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0].replace(/^\/bconnect/, '');
  requests.push(path);
  const answer = answers[path] ?? { status: 404, body: { title: 'Not Found' } };
  res.writeHead(answer.status, { 'content-type': answer.status < 400 ? 'application/json' : 'application/problem+json' });
  res.end(JSON.stringify(answer.body));
});
let port = 0;
beforeAll(async () => { port = await new Promise<number>((r) => api.listen(0, '127.0.0.1', () => r((api.address() as AddressInfo).port))); });
afterAll(() => { api.closeAllConnections(); api.close(); });
beforeEach(() => { answers = {}; requests = []; });

async function call(name: string): Promise<{ text: string; isError: boolean }> {
  const { server } = createServer({ baseUrl: `http://127.0.0.1:${port}/bconnect`, apiKey: 'no-findings-test-key' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = await client.callTool({ name, arguments: { endpointId: ENDPOINT_ID } });
  const text = (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');
  return { text, isError: result.isError === true };
}

const TOOLS = [
  {
    tool: 'list_detected_vulnerabilities_for_endpoint',
    findings: `/compliance/v2.0/WindowsEndpoints/${ENDPOINT_ID}/DetectedVulnerabilities`,
    check: `/endpoints/v2.0/WindowsEndpoints/${ENDPOINT_ID}`,
    findingsMeaning: 'does not exist or there are no detected vulnerabilities for this endpoint',
    checkMeaning: 'is not visible due to missing read rights',
    missing: /^No Windows endpoint with this id exists, or it is not visible to the configured user\./,
  },
  {
    tool: 'list_detected_rule_violations_for_endpoint',
    findings: `/compliance/v2.0/Endpoints/${ENDPOINT_ID}/DetectedRuleViolations`,
    check: `/endpoints/v2.0/Endpoints/${ENDPOINT_ID}`,
    findingsMeaning: 'does not exist or contains no rule violation',
    checkMeaning: 'An endpoint with the specified id does not exist',
    missing: /^No endpoint with this id exists\./,
  },
];

describe.each(TOOLS)('$tool', ({ tool, findings, check, findingsMeaning, checkMeaning, missing }) => {
  it('findings: returned unchanged, no existence check', async () => {
    const page = { currentPage: 0, pageSize: 50, totalPages: 1, totalItems: 1, hasPreviousPage: false, hasNextPage: false, data: [{ id: 'f1' }] };
    answers[findings] = { status: 200, body: page };
    const { text, isError } = await call(tool);
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual(page);
    expect(requests).toEqual([findings]);
  });

  it('404 and the endpoint exists: empty result with a "no findings reported" note', async () => {
    answers[check] = { status: 200, body: { id: ENDPOINT_ID } };
    const { text, isError } = await call(tool);
    expect(isError).toBe(false);
    const result = JSON.parse(text) as Record<string, unknown>;
    expect(result.data).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.note).toMatch(/no findings (were )?reported/i);
    expect(requests).toEqual([findings, check]);
  });

  it('404 and the endpoint does not exist: says so, with the documented meaning', async () => {
    const { text, isError } = await call(tool);
    expect(isError).toBe(true);
    expect(text).toMatch(missing);
    expect(text).toContain(checkMeaning);
    expect(text).not.toMatch(/no findings/i);
    expect(requests).toEqual([findings, check]);
  });

  it.each([403, 500])('404 and the check answers %i: the original 404 stays, never "no findings"', async (status) => {
    answers[check] = { status, body: { title: `status ${status}` } };
    const { text, isError } = await call(tool);
    expect(isError).toBe(true);
    expect(text).toContain(findingsMeaning);
    expect(text).toMatch(/could not check whether the endpoint exists/i);
    expect(text).not.toMatch(/no findings/i);
  });

  it('another error on the findings route: no existence check', async () => {
    answers[findings] = { status: 403, body: { title: 'Forbidden' } };
    const { isError } = await call(tool);
    expect(isError).toBe(true);
    expect(requests).toEqual([findings]);
  });
});
