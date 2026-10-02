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
import { describe, expect, it } from 'vitest';
import * as core from '../packages/mcp-core/src/index.js';
import { AuditLogger } from '../packages/mcp-core/src/audit-logger.js';
import { RELEASES, type ApiOperation, type Release, loadOperations, secretBearingOperations } from './lib/spec.js';

const SECURITY_TAGS = ['ApiKeys', 'LocalAdministrativeAccounts', 'Objects', 'SecurityGroups', 'SecurityProfiles'];
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

function fromSpecs(release: Release): ApiOperation[] {
  const secret = new Set(secretBearingOperations(release).map((op) => key(op)));
  return loadOperations(release).filter((op) => secret.has(key(op)) || tagsOf(op).some((t) => SECURITY_TAGS.includes(t)));
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
    expect(keys).not.toContain('GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints/{id}'); // status, not a secret
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
