/**
 * Every server shares one client across tool calls (REQ-SRV-023 AC 1, AC 8; #160).
 *
 * With the rate limit at 2 requests per window, six read-tool calls spread
 * over two createServer() instances (HTTP mode and the gateway build one per
 * request) give 2 results and 4 rate-limit refusals, and bConnect sees only
 * the 2 requests. Without a base URL a tool call is a tool error and sends
 * nothing. The servers are found from the repo.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SERVERS, connect, createRecorder, guardEnv, requiredArguments, type ConnectedServer } from './lib/exerciser.js';

const recorder = createRecorder(() => []);
beforeAll(() => recorder.listen());
afterAll(() => recorder.close());
afterEach(() => { vi.unstubAllEnvs(); recorder.take(); });

function stubEnv(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) {vi.stubEnv(name, value);}
}

/** A read tool that sends one request: a list tool if the server has one. */
function readTool(server: ConnectedServer): { name: string; args: Record<string, unknown> } {
  const reads = server.tools.filter((t) => /^(list|get)_/.test(t.name));
  const tool = reads.find((t) => t.name.startsWith('list_')) ?? reads[0];
  return { name: tool.name, args: requiredArguments(tool.inputSchema) };
}

describe.each(SERVERS)('%s', (name) => {
  it('refuses calls beyond the rate limit, across calls and server instances (AC 1)', async () => {
    stubEnv({
      ...guardEnv('26R1', { writes: false, secretRead: false }),
      BCONNECT_RATE_LIMIT_ENABLED: 'true',
      BCONNECT_RATE_LIMIT_MAX_REQUESTS: '2',
      // A window per server, so each server gets its own fresh limit.
      BCONNECT_RATE_LIMIT_WINDOW_MS: String(600000 + SERVERS.indexOf(name)),
    });
    const first = await connect(name);
    const second = await connect(name);
    const tool = readTool(first);
    const outcomes: string[] = [];
    for (const server of [first, second, first, second, first, second]) {
      const result = await server.call(tool.name, tool.args);
      outcomes.push(result.isError ? (/rate limit/i.test(result.text) ? 'refused' : result.text) : 'ok');
    }
    await first.close();
    await second.close();
    expect(outcomes).toEqual(['ok', 'ok', 'refused', 'refused', 'refused', 'refused']);
    expect(recorder.take()).toHaveLength(2);
  });

  it('answers a tool call without a base URL with a tool error naming it, sending nothing (AC 8)', async () => {
    stubEnv({ ...guardEnv('26R1', { writes: false, secretRead: false }), BCONNECT_BASE_URL: '' });
    const server = await connect(name);
    const tool = readTool(server);
    const result = await server.call(tool.name, tool.args);
    await server.close();
    expect(result.isError).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.text).toContain('BCONNECT_BASE_URL');
    expect(recorder.take()).toEqual([]);
  });
});
