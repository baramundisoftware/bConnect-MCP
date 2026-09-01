/**
 * Opt-in per-domain bMS credentials.
 *
 * The feature exists because `app.ts` built every domain's server with
 * `factory(undefined)`, so all 13 shared one BCONNECT_* service credential and
 * every caller acted with its full authority. Measured on the reference estate
 * that is total: all four bMS security groups hold only `Administration`, which
 * resolves to `Full` on every object. In a DMZ that is a standing credential in
 * the least-trusted zone holding the whole management plane.
 *
 * The tests below are the seven properties the spec called for. Two matter more
 * than the rest:
 *
 *   * OFF MEANS OFF. The overwhelming majority of deployments will never set the
 *     toggle, and for them this code must be inert — not "mostly harmless",
 *     inert. Asserted by identity against `undefined`.
 *   * STRICT FAILS CLOSED. A typo in a domain-suffixed variable must not quietly
 *     hand that domain the global administrator credential. Degrading to MORE
 *     privilege is the failure mode a security feature must not have.
 */

import { describe, it, expect } from 'vitest';
import {
  DOMAIN_CREDENTIALS_ENV,
  allDomainSecretKeys,
  domainCredentialMode,
  domainEnvKeys,
  resolveDomainCredentials,
  validateDomainCredentials,
} from '../domain-credentials.js';
import { SECRET_ENV_KEYS, secretEnvKeysWithDomains } from '../secrets.js';

const DOMAINS = ['compliance', 'jobs', 'endpoints'] as const;

/** A clean env, so no ambient bMS or gateway variable leaks in from the runner. */
const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...over });

describe('off means off — the default deployment is untouched', () => {
  it('resolves undefined for every domain when the toggle is unset', () => {
    for (const d of DOMAINS) {
      // Identity against undefined, not falsiness: an empty object would still
      // be "falsy-ish" to a careless assertion while changing what the factory
      // receives.
      expect(resolveDomainCredentials(d, env())).toBeUndefined();
    }
  });

  /**
   * THIS is the discriminating test in this block, and the others are close to
   * decoration — worth saying so rather than letting a reader assume four
   * assertions mean four times the coverage.
   *
   * Measured: deleting the `mode === 'off'` early return fails only THIS one.
   * The rest pass against the broken code, because a clean env has no per-domain
   * variables to resolve, so the resolver returns undefined by accident rather
   * than by the toggle. Only a case where the variables ARE present can tell
   * "the toggle is off" from "there was nothing to find".
   */
  it('resolves undefined even when per-domain variables ARE set, if the toggle is unset', () => {
    // The toggle is the whole opt-in. Variables present without it must do
    // nothing, or a deployer who exported one for a test silently changes
    // identity in production.
    const e = env({ BCONNECT_API_KEY__COMPLIANCE: 'scoped-key' });
    expect(resolveDomainCredentials('compliance', e)).toBeUndefined();
  });

  it('validates to a no-op report and never throws', () => {
    const report = validateDomainCredentials(DOMAINS, env());
    expect(report).toEqual({ mode: 'off', scoped: [], fellBack: [] });
  });

  it('treats an unrecognised value as off rather than guessing', () => {
    expect(domainCredentialMode(env({ [DOMAIN_CREDENTIALS_ENV]: 'yes' }))).toBe('off');
    expect(domainCredentialMode(env({ [DOMAIN_CREDENTIALS_ENV]: 'true' }))).toBe('off');
    expect(domainCredentialMode(env({ [DOMAIN_CREDENTIALS_ENV]: '' }))).toBe('off');
  });
});

describe('strict fails closed', () => {
  it('refuses to start when a mounted domain has no credential of its own', () => {
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'strict',
      BCONNECT_API_KEY__COMPLIANCE: 'scoped-key',
      // jobs and endpoints deliberately absent.
    });
    expect(() => validateDomainCredentials(DOMAINS, e)).toThrow(/jobs/);
  });

  it('names the variables to set, so the message is actionable', () => {
    const e = env({ [DOMAIN_CREDENTIALS_ENV]: 'strict' });
    let message = '';
    try {
      validateDomainCredentials(DOMAINS, e);
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).toMatch(/BCONNECT_API_KEY__JOBS/);
    expect(message).toMatch(/BCONNECT_USERNAME__JOBS/);
    // And it must say why refusing beats starting half-scoped.
    expect(message).toMatch(/unscoped/i);
  });

  it('a typo does NOT silently grant the global credential', () => {
    // The scenario the design is shaped around: COMPLAINCE, not COMPLIANCE.
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'strict',
      BCONNECT_API_KEY__COMPLAINCE: 'scoped-key',
      BCONNECT_API_KEY__JOBS: 'j',
      BCONNECT_API_KEY__ENDPOINTS: 'e',
      BCONNECT_API_KEY: 'THE-GLOBAL-ADMIN-KEY',
    });
    expect(() => validateDomainCredentials(DOMAINS, e)).toThrow(/compliance/);
  });

  it('passes when every domain is scoped', () => {
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'strict',
      BCONNECT_API_KEY__COMPLIANCE: 'c',
      BCONNECT_API_KEY__JOBS: 'j',
      BCONNECT_API_KEY__ENDPOINTS: 'e',
    });
    const report = validateDomainCredentials(DOMAINS, e);
    expect(report.fellBack).toEqual([]);
    expect(report.scoped.map((s) => s.domain).sort()).toEqual(['compliance', 'endpoints', 'jobs']);
  });
});

