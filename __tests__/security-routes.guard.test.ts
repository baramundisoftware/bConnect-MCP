/**
 * Security-relevant routes come from the specs, and every one is audited at
 * BCONNECT_AUDIT_LEVEL=security (REQ-XC-006 AC 3; #168 AC 1).
 *
 * The rule, derived here from both specs on its own: every operation tagged
 * ApiKeys, LocalAdministrativeAccounts, Objects, SecurityGroups or
 * SecurityProfiles, plus every operation whose answer carries a credential
 * (the secret-route derivation, ADR-0004). SECURITY_ROUTES in the core must
 * list exactly these, so a new such operation in a future spec fails here
 * until it's added.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import type { AuditLogEntry } from '../packages/mcp-core/src/audit-logger.js';
import * as core from '../packages/mcp-core/src/index.js';
import { AuditLogger } from '../packages/mcp-core/src/audit-logger.js';
import { RELEASES, type ApiOperation, type Release, type Schema, loadOperations, secretBearingOperations } from './lib/spec.js';

/** Every operation under these tags is security-relevant (credentials, rights, access control). */
const SECURITY_TAGS = ['ApiKeys', 'LocalAdministrativeAccounts', 'Objects', 'SecurityGroups', 'SecurityProfiles'];
/** Writes under these tags are security-relevant: availability of the server, values that can be passwords. */
const SECURITY_WRITE_TAGS = ['ManagementServer', 'Microservices', 'VariableDefinitions', 'VariableInstances'];
/** Every other tag of both specs, with the reason it isn't security-relevant. A new tag fails until it's classified. */
const NOT_SECURITY_TAGS: Record<string, string> = {
  ADGroups: 'directory data, read-only', ADObjects: 'directory data, read-only', ADUsers: 'directory data, read-only',
  OrgUnits: 'directory data, read-only',
  Assets: 'inventory', AssetStockFolders: 'inventory folders', AssetTypeFolders: 'inventory folders', AssetTypes: 'inventory types',
  BitLocker: 'status; the secret routes are covered by the credential rule', MicrosoftDefender: 'status, read-only',
  AndroidEndpoints: 'endpoint records; enrollment and credential bodies covered by the credential rule',
  Endpoints: 'endpoint records', IndustrialEndpoints: 'endpoint records; credential bodies covered by the credential rule',
  IosEndpoints: 'endpoint records; enrollment covered by the credential rule',
  LinuxEndpoints: 'endpoint records; credential bodies covered by the credential rule', LogicalGroups: 'grouping',
  MacEndpoints: 'endpoint records; enrollment covered by the credential rule',
  NetworkEndpoints: 'endpoint records; credential bodies covered by the credential rule',
  WindowsEndpoints: 'endpoint records; enrollment covered by the credential rule',
  Folders: 'job / OS folders', JobDefinitions: 'read-only', JobInstances: 'job runs (audited as writes at level write)',
  KioskReleases: 'kiosk offers (audited as writes at level write)',
  CloudConnectors: 'read-only', Dips: 'distribution points and MSW cleanup: content, not access control',
  Gateway: 'read-only', PxeRelays: 'read-only', VpnAppliance: 'read-only', DownloadJobs: 'read-only',
  InstalledWindowsSoftware: 'inventory, read-only', BundleApplications: 'software bundles', BundleFolders: 'software bundles',
  Bundles: 'software bundles',
  DetectedRuleViolations: 'findings, read-only', DetectedVulnerabilities: 'findings, read-only', Rules: 'read-only',
  Vulnerabilities: 'read-only', EntraId: 'device linking (temporary API); no credentials in either direction',
  UnmanagedEndpoints: 'discovered devices', UniversalDynamicGroups: 'read-only', UniversalDynamicGroupsFolder: 'read-only',
};
/** Operations whose credential the field names don't reveal. */
const CREDENTIAL_EXCEPTIONS: Record<string, string> = {
  'POST /endpoints/v2.0/WindowsEndpoints/{id}/StartEnrollment': 'answer installCommand carries the enrollment credential',
};
const CREDENTIAL_FIELD = /password|secret|apikey|credential|token|privatekey|recoverykey/i;

