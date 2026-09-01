/**
 * A cached read from one bMS is never served to another (H2).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Two modules cache expensive reads to disk at a FIXED path under
 * `os.tmpdir()/bconnect-mcp/`, with nothing recording which server the data
 * came from.
 *
 * `secure-disk-cache.ts` closes the cross-USER case — owner-only 0700/0600, and
 * a file that is a symlink, not ours, or group/world-writable is refused. It
 * cannot close the cross-TENANT case, because that is not a permissions
 * problem: two MCP configurations under ONE OS user, pointing at two different
 * bMS servers, resolve the same path and read each other's data. The same user
 * legitimately owns both files, so nothing trips.
 *
 * The consequence is worst in `scan-recency`, which keys history by endpoint
 * DISPLAY NAME — and `WIN10-01` exists on most estates. A scan from server A
 * gets attributed to a same-named endpoint on server B for the 15 minutes of
 * the TTL, in the module whose entire purpose is deciding whether a scan is
 * recent enough to trust.
 *
 * The completeness work (H1) does not help here: it checks whether a cached
 * copy is WHOLE, never whose it is.
 */
import { describe, it, expect } from 'vitest';
import {
  cacheProvenanceFingerprint,
  cacheProvenanceFromEnv,
  fingerprintFromHttpClient,
  fingerprintedCacheName,
} from '@bconnect/mcp-core';

const SERVER_A = 'https://bms-a.corp.example/bconnect';
const SERVER_B = 'https://bms-b.corp.example/bconnect';
const KEY_A = 'api-key-alpha-0000000000';
const KEY_B = 'api-key-bravo-1111111111';

describe('the fingerprint separates what must be separate', () => {
  it('two servers with the same credential do not share a cache', () => {
    expect(cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A })).not.toBe(
      cacheProvenanceFingerprint({ baseUrl: SERVER_B, apiKey: KEY_A })
    );
  });

  it('two credentials against the same server do not share a cache', () => {
    // Not paranoia: two operators against one bMS can hold differently-scoped
    // API keys, and an RBAC-limited key's partial view must not be served to a
    // broader one as though it were complete — which is the same
    // "unreliable data presented as reliable" class as the truncated library.
    expect(cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A })).not.toBe(
      cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_B })
    );
  });

  it('basic-auth identities are separated too', () => {
    expect(cacheProvenanceFingerprint({ baseUrl: SERVER_A, username: 'svc-a@corp' })).not.toBe(
      cacheProvenanceFingerprint({ baseUrl: SERVER_A, username: 'svc-b@corp' })
    );
  });
});

describe('the fingerprint is stable enough to be a cache at all', () => {
  it('is identical across calls for one deployment', () => {
    const a = cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A });
    const b = cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A });
    expect(a).toBe(b);
  });

  it('ignores host case and a trailing slash, which are not different tenants', () => {
    expect(cacheProvenanceFingerprint({ baseUrl: 'https://BMS-A.corp.example/bconnect/', apiKey: KEY_A })).toBe(
      cacheProvenanceFingerprint({ baseUrl: 'https://bms-a.corp.example/bconnect', apiKey: KEY_A })
    );
  });

  it('has no per-process component — a cache that never hits is not a cache', () => {
    // Guards against someone "hardening" this with a random salt or a pid.
    const seen = new Set(
      Array.from({ length: 5 }, () => cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A }))
    );
    expect(seen.size).toBe(1);
  });
});

describe('the fingerprint does not leak the credential', () => {
  it('never contains the key, and is not reversible by inspection', () => {
    const fp = cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A });
    // It reaches a FILENAME, and filenames are readable by anything that can
    // list the directory.
    expect(fp).not.toContain(KEY_A);
    expect(fp).not.toContain('api-key');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('a basic-auth password never reaches the filename either', () => {
    const name = fingerprintedCacheName(
      'compliance-scan-history.json',
      cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: 'Basic c3ZjOnN1cGVyc2VjcmV0' })
    );
    expect(name).not.toContain('c3ZjOnN1cGVyc2VjcmV0');
    expect(name).toMatch(/^compliance-scan-history\.[0-9a-f]{16}\.json$/);
  });
});