describe('fallback is permitted but loud', () => {
  it('reports exactly which domains inherited the global credential', () => {
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'fallback',
      BCONNECT_API_KEY__COMPLIANCE: 'c',
    });
    const report = validateDomainCredentials(DOMAINS, e);
    expect(report.mode).toBe('fallback');
    expect(report.fellBack.sort()).toEqual(['endpoints', 'jobs']);
    expect(report.scoped).toEqual([{ domain: 'compliance', via: 'BCONNECT_API_KEY__COMPLIANCE' }]);
  });

  it('an unscoped domain still resolves undefined, so the global env applies', () => {
    const e = env({ [DOMAIN_CREDENTIALS_ENV]: 'fallback', BCONNECT_API_KEY__COMPLIANCE: 'c' });
    expect(resolveDomainCredentials('jobs', e)).toBeUndefined();
  });
});

describe('a scoped credential reaches the right domain and no other', () => {
  it('carries that domain values, and does not bleed across domains', () => {
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'fallback',
      BCONNECT_BASE_URL: 'https://global/bconnect',
      BCONNECT_API_KEY__COMPLIANCE: 'compliance-key',
      BCONNECT_API_KEY__JOBS: 'jobs-key',
    });
    expect(resolveDomainCredentials('compliance', e)?.apiKey).toBe('compliance-key');
    expect(resolveDomainCredentials('jobs', e)?.apiKey).toBe('jobs-key');
  });

  it('inherits the global baseUrl unless the domain overrides it', () => {
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'fallback',
      BCONNECT_BASE_URL: 'https://global/bconnect',
      BCONNECT_API_KEY__COMPLIANCE: 'c',
      BCONNECT_API_KEY__JOBS: 'j',
      BCONNECT_BASE_URL__JOBS: 'https://other/bconnect',
    });
    expect(resolveDomainCredentials('compliance', e)?.baseUrl).toBe('https://global/bconnect');
    expect(resolveDomainCredentials('jobs', e)?.baseUrl).toBe('https://other/bconnect');
  });

  it('a baseUrl ALONE is not a credential', () => {
    // Saying where to go is not saying who to be. Treating it as configured
    // would let a domain look scoped while silently using the global identity.
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'strict',
      BCONNECT_BASE_URL__JOBS: 'https://other/bconnect',
    });
    expect(() => validateDomainCredentials(['jobs'], e)).toThrow(/jobs/);
  });

  it('accepts username+password as well as an api key, but not half a pair', () => {
    const both = env({
      [DOMAIN_CREDENTIALS_ENV]: 'fallback',
      BCONNECT_USERNAME__JOBS: 'svc@labcorp.local',
      BCONNECT_PASSWORD__JOBS: 'pw',
    });
    expect(resolveDomainCredentials('jobs', both)?.username).toBe('svc@labcorp.local');

    const half = env({ [DOMAIN_CREDENTIALS_ENV]: 'strict', BCONNECT_USERNAME__JOBS: 'svc' });
    expect(() => validateDomainCredentials(['jobs'], half)).toThrow(/jobs/);
  });
});

describe('the report names variables, never values', () => {
  it('carries no credential material', () => {
    const SENTINEL = 'S3CRET-VALUE-DO-NOT-LOG';
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'fallback',
      BCONNECT_API_KEY__COMPLIANCE: SENTINEL,
    });
    const report = validateDomainCredentials(DOMAINS, e);
    // Serialised, because a nested field is exactly how one escapes a shallow
    // check — the mistake suite-credential-containment was written for.
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
    expect(JSON.stringify(report)).toContain('BCONNECT_API_KEY__COMPLIANCE');
  });

  it('the strict refusal message carries no credential material either', () => {
    const SENTINEL = 'S3CRET-VALUE-DO-NOT-LOG';
    const e = env({
      [DOMAIN_CREDENTIALS_ENV]: 'strict',
      BCONNECT_API_KEY__COMPLIANCE: SENTINEL,
    });
    let message = '';
    try {
      validateDomainCredentials(DOMAINS, e);
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).not.toContain(SENTINEL);
  });
});

describe('_FILE expansion covers every domain and key', () => {
  it('is generated from the domain list, not hand-written', () => {
    const keys = allDomainSecretKeys(DOMAINS);
    for (const d of DOMAINS) {
      const k = domainEnvKeys(d);
      expect(keys).toContain(k.apiKey);
      expect(keys).toContain(k.username);
      expect(keys).toContain(k.password);
      // baseUrl is not a secret and needs no Docker-secret handling.
      expect(keys).not.toContain(k.baseUrl);
    }
    expect(keys).toHaveLength(DOMAINS.length * 3);
  });

  it('extends the existing secret list rather than replacing it', () => {
    const merged = secretEnvKeysWithDomains(allDomainSecretKeys(DOMAINS));
    for (const original of SECRET_ENV_KEYS) {
      expect(merged).toContain(original);
    }
    expect(merged).toContain('BCONNECT_API_KEY__COMPLIANCE');
  });
});
