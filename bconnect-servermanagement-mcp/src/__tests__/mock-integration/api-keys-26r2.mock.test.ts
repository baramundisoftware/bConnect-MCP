/**
 * API key tools against bConnect-Mock, bMS 26R2 (#357; follow-up to #407).
 *
 * Calls the tools through the MCP server, as a client would: create (both gates) → get → update →
 * delete on the mock's read-write profile, then the mock is reset. Also: the secret gate stops a
 * create before anything changes, and get never returns the secret. Skipped unless the mock serves
 * 26r2 in that profile (the tier counts the skips on 26r1 and 25r2).
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../index.js';
import {
  connectMockServer, mockAvailable, mockServes, rawGet, reset, resultJson, NONEXISTENT_GUID, type MockServer,
} from '../../../../__tests__/lib/mock-integration.js';

let available = false;
let mcp: MockServer;
let profile = '';

const keyCount = async (): Promise<number> => ((await rawGet('/servermanagement/v2.0/ApiKeys')).body as unknown[]).length;

beforeAll(async () => {
  available = await mockAvailable('servermanagement');
  if (!available) {return;}
  // The 26R2 tools: only a 26r2 mock in the read-write profile has them (other releases skip).
  available = await mockServes('26r2');
  if (available) {
    await reset();
    mcp = await connectMockServer(createServer, '26r2');
    Object.assign(process.env, { ALLOW_WRITE_OPERATIONS: 'true', ALLOW_SECRET_READ: 'true' });
    const profiles = (await rawGet('/servermanagement/v2.0/SecurityProfiles')).body as { data?: Array<{ id: string }> } | Array<{ id: string }>;
    profile = (Array.isArray(profiles) ? profiles : profiles.data ?? [])[0]?.id ?? '';
  }
});
afterAll(async () => {
  if (available) {
    await mcp.close();
    await reset();
  }
});

describe('API keys on the 26R2 mock', () => {
  it('create → get → update → delete; the secret only in the create result', async (ctx) => {
    if (!available) {ctx.skip();}
    if (!profile) {throw new Error('the mock fixtures have no security profile');}
    const created = await mcp.call('create_api_key', { name: 'mock-tier', comment: 'mock-tier', securityProfiles: [profile], isAvailableViaGateway: false });
    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain('shown only this once');
    const { id, apiKeySecret } = resultJson(created.text) as { id: string; apiKeySecret?: string };
    expect(typeof apiKeySecret === 'string' && apiKeySecret.length > 0, 'the create answer carries apiKeySecret').toBe(true);

    const got = await mcp.call('get_api_key', { id });
    expect(resultJson(got.text)).toMatchObject({ id, name: 'mock-tier', securityProfiles: [profile] });
    expect(got.text).not.toContain(apiKeySecret!);

    const updated = await mcp.call('update_api_key', { id, isActive: false, comment: 'changed' });
    expect(updated.isError, updated.text).toBe(false);
    expect(resultJson((await mcp.call('get_api_key', { id })).text)).toMatchObject({ isActive: false, comment: 'changed', name: 'mock-tier' });

    const deleted = await mcp.call('delete_api_key', { id });
    expect(deleted.text).toBe(`API key ${id} deleted: it can no longer be used.`);
    const gone = await mcp.call('get_api_key', { id });
    expect(gone.isError).toBe(true);
    expect(gone.text).toMatch(/404/);
  });

  it('with ALLOW_SECRET_READ off, create is refused and no key is created', async (ctx) => {
    if (!available) {ctx.skip();}
    process.env.ALLOW_SECRET_READ = 'false';
    try {
      const before = await keyCount();
      const r = await mcp.call('create_api_key', { name: 'not-created', securityProfiles: [profile] });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Secret-returning operation 'create_api_key' is disabled");
      expect(await keyCount()).toBe(before);
    } finally {
      process.env.ALLOW_SECRET_READ = 'true';
    }
  });

  it('an unknown key is an error result naming 404', async (ctx) => {
    if (!available) {ctx.skip();}
    const r = await mcp.call('get_api_key', { id: NONEXISTENT_GUID });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/404/);
  });
});
