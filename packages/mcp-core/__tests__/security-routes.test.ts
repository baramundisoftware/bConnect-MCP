/**
 * Security-sensitive route classification and deny-list (SEC-1, SEC-4).
 *
 * The enumeration below is every path
 * `bconnect-defensecontrol-mcp/src/modules/defensecontrol.ts` can issue, taken
 * from the source. Each secret-bearing one must classify sensitive — that is
 * the assertion the previous hand-written regex list failed: the LAPS route
 * contains no "Secrets", "Password" or "Credential" segment, and `.../Pin` was
 * being matched against `/\/BitLockerPINs/i`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isSecuritySensitiveRoute,
  isCredentialReturningRoute,
  isSecretReadAllowed,
  assertSecurityRouteAllowed,
  SecuritySensitiveRouteError,
  RequestBlockedError,
} from '@bconnect/mcp-core';

const ID = 'e57a7e00-0000-4000-8000-000000000009';
const BASE = '/defensecontrol/v2.0';

const TRIGGER = `${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${ID}/TriggerUpdateOnClient`;

/**
 * Every defensecontrol route, with the two independent classifications:
 *
 *   `audited`  — worth a record at BCONNECT_AUDIT_LEVEL=security (broad).
 *   `returns`  — the RESPONSE BODY carries a credential, so the transport
 *                refuses the request unless ALLOW_SECRET_READ=true (narrow).
 *
 * They differ on exactly one row, and that row is finding A1.
 */
const DEFENSECONTROL_ROUTES: Array<[path: string, audited: boolean, returns: boolean]> = [
  [`${BASE}/BitLocker/WindowsEndpoints`, false, false],
  [`${BASE}/BitLocker/WindowsEndpoints/${ID}`, false, false],
  [`${BASE}/BitLocker/WindowsEndpoints/${ID}/Secrets`, true, true],
  [`${BASE}/BitLocker/WindowsEndpoints/${ID}/Pin`, true, true],
  [`${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`, true, true],
  // Rotates the LAPS password, returns a boolean. Audited, not denied.
  [TRIGGER, true, false],
  [`${BASE}/MicrosoftDefender/Threats`, false, false],
  [`${BASE}/MicrosoftDefender/Threats/${ID}`, false, false],
  [`${BASE}/MicrosoftDefender/WindowsEndpoints`, false, false],
  [`${BASE}/MicrosoftDefender/WindowsEndpoints/${ID}`, false, false],
];

afterEach(() => {
  delete process.env.ALLOW_SECRET_READ;
});

describe('isSecuritySensitiveRoute (audit set)', () => {
  it.each(DEFENSECONTROL_ROUTES)('classifies %s', (path, audited) => {
    expect(isSecuritySensitiveRoute(path)).toBe(audited);
  });

  it('classifies the two routes the old pattern list missed', () => {
    // These are the regressions SEC-4 is about, called out individually so a
    // future edit to the table cannot quietly drop them.
    expect(isSecuritySensitiveRoute(`${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`)).toBe(true);
    expect(isSecuritySensitiveRoute(`${BASE}/BitLocker/WindowsEndpoints/${ID}/Pin`)).toBe(true);
  });

  it('does not fire on ordinary estate routes', () => {
    for (const path of [
      '/endpoints/v2.0/Endpoints',
      '/endpoints/v2.0/WindowsEndpoints',
      '/jobs/v2.0/JobInstances',
      '/compliance/v2.0/Vulnerabilities',
      '/software/v2.0/InstalledWindowsSoftware',
    ]) {
      expect(isSecuritySensitiveRoute(path)).toBe(false);
    }
  });

  it('audits /ApiKeys but does not deny it (D1 / P1-1)', () => {
    // This route used to sit in the "ordinary estate routes" list above. It is
    // not ordinary: it is the bMS API-key inventory, and `list_api_keys`
    // already requires ALLOW_SECRET_READ at the tool layer. The audit set is
    // the second layer for anything that bypasses the tool.
    //
    // Audited, NOT denied — the same shape as TRIGGER above, and for the same
    // kind of reason. The follow-up register said it belonged in both tables,
    // but `ApiKey` carries name/expirationDate/comment/isActive/
    // isAvailableViaGateway/securityProfiles and no key material, and
    // `/v2.0/ApiKeys` declares `get` only — no ApiKeyForCreation, no POST — so
    // nothing on this path can return a usable key. Denying it would refuse a
    // route that returns no credential, which is the guess-built blocker
    // security-routes.ts's own header forbids.
    expect(isSecuritySensitiveRoute('/servermanagement/v2.0/ApiKeys')).toBe(true);
    expect(isCredentialReturningRoute('/servermanagement/v2.0/ApiKeys')).toBe(false);
  });

  it('matches on the path, not the query string', () => {
    expect(isSecuritySensitiveRoute('/endpoints/v2.0/Endpoints?SearchQuery=Secrets')).toBe(false);
  });
});

