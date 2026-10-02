/**
 * Self-test of what the live tier prints and publishes. Needs no bMS.
 */
import { describe, expect, it } from 'vitest';
import { sanitise, sanitisedSummary, type ToolRun } from './lib/report.js';

const HOST = 'bms-host.corp.example';
const SECRETS = ['S3cret-Passw0rd', 'QWRtaW46UzNjcmV0'];
const GUID = '11111111-2222-4333-8444-555555555555';

const runs: ToolRun[] = [
  { server: 'bconnect-endpoints-mcp', tool: 'list_endpoints', outcome: 'ok', detail: 'GET /v2.0/Endpoints',
    statuses: [200], requests: [`GET /endpoints/v2.0/Endpoints 200`], args: { PageSize: 5 }, schema: [] },
  { server: 'bconnect-endpoints-mcp', tool: 'get_endpoint', outcome: 'failed',
    detail: `Error at https://${HOST}:444/bconnect for WIN-FINANCE-07 (${GUID}) user Admin pw ${SECRETS[0]}`,
    statuses: [500], requests: [`GET /endpoints/v2.0/Endpoints/${GUID} 500`], args: { id: GUID }, schema: [] },
  { server: 'bconnect-endpoints-mcp', tool: 'get_maintenance_window_for_endpoint', outcome: 'expected',
    detail: 'the endpoint has no maintenance window', statuses: [409], args: { endpointId: GUID } },
  { server: 'bconnect-jobs-mcp', tool: 'create_job', outcome: 'skipped', detail: 'write tool' },
  { server: 'bconnect-servermanagement-mcp', tool: 'list_download_jobs', outcome: 'ok', detail: 'GET /v2.0/DownloadJobs',
    statuses: [200], schema: [{ path: '/data/[]/interval/[]', keyword: 'oneOf', message: 'must match exactly one schema in oneOf' }] },
];

describe('sanitise', () => {
  it('removes credentials, the host and object IDs', () => {
    const out = sanitise(`https://${HOST}:444/bconnect/x/${GUID} ${SECRETS[0]} ${SECRETS[1]}`, { hostname: HOST, secrets: SECRETS });
    expect(out).toBe('https://<bms>:444/bconnect/x/{id} *** ***');
  });

  it('removes object IDs written in upper case', () => {
    expect(sanitise('id ABCDEF12-3456-4789-8ABC-DEF012345678', { hostname: HOST, secrets: [] })).toBe('id {id}');
  });
});

describe('sanitised summary', () => {
  const summary = sanitisedSummary({
    release: '26R1', bmsVersion: '26.1.161.0', tlsVerified: false, caFile: false,
    startups: { ok: 13, total: 13 }, runs,
  });

  it('holds counts, tool names, statuses and finding classes', () => {
    expect(summary).toContain('13/13');
    expect(summary).toMatch(/2 ok, 1 expected, 1 failed, 0 not verified live, 1 skipped/);
    expect(summary).toContain('get_endpoint');
    expect(summary).toContain('500');
    expect(summary).toContain('get_maintenance_window_for_endpoint');
    expect(summary).toContain('list_download_jobs');
    expect(summary).toContain('oneOf');
    expect(summary).toMatch(/TLS.*not verified/i);
  });

  it('says when the run had no TLS at all', () => {
    const plain = sanitisedSummary({ release: '26R1', tlsVerified: false, plainHttp: true, caFile: false, startups: { ok: 13, total: 13 }, runs: [] });
    expect(plain).toMatch(/TLS: none \(plain HTTP/);
  });

  it('holds no host, credentials, object IDs or answer text', () => {
    for (const leak of [HOST, ...SECRETS, GUID, 'WIN-FINANCE-07', 'Admin', 'https://']) expect(summary, leak).not.toContain(leak);
  });
});
