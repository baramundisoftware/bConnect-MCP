/**
 * OS/client CA trust-store handling — GitHub issue #59
 *
 * Field report (BAGHUS GmbH, EAP): even when the Windows client already trusts the
 * bMS certificate, the MCP server refused to connect until the cert was manually
 * exported and referenced via BCONNECT_CA_CERT_PATH. Root cause: Node validates TLS
 * against its *bundled* CA list only — it never consults the OS certificate store.
 *
 * The fix lives in the shared `BConnectClientBase` (in @bconnect/mcp-core), which every
 * server's `BConnectClient` extends unchanged — so testing the base here covers all 13
 * servers. Two behaviours are pinned:
 *
 *   - No explicit CA + verification on → the agent's CA list is seeded from the OS
 *     trust store merged with Node's bundle (Node >= 22.15), while an explicit CA or
 *     `rejectUnauthorized: false` bypasses the fallback.
 *   - A TLS "certificate not trusted" failure yields an actionable remediation message
 *     instead of the generic "cannot connect".
 */

import { describe, it, expect } from 'vitest';
import tls from 'tls';
import { AxiosError } from 'axios';
import { BConnectClientBase, type BConnectConfig } from '@bconnect/mcp-core';

const BASE_URL = 'https://bms.test.local/bconnect';

/** Exposes internals the tests need: the agent's CA and the private error mapper. */
class InspectClient extends BConnectClientBase {
  get agentCa(): unknown {
    const agent = this.client.defaults.httpsAgent as { options?: { ca?: unknown } } | undefined;
    return agent?.options?.ca;
  }

  // handleError is private; exercised directly to pin the cert-error mapping.
  callHandleError(err: unknown): Promise<never> {
    return (this as unknown as { handleError: (e: unknown) => Promise<never> }).handleError(err);
  }
}

function makeClient(cfg: Partial<BConnectConfig> = {}): InspectClient {
  return new InspectClient({ baseUrl: BASE_URL, ...cfg });
}

const hasSystemStore =
  typeof (tls as unknown as { getCACertificates?: unknown }).getCACertificates === 'function';

describe('OS trust-store fallback (GitHub #59)', () => {
  // Only meaningful where tls.getCACertificates exists (Node >= 22.15); a no-op below.
  (hasSystemStore ? it : it.skip)(
    'seeds the agent CA from the OS + bundled store when no CA is configured',
    () => {
      const ca = makeClient().agentCa;
      expect(Array.isArray(ca)).toBe(true);
      expect((ca as unknown[]).length).toBeGreaterThan(0);
    },
  );

  it('lets an explicit CA override the trust-store fallback', () => {
    const explicit = '-----BEGIN CERTIFICATE-----\nexplicit\n-----END CERTIFICATE-----';
    expect(makeClient({ ca: explicit }).agentCa).toBe(explicit);
  });

  it('does not inject a CA when certificate verification is disabled', () => {
    expect(makeClient({ rejectUnauthorized: false }).agentCa).toBeUndefined();
  });
});

describe('TLS untrusted-cert error hint (GitHub #59)', () => {
  // request present + response absent → the "no response received" branch of handleError.
  function certError(code: string | undefined): AxiosError {
    return new AxiosError('TLS handshake failed', code, undefined, { path: '/probe' });
  }

  // handleError throws synchronously (its declared Promise<never> return is satisfied
  // by the throw), so these assert on a synchronous throw, not a rejected promise.
  it.each([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ])('maps %s to an actionable remediation message', (code) => {
    expect(() => makeClient().callHandleError(certError(code))).toThrow(
      /certificate verification failed/i,
    );
    expect(() => makeClient().callHandleError(certError(code))).toThrow(/BCONNECT_CA_CERT_PATH/);
  });

  it('reads the OpenSSL code from error.cause when not on error.code', () => {
    const err = certError(undefined);
    (err as { cause?: unknown }).cause = { code: 'SELF_SIGNED_CERT_IN_CHAIN' };
    expect(() => makeClient().callHandleError(err)).toThrow(/certificate verification failed/i);
  });

  it('falls through to the generic connectivity message for non-cert request errors', () => {
    expect(() => makeClient().callHandleError(certError('ECONNREFUSED'))).toThrow(
      /Cannot connect to the bConnect API/,
    );
  });
});