describe('the filename carries it, so two tenants never contend for one file', () => {
  it('inserts the fingerprint before the extension', () => {
    expect(fingerprintedCacheName('vulnerability-library.json', 'abcdef0123456789')).toBe(
      'vulnerability-library.abcdef0123456789.json'
    );
  });

  it('two tenants produce two different files', () => {
    // In the filename and not only inside the payload: a shared path would have
    // one tenant OVERWRITING the other on every refresh, even if each correctly
    // refused to read it.
    const a = fingerprintedCacheName('x.json', cacheProvenanceFingerprint({ baseUrl: SERVER_A, apiKey: KEY_A }));
    const b = fingerprintedCacheName('x.json', cacheProvenanceFingerprint({ baseUrl: SERVER_B, apiKey: KEY_A }));
    expect(a).not.toBe(b);
  });
});

describe('the environment is what partitions a running deployment', () => {
  it('follows BCONNECT_BASE_URL and the credential', () => {
    const a = cacheProvenanceFromEnv({
      BCONNECT_BASE_URL: SERVER_A,
      BCONNECT_API_KEY: KEY_A,
    } as NodeJS.ProcessEnv);
    const b = cacheProvenanceFromEnv({
      BCONNECT_BASE_URL: SERVER_B,
      BCONNECT_API_KEY: KEY_A,
    } as NodeJS.ProcessEnv);
    expect(a).not.toBe(b);
  });

  it('is read per call, so a re-read environment repartitions', () => {
    // Explicitly NOT memoised: a long-lived process whose environment changes
    // must stop serving the previous tenant's data rather than keep hitting a
    // cache computed once at import time.
    const before = cacheProvenanceFromEnv({
      BCONNECT_BASE_URL: SERVER_A,
      BCONNECT_API_KEY: KEY_A,
    } as NodeJS.ProcessEnv);
    const after = cacheProvenanceFromEnv({
      BCONNECT_BASE_URL: SERVER_A,
      BCONNECT_API_KEY: KEY_B,
    } as NodeJS.ProcessEnv);
    expect(after).not.toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fingerprintFromHttpClient — the function both disk caches actually depend on
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This function had ZERO tests until 2026-08-14, and by then both disk caches
 * used it for the cache FILENAME and the payload provenance check. It is the
 * whole tenant partition.
 *
 * It exists because fingerprinting the environment is not enough:
 * `resolveClientConfig` resolves a base URL and key from three tiers — per
 * request injected credentials (how the gateway serves each domain), then
 * `__SUFFIX` scoped variables, then the ambient environment. Only the client
 * that made the request knows which won.
 *
 * The tests below pin three things that have each already gone wrong once:
 * that it separates tenants, that it reads the header from BOTH shapes axios
 * uses, and that its empty-input result is a CONSTANT — which is not a bug on
 * its own and is a trap for anyone handing it a partial stub.
 */
describe('fingerprintFromHttpClient — the partition both caches rely on', () => {
  const clientWith = (baseURL?: string, headers?: Record<string, unknown>) =>
    ({ defaults: { baseURL, headers } });

  const withKey = (baseURL: string, key: string) =>
    clientWith(baseURL, { common: { 'X-Api-Key': key } });

  it('separates two servers sharing one credential', () => {
    expect(fingerprintFromHttpClient(withKey(SERVER_A, KEY_A))).not.toBe(
      fingerprintFromHttpClient(withKey(SERVER_B, KEY_A))
    );
  });

  it('separates two credentials on one server', () => {
    expect(fingerprintFromHttpClient(withKey(SERVER_A, KEY_A))).not.toBe(
      fingerprintFromHttpClient(withKey(SERVER_A, KEY_B))
    );
  });

  it('is stable across calls for one client — a cache key that moves is no key', () => {
    const c = withKey(SERVER_A, KEY_A);
    expect(fingerprintFromHttpClient(c)).toBe(fingerprintFromHttpClient(c));
  });

  it('reads the key from headers.common AND from headers directly', () => {
    // axios puts request defaults under `headers.common`, but a client built by
    // hand — or a test stub — often sets them flat. Both are the same tenant,
    // and a partition that saw only one shape would silently split a cache.
    const nested = clientWith(SERVER_A, { common: { 'X-Api-Key': KEY_A } });
    const flat = clientWith(SERVER_A, { 'X-Api-Key': KEY_A });
    expect(fingerprintFromHttpClient(flat)).toBe(fingerprintFromHttpClient(nested));
  });

  it('separates Basic-auth deployments by their Authorization header', () => {
    const basic = (user: string) =>
      clientWith(SERVER_A, { common: { Authorization: `Basic ${Buffer.from(`${user}:pw`).toString('base64')}` } });
    expect(fingerprintFromHttpClient(basic('alice'))).not.toBe(fingerprintFromHttpClient(basic('bob')));
  });

  it('never lets a credential reach the digest in decodable form', () => {
    // The fingerprint becomes a FILENAME. A Basic header is the whole identity,
    // so it is hashed rather than embedded — this asserts the property, since a
    // future "simplification" that concatenated it would still partition
    // correctly and would put credentials on disk in a readable path.
    const secret = 'hunter2-should-never-appear';
    const fp = fingerprintFromHttpClient(
      clientWith(SERVER_A, { common: { Authorization: `Basic ${Buffer.from(`u:${secret}`).toString('base64')}` } })
    );
    expect(fp).not.toContain(secret);
    expect(fp).not.toContain(Buffer.from(`u:${secret}`).toString('base64'));
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });

  it('collapses to ONE constant for any client missing both baseURL and credential', () => {
    // The sharp edge, pinned deliberately rather than left to be discovered.
    //
    // A partial stub — `{}`, or a fake with no `defaults` — is not "no tenant",
    // it is THE SAME tenant as every other partial stub. That is harmless in
    // production (client-provider refuses to build a client without a baseUrl
    // and without either an apiKey or username+password, so both auth modes
    // always populate these), and it is a live trap for tests: a stub without
    // `defaults` shares a cache filename with every other such stub, and it
    // happens to equal `cacheProvenanceFromEnv()` on a bare environment.
    //
    // That coincidence is not theoretical — it is exactly why
    // `scan-recency-truncation.test.ts` kept passing for a week against a path
    // the module had stopped writing, and went red the moment BCONNECT_BASE_URL
    // was set. Anything handing this function a stub must give it an identity.
    const empty = fingerprintFromHttpClient({});
    expect(fingerprintFromHttpClient({ defaults: {} })).toBe(empty);
    expect(fingerprintFromHttpClient({ defaults: { headers: {} } })).toBe(empty);
    expect(fingerprintFromHttpClient({ defaults: { headers: { common: {} } } })).toBe(empty);
    // And it is the SAME value the env function produces with nothing set,
    // which is the collision that made the stale path invisible.
    expect(empty).toBe(cacheProvenanceFromEnv({} as NodeJS.ProcessEnv));
  });

  it('is NOT interchangeable with cacheProvenanceFromEnv for one real tenant', () => {
    // The two functions hash different identity halves: the env form uses the
    // USERNAME, the client form uses the Authorization header. So a Basic-auth
    // deployment fingerprints differently through each. Anything that computes
    // a cache path with one and reads it with the other is broken — which is
    // the defect shipped in d939676 and caught a commit later.
    const viaClient = fingerprintFromHttpClient(
      clientWith(SERVER_A, { common: { Authorization: 'Basic dTpwdw==' } })
    );
    const viaEnv = cacheProvenanceFromEnv({
      BCONNECT_BASE_URL: SERVER_A,
      BCONNECT_USERNAME: 'u',
    } as NodeJS.ProcessEnv);
    expect(viaClient).not.toBe(viaEnv);
  });
});
