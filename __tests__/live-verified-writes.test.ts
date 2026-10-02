/**
 * Write tools verified on a live bMS drop the "not yet verified" note
 * (REQ-XC-003 AC 5).
 *
 * Verified 2026-10-02 on a test bMS 26R1 (26.1.161) as a restricted account in
 * a sandbox. Each entry of LIVE_VERIFIED_WRITE_TOOLS names the release it was
 * checked on; the guard in unverified-writes.guard.test.ts keeps every other
 * write tool marked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LIVE_VERIFIED_WRITE_TOOLS, UNVERIFIED_WRITE_NOTE } from '../packages/mcp-core/src/unverified-writes.js';

const VERIFIED: Record<string, string[]> = {
  endpoints: [
    'update_windows_endpoint', 'update_mac_endpoint', 'update_logical_group',
    'create_windows_endpoint', 'create_mac_endpoint', 'create_logical_group',
    'delete_windows_endpoint', 'delete_mac_endpoint', 'delete_logical_group',
    'create_maintenance_window_for_logical_group', 'update_maintenance_window_for_logical_group', 'delete_maintenance_window_for_logical_group',
  ],
  jobs: [
    'create_job_folder', 'update_job_folder', 'delete_job_folder',
    'create_kiosk_release', 'withdraw_kiosk_release',
    'assign_job_to_logical_group', 'delete_job_instance',
  ],
};

const tools: Record<string, Array<{ name: string; description?: string }>> = {};
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.verified.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  for (const server of Object.keys(VERIFIED)) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'live-verified', version: '0' });
    await Promise.all([createServer().server.connect(a), c.connect(b)]);
    tools[server] = (await c.listTools()).tools;
    await c.close();
  }
});
afterAll(() => { process.env = saved; });

describe.each(Object.entries(VERIFIED))('%s', (server, names) => {
  it.each(names)('%s is recorded with its release and drops the note', (name) => {
    expect(LIVE_VERIFIED_WRITE_TOOLS.get(name) ?? '').toMatch(/2026-10-02, bMS 26\.1\.161 \(26R1\)/);
    const t = tools[server].find((x) => x.name === name);
    expect(t, `${name} not listed`).toBeDefined();
    expect(t!.description).not.toContain(UNVERIFIED_WRITE_NOTE);
  });
});

it('lists exactly these tools', () => {
  expect([...LIVE_VERIFIED_WRITE_TOOLS.keys()].sort()).toEqual(Object.values(VERIFIED).flat().sort());
});
