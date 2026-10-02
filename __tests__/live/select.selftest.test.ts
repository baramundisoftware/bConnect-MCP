/**
 * Self-test of which tools the live tier calls. Needs no bMS.
 * Only tools whose declared operations are all non-secret GETs may be called.
 */
import { describe, expect, it } from 'vitest';
import { readOperations } from './lib/select.js';

const table = {
  list_endpoints: ['GetEndpoints'],
  start_android_enrollment: ['StartAndroidEndpointEnrollment'],
  get_bitlocker_secrets: ['GetBitLockerSecretsByWindowsEndpointId'],
  get_folder: ['GetFolder'],
  read_then_write: ['GetEndpoints', 'StartAndroidEndpointEnrollment'],
  unknown: ['NoSuchOperation'],
};

describe('tool selection', () => {
  it('selects a tool whose operations are GETs without credentials', () => {
    const ops = readOperations('26R1', 'bconnect-endpoints-mcp', table, 'list_endpoints');
    expect(typeof ops === 'string' ? ops : ops.map((op) => `${op.method} ${op.path}`)).toEqual(['GET /v2.0/Endpoints']);
  });

  it('skips a write tool, also when it reads first', () => {
    expect(readOperations('26R1', 'bconnect-endpoints-mcp', table, 'start_android_enrollment')).toBe('write tool');
    expect(readOperations('26R1', 'bconnect-endpoints-mcp', table, 'read_then_write')).toBe('write tool');
  });

  it('skips a tool whose GET returns credentials', () => {
    expect(readOperations('26R1', 'bconnect-defensecontrol-mcp', table, 'get_bitlocker_secrets')).toBe('returns credentials (secret gate)');
  });

  it('looks the operation up in the server\'s own spec', () => {
    // GetFolder exists in the jobs, operatingsystems and universaldynamicgroups specs.
    const ops = readOperations('26R1', 'bconnect-universaldynamicgroups-mcp', table, 'get_folder');
    expect(typeof ops === 'string' ? ops : ops.map((op) => `${op.domain} ${op.path}`))
      .toEqual(['universaldynamicgroups /v2.0/UniversalDynamicGroupsFolder/{id}']);
  });

  it('skips a tool with no or an unknown operation', () => {
    expect(readOperations('26R1', 'bconnect-endpoints-mcp', table, 'not_in_table')).toBe('no operation declared');
    expect(readOperations('26R1', 'bconnect-endpoints-mcp', table, 'unknown')).toBe('operation not in the 26R1 spec');
  });
});
