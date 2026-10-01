/**
 * Self-test of the environment profile and of "not verified live". Needs no bMS.
 */
import { describe, expect, it } from 'vitest';
import { classifyByProfile, endpointTypesFrom, type Profile } from './lib/profile.js';
import { sanitisedSummary, type ToolRun } from './lib/report.js';

const page = (total: number, data: object[] = []) => ({ currentPage: 0, pageSize: 5, totalItems: total, data });
const managed = { managementState: 'Managed' };
const enrollable = { managementState: 'Enrollable' };

describe('environment profile', () => {
  it('counts endpoint types from the list answers, and how many listed are enrolled', () => {
    expect(endpointTypesFrom([
      { domain: 'endpoints', path: '/v2.0/WindowsEndpoints', body: page(21, [managed, {}]) },
      { domain: 'endpoints', path: '/v2.0/LinuxEndpoints', body: page(8, [managed]) },
      { domain: 'endpoints', path: '/v2.0/AndroidEndpoints', body: page(2, [enrollable, enrollable]) },
      { domain: 'endpoints', path: '/v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints', body: page(3) },
      { domain: 'jobs', path: '/v2.0/JobDefinitions', body: page(4) },
    ])).toEqual({ Windows: { total: 21, enrolled: 2 }, Linux: { total: 8, enrolled: 1 }, Android: { total: 2, enrolled: 0 } });
  });
});

describe('not verified live', () => {
  const profile: Profile = {
    release: '26R1', bmsVersion: '26.1.161.0', endpointTypes: { Windows: { total: 21, enrolled: 5 }, Linux: { total: 8, enrolled: 5 }, Android: { total: 2, enrolled: 0 } },
    mdm: 'no', entraId: 'not declared', untestedReleases: ['25R2'],
  };
  const run = (tool: string, route: string, outcome: ToolRun['outcome'] = 'ok'): ToolRun =>
    ({ server: 'bconnect-endpoints-mcp', tool, outcome, detail: '', route });

  it('reports a tool whose data class the bMS lacks as not verified live, never as passed', () => {
    const [android, ios, windows] = classifyByProfile([
      run('list_android_endpoints', 'endpoints /v2.0/AndroidEndpoints'),
      run('get_ios_endpoint', 'endpoints /v2.0/IosEndpoints/{id}', 'skipped'),
      run('list_windows_endpoints', 'endpoints /v2.0/WindowsEndpoints'),
    ], profile);
    expect(android.outcome).toBe('not verified live');
    expect(android.detail).toMatch(/Android/);
    expect(ios.outcome).toBe('not verified live');
    expect(windows.outcome).toBe('ok');
  });

  it('treats MDM and Entra ID as absent unless declared', () => {
    const [rules, entra] = classifyByProfile([
      run('list_mobile_device_rules', 'compliance /v2.0/Rules'),
      run('get_entra_id_data', 'endpoints /v2.0/EntraIdData/{deviceId}', 'skipped'),
    ], profile);
    expect(rules.outcome).toBe('not verified live');
    expect(entra.outcome).toBe('not verified live');
    const [declared] = classifyByProfile([run('list_mobile_device_rules', 'compliance /v2.0/Rules')], { ...profile, mdm: 'yes' });
    expect(declared.outcome).toBe('ok');
  });

  it('keeps a failure a failure', () => {
    const [failed] = classifyByProfile([run('list_mobile_device_rules', 'compliance /v2.0/Rules', 'failed')], profile);
    expect(failed.outcome).toBe('failed');
  });

  it('puts the environment, the unverified tools and the untested releases into the summary', () => {
    const runs = classifyByProfile([run('list_android_endpoints', 'endpoints /v2.0/AndroidEndpoints'), run('list_windows_endpoints', 'endpoints /v2.0/WindowsEndpoints')], profile);
    const summary = sanitisedSummary({ release: '26R1', bmsVersion: '26.1.161.0', tlsVerified: true, caFile: true, startups: { ok: 13, total: 13 }, runs, profile });
    expect(summary).toMatch(/1 ok, 0 expected, 0 failed, 1 not verified live, 0 skipped/);
    expect(summary).toContain('Windows 21, Linux 8, Android 2 (none enrolled)');
    expect(summary).toMatch(/MDM: no/);
    expect(summary).toMatch(/Entra ID: not declared/);
    expect(summary).toMatch(/25R2: not verified live/);
    expect(summary).toMatch(/list_android_endpoints.*Android/);
  });
});
