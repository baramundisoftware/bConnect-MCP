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
