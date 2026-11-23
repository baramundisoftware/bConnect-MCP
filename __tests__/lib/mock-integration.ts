/**
 * The one helper module of the mock-integration tier (#336). Every server's
 * src/__tests__/mock-integration/*.mock.test.ts imports it; a guard
 * (__tests__/mock-integration.guard.test.ts) refuses per-server copies.
 *
 * - The tests talk to bConnect-Mock at BCONNECT_MOCK_URL (default
 *   http://127.0.0.1:13433) with fixed test credentials. They never read the
 *   real BCONNECT_* settings, so a run can't send them elsewhere, and they
 *   keep certificate checks on.
 * - Without the mock the tests are skipped (`ctx.skip()`), so vitest reports
 *   them skipped, not passed. With MOCK_REQUIRED=true (set by
 *   scripts/mock-tier.mjs, which CI runs) a missing mock fails the run.
 */
import type { BConnectConfig } from '@bconnect/mcp-core';

export const MOCK_BASE_URL = process.env.BCONNECT_MOCK_URL ?? 'http://127.0.0.1:13433';
export const NONEXISTENT_GUID = '00000000-0000-0000-0000-000000000000';

/** The credentials the tests send: the mock accepts any. */
export const MOCK_CREDENTIALS = { username: 'integration-test', password: 'integration-test' } as const;

export interface MockHealth {
  status: string;
  profile: string;
  bmsVersion: string;
}

export async function getMockHealth(baseUrl = MOCK_BASE_URL): Promise<MockHealth | null> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {return null;}
    return (await res.json()) as MockHealth;
  } catch {
    return null;
  }
}

/**
 * Whether the mock answers. Without it, the caller's tests skip, and a warning
 * names the server; with MOCK_REQUIRED=true this throws instead, which fails
 * the run.
 */
export async function mockAvailable(server: string, baseUrl = MOCK_BASE_URL): Promise<boolean> {
  if ((await getMockHealth(baseUrl)) !== null) {return true;}
  if (process.env.MOCK_REQUIRED === 'true') {
    throw new Error(`bConnect-Mock not reachable at ${baseUrl} and MOCK_REQUIRED=true: ${server} mock tests can't run`);
  }
  console.warn(`⚠  bConnect-Mock not reachable at ${baseUrl} — ${server} mock tests skipped`);
  return false;
}

/** Client settings for the mock: its URL and the test credentials; certificate checks stay on. */
export function mockClientConfig(baseUrl = MOCK_BASE_URL): BConnectConfig {
  return { baseUrl, ...MOCK_CREDENTIALS, timeout: 10000 };
}

export async function rawGet(
  path: string,
  params: Record<string, string | number> = {},
  baseUrl = MOCK_BASE_URL,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) {url.searchParams.set(k, String(v));}
  const res = await fetch(url.toString());
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function reset(baseUrl = MOCK_BASE_URL): Promise<void> {
  const attempt = (): Promise<Response> => fetch(`${baseUrl}/api/reset`, { method: 'POST' });
  let res = await attempt();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await attempt();
  }
  if (!res.ok) {throw new Error(`Reset failed: HTTP ${res.status}`);}
}

/** The mock profile the tier runs: read-write, so write tools can be exercised (create → verify → delete). */
export const MOCK_PROFILE = 'standard-readwrite';

/**
 * Whether the mock serves bMS `release` (e.g. "26r2") in the read-write profile: the precondition
 * of the tests that exercise one release's tools through an MCP server. False on another release
 * (the tier counts those skips, scripts/mock-tier.mjs EXPECTED_SKIPS).
 */
export async function mockServes(release: string, baseUrl = MOCK_BASE_URL): Promise<boolean> {
  const health = await getMockHealth(baseUrl);
  return health !== null && health.bmsVersion.toLowerCase() === release && health.profile === MOCK_PROFILE;
}

/** A tool call's result as the model reads it. */
export interface MockToolResult { isError: boolean; text: string }

/** An MCP server connected in memory, its bConnect client pointed at the mock. */
export interface MockServer {
  call(name: string, args: Record<string, unknown>): Promise<MockToolResult>;
  /** The message of a call refused as a protocol error; throws when the call isn't refused. */
  refusal(name: string, args: Record<string, unknown>): Promise<string>;
  toolNames(): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * Connects a server's createServer() over MCP, as a client would, with its bConnect client
 * pointed at the mock (test credentials, plain http allowed only for this address) and the
 * release set to `release`. The gates are read per call: set ALLOW_WRITE_OPERATIONS /
 * ALLOW_SECRET_READ in process.env around a call to test them.
 */
export async function connectMockServer(
  createServer: () => { server: { connect(transport: unknown): Promise<void> } },
  release: string,
  baseUrl = MOCK_BASE_URL,
): Promise<MockServer> {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  Object.assign(process.env, {
    BCONNECT_BASE_URL: baseUrl, BCONNECT_USERNAME: MOCK_CREDENTIALS.username, BCONNECT_PASSWORD: MOCK_CREDENTIALS.password,
    BCONNECT_ALLOW_INSECURE_HTTP: 'true', BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: release.toUpperCase(),
    BCONNECT_RATE_LIMIT_ENABLED: 'false',
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mock-integration', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
  const text = (content: unknown): string => (content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
  return {
    async call(name, args) {
      const r = await client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: text(r.content) };
    },
    async refusal(name, args) {
      try {
        await client.callTool({ name, arguments: args });
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`${name} was not refused`);
    },
    async toolNames() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    close: () => client.close(),
  };
}

/** The JSON a tool result carries after its lead line (toolJsonResult), or the whole text. */
export function resultJson(text: string): unknown {
  const start = text.search(/[[{]/);
  return JSON.parse(start < 0 ? text : text.slice(start));
}
