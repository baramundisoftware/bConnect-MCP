/**
 * The endpoints server's 26R2 tools against bConnect-Mock (#353, #356; follow-up to #407).
 *
 * Calls the tools through the MCP server, as a client would: get_entra_id_data by bMS endpoint ID,
 * and trigger_intune_remote_action on an Intune-managed Windows endpoint (the mock answers true)
 * and on one that isn't (409, as the spec says). The mock only records the action; nothing to undo.
 * Skipped unless the mock serves 26r2 in the read-write profile (the tier counts the skips on 26r1
 * and 25r2). See docs/MOCK_INTEGRATION_TESTING.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../index.js';
import {
  connectMockServer, mockAvailable, mockServes, rawGet, NONEXISTENT_GUID, type MockServer,
} from '../../../../__tests__/lib/mock-integration.js';

let available = false;
let mcp: MockServer;
let intune: string | undefined;
let notIntune: string | undefined;
/** A Windows endpoint the mock has Entra ID data for (not every endpoint has some). */
let withEntra: string | undefined;

beforeAll(async () => {
  available = await mockAvailable('endpoints');
  if (!available) {return;}
  // The 26R2 tools: only a 26r2 mock in the read-write profile has them (other releases skip).
  available = await mockServes('26r2');
  if (available) {
    mcp = await connectMockServer(createServer, '26r2');
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const windows = ((await rawGet('/endpoints/v2.0/WindowsEndpoints', { PageSize: 1000 })).body as { data: Array<{ id: string; coManagement?: string }> }).data;
    intune = windows.find((e) => e.coManagement === 'Intune')?.id;
    notIntune = windows.find((e) => e.coManagement !== 'Intune')?.id;
    for (const { id } of windows) {
      if ((await rawGet(`/endpoints/v2.0/Endpoints/${id}/EntraIdData`)).status === 200) {withEntra = id; break;}
    }
  }
});
afterAll(async () => {
  if (available) {await mcp.close();}
});

describe('get_entra_id_data by bMS endpoint ID on the 26R2 mock (#353)', () => {
  it('reads the endpoint\'s Entra ID data; an unknown endpoint is an error result naming 404', async (ctx) => {
    if (!available) {ctx.skip();}
    if (!withEntra) {throw new Error('the mock fixtures have no Windows endpoint with Entra ID data');}
    const r = await mcp.call('get_entra_id_data', { endpointId: withEntra });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain(withEntra);
    const missing = await mcp.call('get_entra_id_data', { endpointId: NONEXISTENT_GUID });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/404/);
  });
});

describe('trigger_intune_remote_action on the 26R2 mock (#356)', () => {
  // it.for, not it.each: it passes the test context (ctx.skip) after the row.
  it.for([
    ['Sync', {}], ['Reboot', {}], ['Retire', {}], ['AutopilotReset', {}],
    ['FreshStart', { keepUserData: true }], ['Wipe', { keepUserData: false, keepEnrollmentData: true }],
  ] as const)('%s on an Intune-managed endpoint is triggered', async ([action, options], ctx) => {
    if (!available) {ctx.skip();}
    if (!intune) {throw new Error('the mock fixtures have no Intune-managed Windows endpoint');}
    const r = await mcp.call('trigger_intune_remote_action', { id: intune, action, ...options });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toBe(`Intune remote action ${action} triggered for endpoint ${intune}.`);
  });

  it('on an endpoint Intune doesn\'t manage, the answer is an error result naming the conflict', async (ctx) => {
    if (!available) {ctx.skip();}
    if (!notIntune) {throw new Error('the mock fixtures have no Windows endpoint without Intune');}
    const r = await mcp.call('trigger_intune_remote_action', { id: notIntune, action: 'Sync' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/409|not managed by Intune/i);
  });
});