const ID = '00000000-0000-4000-8000-000000000001';

interface Route { method: string; domain: string; path: string }

// Looked up at run time so each test fails on its own until the table exists.
function table(): readonly Route[] {
  const routes: unknown = Reflect.get(core, 'SECURITY_ROUTES');
  if (!Array.isArray(routes)) {throw new Error('@bconnect/mcp-core exports no SECURITY_ROUTES');}
  return routes as Route[];
}

const tagsOf = (op: ApiOperation): string[] => op.spec.paths[op.path][op.method.toLowerCase()].tags ?? [];
const key = (r: Route) => `${r.method} /${r.domain}${r.path}`;

/** True when a request body schema (with $refs) has a credential-named property. */
function bodyCarriesCredential(op: ApiOperation): boolean {
  const schemas: Record<string, Schema> = op.spec.components?.schemas ?? {};
  const seen = new Set<string>();
  const walk = (schema: Schema | undefined): boolean => {
    if (!schema) {return false;}
    if (schema.$ref) {
      const name = String(schema.$ref).split('/').pop() ?? '';
      if (seen.has(name)) {return false;}
      seen.add(name);
      return walk(schemas[name]);
    }
    const parts: Schema[] = [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
    if (schema.items) {parts.push(schema.items);}
    return parts.some(walk) || Object.entries<Schema>(schema.properties ?? {}).some(([name, def]) => CREDENTIAL_FIELD.test(name) || walk(def));
  };
  return Object.values(op.requestBodies).some(walk);
}

function fromSpecs(release: Release): ApiOperation[] {
  const secret = new Set(secretBearingOperations(release).map((op) => key(op)));
  return loadOperations(release).filter((op) =>
    secret.has(key(op)) || key(op) in CREDENTIAL_EXCEPTIONS || bodyCarriesCredential(op) ||
    tagsOf(op).some((t) => SECURITY_TAGS.includes(t)) ||
    (op.method !== 'GET' && tagsOf(op).some((t) => SECURITY_WRITE_TAGS.includes(t))));
}

const concrete = (op: Route) => `/${op.domain}${op.path.replace(/\{[^}]+\}/g, ID)}`;

describe('security routes (self-check of the derivation)', () => {
  it('finds API keys, rights, security groups and profiles, LAPS and BitLocker secrets', () => {
    const keys = fromSpecs('26R1').map(key);
    for (const expected of [
      'GET /servermanagement/v2.0/ApiKeys',
      'GET /servermanagement/v2.0/Objects/{id}/Rights',
      'PATCH /servermanagement/v2.0/Objects/{id}',
      'POST /servermanagement/v2.0/SecurityGroups',
      'DELETE /servermanagement/v2.0/SecurityProfiles/{id}',
      'GET /defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
      'POST /defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient',
      'GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets',
    ]) {
      expect(keys).toContain(expected);
    }
    for (const expected of [
      'POST /endpoints/v2.0/WindowsEndpoints/{id}/StartEnrollment',
      'POST /endpoints/v2.0/LinuxEndpoints',
      'POST /endpoints/v2.0/NetworkEndpoints',
      'POST /servermanagement/v2.0/Restart',
      'POST /servermanagement/v2.0/Microservices/{id}/Stop',
      'PATCH /variables/v2.0/VariableInstances/{id}',
    ]) {
      expect(keys).toContain(expected);
    }
    expect(keys).not.toContain('GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints/{id}'); // status, not a secret
    expect(keys).not.toContain('GET /variables/v2.0/VariableDefinitions'); // reads of write-only tags stay out
  });
});

describe('tags of both specs', () => {
  it('are each classified as security-relevant or not (with a reason), so a new tag can\'t slip through', () => {
    const classified = new Set([...SECURITY_TAGS, ...SECURITY_WRITE_TAGS, ...Object.keys(NOT_SECURITY_TAGS)]);
    const all = new Set(RELEASES.flatMap((r) => loadOperations(r).flatMap(tagsOf)));
    expect([...all].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !all.has(t)).sort()).toEqual([]); // no stale classification
  });

  it('every operation has exactly one tag (the rule relies on it)', () => {
    const odd = RELEASES.flatMap((r) => loadOperations(r).filter((op) => tagsOf(op).length !== 1).map(key));
    expect(odd).toEqual([]);
  });
});

