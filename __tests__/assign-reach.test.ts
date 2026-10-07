/**
 * Job assign tools say how to check their reach (#178, REQ-XC-003 AC 4).
 *
 * Live (bMS 26.1.161): an assignment to a logical group reaches the endpoints
 * of all its sub-groups, and the member listing counts the same endpoints only
 * with includeSubfolders=true. Each description names the call that counts the
 * reach, and says that the answer lists the assignments that failed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.reach.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  const { createServer } = await import('../bconnect-jobs-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'assign-reach', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
afterAll(async () => { await client.close(); process.env = saved; });

const description = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name)?.description ?? '';

describe.each([
  ['assign_job_to_logical_group', 'LogicalGroup'],
  ['assign_job_to_static_group', 'StaticGroup'],
  ['assign_job_to_dynamic_group', 'DynamicGroup'],
  ['assign_job_to_universal_dynamic_group', 'UniversalDynamicGroup'],
])('%s', (tool, groupKind) => {
  // The member listing is list_group_members with the group kind (REQ-SRV-029); countOnly
  // counts with one 1-row request (#165) instead of PageSize: 1.
  it('names the call that counts its reach', async () => {
    const d = await description(tool);
    expect(d).toContain(`list_group_members (groupKind: "${groupKind}"`);
    expect(d).toContain('countOnly: true');
    expect(d).not.toContain('PageSize');
    expect(d).toMatch(/totalItems/);
  });

  it('says the answer lists the assignments that failed', async () => {
    expect(await description(tool)).toMatch(/lists the assignments that failed/);
  });
});

it('the logical-group tool counts sub-groups at all levels', async () => {
  const d = await description('assign_job_to_logical_group');
  expect(d).toContain('includeSubfolders: true');
  expect(d).toMatch(/all levels/);
});
