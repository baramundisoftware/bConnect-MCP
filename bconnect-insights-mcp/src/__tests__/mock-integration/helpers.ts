/**
 * Helpers for the insights mock-integration tier.
 *
 * Mirrors the other servers' helpers (client factory + mock probe) and adds the
 * one thing this server's tier needs and theirs does not: FAULT CONTROL.
 *
 * Tests run against `scripts/bconnect-mock.mjs` (default
 * http://127.0.0.1:13433). Override with BCONNECT_MOCK_URL. Start the whole
 * tier, mock included, with `node scripts/run-mock-tier.mjs`.
 *
 * Skips call `ctx.skip()`, never a bare `return` — vitest counts a returning
 * test as a PASS, and a tier that reports success over an absent mock is worse
 * than no tier. That was upstream finding QA-57; it had been applied to two of
 * thirteen servers and was propagated to the rest on 2026-08-22, when the other
 * eleven were measured reporting "4 passed" having asserted nothing.
 */

import { BConnectClient } from '../../bconnect-client.js';

export const MOCK_BASE_URL = process.env.BCONNECT_MOCK_URL ?? 'http://127.0.0.1:13433';
export const NONEXISTENT_GUID = '00000000-0000-0000-0000-000000000000';
export const MOCK_UNREACHABLE = `bconnect-mock not reachable at ${MOCK_BASE_URL}`;

export interface MockHealth {
  status: string;
  profile: string;
  bmsVersion: string;
  fault?: string | null;
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
 * A client pointed at the mock.
 *
 * `timeoutMs` is a parameter because one of the cases below is a bMS that
 * answers too slowly: proving that path needs a timeout shorter than the
 * fault's delay, and a 10-second default would make the test take ten seconds
 * to say so.
 */
export function createClient(timeoutMs = 10_000, baseUrl = MOCK_BASE_URL): BConnectClient {
  return new BConnectClient({
    baseUrl,
    username: 'integration-test',
    password: 'integration-test',
    rejectUnauthorized: false,
    timeout: timeoutMs,
  });
}

/** What `POST /api/fault` accepts. See scripts/bconnect-mock.mjs. */
export interface FaultSpec {
  mode:
    | 'status-401' | 'status-403' | 'status-429' | 'status-500' | 'status-503'
    | 'slow' | 'hang' | 'drop'
    | 'empty-page' | 'string-total' | 'bad-total-pages' | 'not-envelope';
  /** Let this many requests succeed first — how a MID-WALK failure is staged. */
  after?: number;
  /** Apply to at most this many requests (default: all of them). */
  count?: number;
  /** For `slow`. */
  delayMs?: number;
}

export async function setFault(spec: FaultSpec, baseUrl = MOCK_BASE_URL): Promise<void> {
  const res = await fetch(`${baseUrl}/api/fault`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(spec),
  });
  if (!res.ok) {throw new Error(`could not set fault: HTTP ${res.status}`);}
}

/** Clear every fault. Call it in afterEach, or one case poisons the next. */
export async function reset(baseUrl = MOCK_BASE_URL): Promise<void> {
  const res = await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
  if (!res.ok) {throw new Error(`reset failed: HTTP ${res.status}`);}
}
