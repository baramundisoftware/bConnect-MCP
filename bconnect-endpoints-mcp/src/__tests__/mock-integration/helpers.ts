/**
 * Helpers for mock-integration tests.
 *
 * Tests run against bConnect-Mock (default: http://127.0.0.1:13433).
 * Override via BCONNECT_MOCK_URL.
 *
 * Tests skip when the mock is unreachable. Upstream finding QA-57: they used
 * to do that with `if (!available) { return; }`, which vitest counts as a
 * PASS — a run against an absent mock reported "4 tests passed" having made
 * zero assertions. They now call ctx.skip(), so the report says skipped.
 */

import { BConnectClient } from '../../bconnect-client.js';

export const MOCK_BASE_URL = process.env.BCONNECT_MOCK_URL ?? 'http://127.0.0.1:13433';
export const NONEXISTENT_GUID = '00000000-0000-0000-0000-000000000000';

export interface MockHealth {
  status: string;
  profile: string;
  bmsVersion: string;
}

export async function getMockHealth(baseUrl = MOCK_BASE_URL): Promise<MockHealth | null> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) {return null;}
    return (await res.json()) as MockHealth;
  } catch {
    return null;
  }
}

export async function checkMockAvailable(baseUrl = MOCK_BASE_URL): Promise<boolean> {
  return (await getMockHealth(baseUrl)) !== null;
}

/**
 * Construct a BConnectClient pointed at the mock — env-vars-first with test
 * defaults, mirroring how src/index.ts wires production.
 */
export function createClient(baseUrl = MOCK_BASE_URL): BConnectClient {
  return new BConnectClient({
    baseUrl: process.env.BCONNECT_BASE_URL || baseUrl,
    username: process.env.BCONNECT_USERNAME || 'integration-test',
    password: process.env.BCONNECT_PASSWORD || 'integration-test',
    rejectUnauthorized: false,
    timeout: 10000,
  });
}

/**
 * Untyped JSON straight off the wire.
 *
 * This helper exists to probe RAW routes, so it deliberately does not pretend
 * to know the response shape. `unknown` made `body?.data?.[0]?.id` a type
 * error, and because no test in this repo was type-checked, nobody found out.
 * `any` rows are the honest description of 'whatever the server sent'.
 */
export type RawJsonBody = { data?: any[]; [key: string]: any } | null;

export async function rawGet(
  path: string,
  params: Record<string, string | number> = {},
  baseUrl = MOCK_BASE_URL,
): Promise<{ status: number; body: RawJsonBody }> {
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
