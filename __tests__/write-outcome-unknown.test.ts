/**
 * A write whose outcome is unknown says so (REQ-XC-003 AC 6; #254).
 *
 * On a real bMS, two writes reported as timed out were completed in the
 * background. For a write that was sent but got no answer (timeout, connection
 * closed after sending) or got 502/504 from a gateway, the tool result says the
 * outcome is unknown and asks to check the state before repeating, instead of
 * suggesting a retry. Reads, and writes answered 503/4xx/500, keep their
 * messages. A real HTTP server, so the socket really closes.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { toolErrorResult } from '../packages/mcp-core/src/tool-errors.js';

type Mode = 'hang' | 'close' | 502 | 503 | 504 | 500 | 404;
let mode: Mode = 404;
let received = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received++;
    if (mode === 'hang') {return;} // never answers
    if (mode === 'close') { req.socket.destroy(); return; } // request read, connection closed
    res.writeHead(mode, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ title: `status ${mode}`, detail: 'from the test server' }));
  });
});
let port = 0;
beforeAll(async () => { port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port))); });
afterAll(() => { server.closeAllConnections(); server.close(); });

type Raw = { client: { request: (c: { method: string; url: string; data?: unknown }) => Promise<unknown> } };
const client = (base = `http://127.0.0.1:${port}/bconnect`): Raw =>
  new BConnectClientBase({ baseUrl: base, apiKey: 'outcome-test-key', timeout: 500 }) as unknown as Raw;

/** The tool-result text for one request in the given server mode, and how many requests arrived. */
async function outcome(method: string, m: Mode, base?: string): Promise<{ text: string; received: number }> {
  mode = m;
  received = 0;
  let error: unknown;
  try {
    await client(base).client.request({ method, url: '/endpoints/v2.0/LogicalGroups', data: method === 'GET' ? undefined : { name: 'x' } });
  } catch (e) {
    error = e;
  }
  const result = toolErrorResult(error, '26R1');
  return { text: result.content.map((c) => c.text).join('\n'), received };
}

const UNKNOWN = /unknown whether bMS made the change|Outcome unknown/;
const CHECK = /Check the current state/;

describe.each(['POST', 'PATCH', 'PUT', 'DELETE'])('a %s whose outcome is unknown', (method) => {
  it.each([
    ['no answer in time', 'hang' as Mode],
    ['the connection closed after the request was read', 'close' as Mode],
    ['a 502 from a gateway', 502 as Mode],
    ['a 504 from a gateway', 504 as Mode],
  ])('%s: says the outcome is unknown and asks to check the state, sent once', async (_case, m) => {
    const { text, received: n } = await outcome(method, m);
    expect(text).toMatch(UNKNOWN);
    expect(text).toMatch(CHECK);
    expect(text).not.toMatch(/raise the timeout|try again|Cannot connect/i);
    expect(text).not.toContain('127.0.0.1');
    expect(n).toBe(1);
  });

  it.each([[503 as Mode], [500 as Mode], [404 as Mode]])('answered %s: keeps today\'s message (not "unknown")', async (m) => {
    const { text } = await outcome(method, m);
    expect(text).not.toMatch(UNKNOWN);
    expect(text).toContain(`HTTP ${m}`);
  });
});

describe('reads keep today\'s messages', () => {
  it('a GET that gets no answer names BCONNECT_TIMEOUT_MS', async () => {
    const { text } = await outcome('GET', 'hang');
    expect(text).toMatch(/didn't answer within 0\.5 s \(BCONNECT_TIMEOUT_MS\)/);
    expect(text).not.toMatch(UNKNOWN);
  });

  it.each([[502 as Mode], [504 as Mode]])('a GET answered %s has no outcome line', async (m) => {
    const { text } = await outcome('GET', m);
    expect(text).toContain(`HTTP ${m}`);
    expect(text).not.toMatch(UNKNOWN);
  });
});

describe('a write that never reached bMS', () => {
  it('a refused connection says "Cannot connect", not "unknown"', async () => {
    const closed = http.createServer();
    const free = await new Promise<number>((r) => closed.listen(0, '127.0.0.1', () => r((closed.address() as AddressInfo).port)));
    await new Promise((r) => closed.close(r));
    const { text } = await outcome('POST', 404, `http://127.0.0.1:${free}/bconnect`);
    expect(text).toMatch(/Cannot connect to the bConnect API/);
    expect(text).not.toMatch(UNKNOWN);
  });
});