describe('SECURITY_ROUTES', () => {
  it('lists exactly the security routes of both specs (no missing, no stale, no duplicates)', () => {
    const expected = [...new Set(RELEASES.flatMap((r) => fromSpecs(r).map(key)))].sort();
    const actual = table().map(key).sort();
    expect({ missing: expected.filter((k) => !actual.includes(k)), stale: actual.filter((k) => !expected.includes(k)) })
      .toEqual({ missing: [], stale: [] });
    expect(actual).toEqual(expected);
  });
});

describe.each(RELEASES)('audit at level security, bMS %s', (release) => {
  const recorded = (level: 'security' | 'write' | 'all', method: string, path: string): boolean =>
    new AuditLogger({ level, username: 'audit', logHandler: () => {} }).shouldLog(method, path);

  it('records a call to every security route, flagged security-sensitive', () => {
    const missed = fromSpecs(release).filter((op) => {
      const logger = new AuditLogger({ level: 'security', username: 'audit', logHandler: () => {} });
      return !logger.shouldLog(op.method, concrete(op)) || !logger.isSecuritySensitive(concrete(op), op.method);
    });
    expect(missed.map(key)).toEqual([]);
  });

  it('records no ordinary read at level security, but every call at all', () => {
    expect(recorded('security', 'GET', '/endpoints/v2.0/Endpoints')).toBe(false);
    expect(recorded('security', 'GET', `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}`)).toBe(false);
    expect(recorded('all', 'GET', '/endpoints/v2.0/Endpoints')).toBe(true);
  });

  it('levels are cumulative: write records security reads too', () => {
    const reads = fromSpecs(release).filter((op) => op.method === 'GET');
    expect(reads.length).toBeGreaterThan(3);
    expect(reads.filter((op) => !recorded('write', 'GET', concrete(op))).map(key)).toEqual([]);
  });
});

describe('docs/AUDIT.md', () => {
  it('lists exactly the routes of SECURITY_ROUTES', () => {
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'AUDIT.md'), 'utf8');
    const block = page.split('<!-- security-routes:start -->')[1]?.split('<!-- security-routes:end -->')[0] ?? '';
    const listed = [...block.matchAll(/^\| `([A-Z]+)` \| `([^`]+)` \|/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(listed).toEqual(table().map(key).sort());
  });
});

describe('through the shared client at level security', () => {
  it('records a request to a security route as it is sent, and not an ordinary one', async () => {
    const msw = setupServer(http.all('*', () => HttpResponse.json({ data: [] })));
    msw.listen({ onUnhandledRequest: 'error' });
    try {
      const entries: AuditLogEntry[] = [];
      const client = new BConnectClientBase({
        baseUrl: 'https://bms.audit-routes.test/bconnect', apiKey: 'k',
        auditLog: { level: 'security', logHandler: (entry) => entries.push(entry) },
      }) as unknown as { client: { get: (u: string, c?: object) => Promise<unknown> } };
      await client.client.get('/servermanagement/v2.0/SecurityGroups', { params: { PageSize: 1 } });
      await client.client.get('/endpoints/v2.0/Endpoints');
      expect(entries.map((e) => `${e.method} ${e.path} ${e.securitySensitive}`)).toEqual([
        'GET /servermanagement/v2.0/SecurityGroups true',
        'GET /servermanagement/v2.0/SecurityGroups true',
      ]);
    } finally {
      msw.close();
    }
  });
});
