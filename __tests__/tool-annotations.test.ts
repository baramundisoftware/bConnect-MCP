/**
 * Tool annotations from the core (REQ-SRV-024, #296): the read/write
 * classification, the titles and the tools/list wrapper. Which tool gets which
 * hint is checked against the specs and the traffic in
 * tool-annotations.guard.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  DESTRUCTIVE_WRITE_TOOLS, toolAnnotations, toolEffect, toolTitle, withToolAnnotations,
} from '../packages/mcp-core/src/tool-annotations.js';

describe('toolEffect', () => {
  it('is read for GET only', () => {
    expect(toolEffect('list_things', ['GET'])).toBe('read');
    expect(toolEffect('list_things', ['GET', 'GET'])).toBe('read');
  });

  it('is write as soon as one method is not GET', () => {
    expect(toolEffect('update_thing', ['PATCH'])).toBe('write');
    expect(toolEffect('create_thing', ['GET', 'POST'])).toBe('write');
    expect(toolEffect('put_thing', ['put'])).toBe('write');
  });

  it('is destructive for any DELETE, whatever else the tool calls', () => {
    expect(toolEffect('delete_thing', ['DELETE'])).toBe('destructive');
    expect(toolEffect('move_thing', ['POST', 'delete'])).toBe('destructive');
  });

  it('is destructive for a write listed with a reason', () => {
    expect(toolEffect('msw_cleanup', ['POST'])).toBe('destructive');
    expect(toolEffect('update_bitlocker_pin', ['PATCH'])).toBe('destructive');
  });

  it('refuses a tool without methods: the table was not generated', () => {
    expect(() => toolEffect('list_things', [])).toThrow(/list_things/);
  });
});

describe('DESTRUCTIVE_WRITE_TOOLS', () => {
  it('gives every entry a reason', () => {
    expect(DESTRUCTIVE_WRITE_TOOLS.size).toBe(10);
    for (const [tool, reason] of DESTRUCTIVE_WRITE_TOOLS) {
      expect(reason.length, tool).toBeGreaterThan(20);
    }
  });
});

describe('toolTitle', () => {
  it('reads the tool name as words, first word capitalised', () => {
    expect(toolTitle('list_windows_endpoints_by_logical_group')).toBe('List Windows endpoints by logical group');
    expect(toolTitle('get_job_folder')).toBe('Get job folder');
  });

  it('spells product names and abbreviations as bMS does', () => {
    expect(toolTitle('update_bitlocker_pin')).toBe('Update BitLocker PIN');
    expect(toolTitle('list_ios_endpoints_by_ad_user')).toBe('List iOS endpoints by AD user');
    expect(toolTitle('link_entra_id_data')).toBe('Link Entra ID data');
    expect(toolTitle('simulate_msw_cleanup')).toBe('Simulate MSW cleanup');
    expect(toolTitle('msw_cleanup')).toBe('MSW cleanup');
    expect(toolTitle('list_udg_folders')).toBe('List UDG folders');
    expect(toolTitle('get_os_windows_endpoint')).toBe('Get OS Windows endpoint');
    expect(toolTitle('list_api_keys')).toBe('List API keys');
    expect(toolTitle('get_dip_status')).toBe('Get DIP status');
    expect(toolTitle('list_pxe_relays')).toBe('List PXE relays');
    expect(toolTitle('get_vpn_appliance')).toBe('Get VPN appliance');
    expect(toolTitle('trigger_intune_installation')).toBe('Trigger Intune installation');
    expect(toolTitle('create_kiosk_release')).toBe('Create Kiosk release');
    expect(toolTitle('list_defender_threats')).toBe('List Defender threats');
    expect(toolTitle('create_android_endpoint')).toBe('Create Android endpoint');
    expect(toolTitle('create_mac_endpoint')).toBe('Create Mac endpoint');
    expect(toolTitle('list_linux_endpoints')).toBe('List Linux endpoints');
  });
});

describe('toolAnnotations', () => {
  it('marks a read tool read-only, without a destructive hint (the spec ignores it there)', () => {
    expect(toolAnnotations('list_job_folders', ['GET'])).toEqual({ title: 'List job folders', readOnlyHint: true });
  });

  it('marks a write tool not read-only and says whether it is destructive', () => {
    expect(toolAnnotations('create_job_folder', ['POST'])).toEqual({ title: 'Create job folder', readOnlyHint: false, destructiveHint: false });
    expect(toolAnnotations('delete_job_folder', ['DELETE'])).toEqual({ title: 'Delete job folder', readOnlyHint: false, destructiveHint: true });
  });
});

describe('withToolAnnotations', () => {
  const table = { list_things: ['GET'], delete_thing: ['DELETE'] };

  it('adds the annotations and keeps every other field', async () => {
    const list = withToolAnnotations(table, () => ({
      nextCursor: 'c',
      tools: [
        { name: 'list_things', description: 'd1', inputSchema: { type: 'object' } },
        { name: 'delete_thing', description: 'd2', inputSchema: { type: 'object', required: ['id'] } },
      ],
    }));
    expect(await list()).toEqual({
      nextCursor: 'c',
      tools: [
        { name: 'list_things', description: 'd1', inputSchema: { type: 'object' }, annotations: { title: 'List things', readOnlyHint: true } },
        { name: 'delete_thing', description: 'd2', inputSchema: { type: 'object', required: ['id'] }, annotations: { title: 'Delete thing', readOnlyHint: false, destructiveHint: true } },
      ],
    });
  });

  it('works with an async handler', async () => {
    const list = withToolAnnotations(table, async () => ({ tools: [{ name: 'list_things' }] }));
    expect((await list()).tools[0]).toEqual({ name: 'list_things', annotations: { title: 'List things', readOnlyHint: true } });
  });

  it('refuses a tool missing from the table, naming the generator', async () => {
    const list = withToolAnnotations(table, () => ({ tools: [{ name: 'get_other' }] }));
    await expect(list()).rejects.toThrow(/get_other.*generate-query-parameters/);
  });

  it('leaves an entry without a name alone', async () => {
    const list = withToolAnnotations(table, () => ({ tools: [{ description: 'x' }] }));
    expect((await list()).tools).toEqual([{ description: 'x' }]);
  });
});
