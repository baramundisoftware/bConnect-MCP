/**
 * Kiosk releases per job definition: an empty list doesn't prove the job
 * definition exists (REQ-XC-005 AC 5, #166 AC 3).
 *
 * bMS 26R1 answers 200 with an empty list for a job definition that doesn't
 * exist (live check 2026-10-02), the same as for one without kiosk releases.
 * On an empty answer the tool checks the job definition exists. A real HTTP
 * server on loopback answers as bConnect would.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const JOB_DEFINITION_ID = '11111111-2222-3333-4444-555555555555';
const LIST = `/jobs/v2.0/JobDefinitions/${JOB_DEFINITION_ID}/KioskReleases`;
const CHECK = `/jobs/v2.0/JobDefinitions/${JOB_DEFINITION_ID}`;
const EMPTY = { currentPage: 0, pageSize: 50, totalPages: 0, totalItems: 0, hasPreviousPage: false, hasNextPage: false, data: [] };

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

async function call(): Promise<{ text: string; isError: boolean }> {
  const { server } = createServer({ baseUrl: `http://127.0.0.1:${port}/bconnect`, apiKey: 'kiosk-test-key' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = await client.callTool({ name: 'list_kiosk_releases_by_job_definition', arguments: { jobDefinitionId: JOB_DEFINITION_ID } });
  const text = (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');
  return { text, isError: result.isError === true };
}

describe('list_kiosk_releases_by_job_definition', () => {
  it('kiosk releases: returned unchanged, no existence check', async () => {
    const page = { ...EMPTY, totalPages: 1, totalItems: 1, data: [{ id: 'k1' }] };
    answers[LIST] = { status: 200, body: page };
    const { text, isError } = await call();
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual(page);
    expect(requests).toEqual([LIST]);
  });

  it('empty page beyond the last one (totalItems > 0): returned unchanged, no existence check', async () => {
    const page = { ...EMPTY, currentPage: 3, totalPages: 1, totalItems: 2 };
    answers[LIST] = { status: 200, body: page };
    const { text, isError } = await call();
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual(page);
    expect(requests).toEqual([LIST]);
  });

  it('empty and the job definition exists: empty result with a "no kiosk releases" note', async () => {
    answers[LIST] = { status: 200, body: EMPTY };
    answers[CHECK] = { status: 200, body: { id: JOB_DEFINITION_ID } };
    const { text, isError } = await call();
    expect(isError).toBe(false);
    const result = JSON.parse(text) as Record<string, unknown>;
    expect(result.data).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.note).toMatch(/has no kiosk releases/i);
    expect(requests).toEqual([LIST, CHECK]);
  });

  it('empty and the job definition does not exist: says so, with the documented meaning', async () => {
    answers[LIST] = { status: 200, body: EMPTY };
    const { text, isError } = await call();
    expect(isError).toBe(true);
    expect(text).toMatch(/^No job definition with this id exists, or it is not visible to the configured user\./);
    expect(text).toContain('is not visible due to missing read rights');
    expect(requests).toEqual([LIST, CHECK]);
  });

  it.each([403, 500])('empty and the check answers %i: empty result, note says existence is unconfirmed', async (status) => {
    answers[LIST] = { status: 200, body: EMPTY };
    answers[CHECK] = { status, body: { title: `status ${status}` } };
    const { text, isError } = await call();
    expect(isError).toBe(false);
    const result = JSON.parse(text) as Record<string, unknown>;
    expect(result.data).toEqual([]);
    expect(result.note).toMatch(/could not confirm that the job definition exists/i);
    expect(result.note).not.toMatch(/has no kiosk releases/i);
  });

  it('404 on the list itself: today\'s error result, no existence check', async () => {
    const { text, isError } = await call();
    expect(isError).toBe(true);
    expect(text).toContain('The specified job definition can not be found');
    expect(requests).toEqual([LIST]);
  });
});