describe('isCredentialReturningRoute (deny set) — A1', () => {
  it.each(DEFENSECONTROL_ROUTES)('classifies %s', (path, _audited, returns) => {
    expect(isCredentialReturningRoute(path)).toBe(returns);
  });

  it('denies the four routes that return a credential in their body', () => {
    // Read off the return types in defensecontrol.ts: LocalAdminAccountWindowsEndpoint
    // (GET and PATCH of the LAPS resource) and BitLockerSecrets (GET .../Secrets,
    // PATCH .../Pin).
    for (const path of [
      `${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`,
      `${BASE}/BitLocker/WindowsEndpoints/${ID}/Secrets`,
      `${BASE}/BitLocker/WindowsEndpoints/${ID}/Pin`,
    ]) {
      expect(isCredentialReturningRoute(path)).toBe(true);
      expect(() => assertSecurityRouteAllowed('get', path, {})).toThrow(SecuritySensitiveRouteError);
    }
  });

  it('does NOT deny a route that rotates a credential without returning one', () => {
    // The A1 regression: `/LocalAdministrativeAccounts/i` covered the whole
    // sub-tree, so refresh_local_admin_account_expiry — which returns a boolean — was
    // refused at the transport with a message about credential exposure, making
    // the tool unreachable in the documented posture
    // (ALLOW_WRITE_OPERATIONS=true, ALLOW_SECRET_READ unset).
    expect(isCredentialReturningRoute(TRIGGER)).toBe(false);
    expect(() => assertSecurityRouteAllowed('post', TRIGGER, {})).not.toThrow();
  });

  it('still audits that route — narrowing the deny set must not narrow the audit set', () => {
    expect(isSecuritySensitiveRoute(TRIGGER)).toBe(true);
  });

  it('keeps the speculative audit patterns out of the deny set', () => {
    // /\/Password/i and /\/Credential/i match no route the suite issues. They
    // are cheap insurance in the audit set and a request blocker built out of
    // guesses in the deny set.
    for (const path of [
      '/servermanagement/v2.0/Passwords',
      '/servermanagement/v2.0/Credentials',
      '/defensecontrol/v2.0/TpmOwnerPasswords',
    ]) {
      expect(isSecuritySensitiveRoute(path)).toBe(true);
      expect(isCredentialReturningRoute(path)).toBe(false);
      expect(() => assertSecurityRouteAllowed('get', path, {})).not.toThrow();
    }
  });

  it('is a strict subset of the audit set', () => {
    for (const [path, audited, returns] of DEFENSECONTROL_ROUTES) {
      if (returns) {
        expect(audited).toBe(true);
        expect(isSecuritySensitiveRoute(path)).toBe(true);
      }
    }
  });
});

describe('deny-list', () => {
  it('refuses a credential route when ALLOW_SECRET_READ is unset', () => {
    expect(() =>
      assertSecurityRouteAllowed('get', `${BASE}/BitLocker/WindowsEndpoints/${ID}/Secrets`, {})
    ).toThrow(SecuritySensitiveRouteError);
  });

  it('refuses it regardless of which server originated it', () => {
    // The point of the transport-layer gate: twelve of the thirteen servers
    // have no ALLOW_SECRET_READ gate of their own at all.
    expect(() =>
      assertSecurityRouteAllowed('patch', `${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`, {})
    ).toThrow(/ALLOW_SECRET_READ/);
  });

  it('permits it once the operator opens the gate', () => {
    const env = { ALLOW_SECRET_READ: 'true' } as NodeJS.ProcessEnv;
    expect(isSecretReadAllowed(env)).toBe(true);
    expect(() =>
      assertSecurityRouteAllowed('get', `${BASE}/BitLocker/WindowsEndpoints/${ID}/Secrets`, env)
    ).not.toThrow();
  });

  it('never blocks an ordinary route', () => {
    expect(() => assertSecurityRouteAllowed('get', '/endpoints/v2.0/Endpoints', {})).not.toThrow();
  });

  it('is a RequestBlockedError, so handleError passes it through', () => {
    try {
      assertSecurityRouteAllowed('get', `${BASE}/BitLocker/WindowsEndpoints/${ID}/Secrets`, {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RequestBlockedError);
    }
  });

  it('reads process.env by default', () => {
    expect(isSecretReadAllowed()).toBe(false);
    process.env.ALLOW_SECRET_READ = 'true';
    expect(isSecretReadAllowed()).toBe(true);
  });
});
