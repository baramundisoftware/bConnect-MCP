/**
 * Secret-gate guard (REQ-SRV-017, ADR-0004).
 *
 * Every tool of every server is called, for both bMS releases, with arguments
 * generated from its input schema. MSW records the HTTP requests the tools send.
 *
 * With writes on and ALLOW_SECRET_READ unset:
 *   no request may reach an operation whose response carries a secret, as derived
 *   from the OpenAPI specs (see lib/spec.ts). Every tool must be
 *   exercised: it either sent a request or was refused by the secret gate.
 * Whether each request goes to the operation its tool declares is checked by
 * the spec-conformance guard (spec-conformance.guard.test.ts).
 *
 * The expectations come from the spec and the behaviour from the traffic, so a
 * hand-maintained list can't make this pass on its own.
 * Exceptions live in the allow-list below, each with a reason; an entry that no
 * longer occurs fails the test, so the list can't go stale.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RELEASES, type Release, findOperation, loadOperations, secretBearingOperations,
} from './lib/spec.js';
import { ID, SERVERS, callsOf, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

/** Tools allowed to reach a secret-bearing operation with ALLOW_SECRET_READ unset. */
const SECRET_ALLOW: Record<string, string> = {
  // Keyed by route: start_enrollment per type (REQ-SRV-029); the Windows route returns no secret field.
  'start_enrollment[type=AndroidEndpoint]': 'deferred: enrollment-token classification pending (separate issue)',
  'start_enrollment[type=IOSEndpoint]': 'deferred: enrollment-token classification pending (separate issue)',
  'start_enrollment[type=MacEndpoint]': 'deferred: enrollment-token classification pending (separate issue)',
};

interface Call {
  release: Release;
  server: string;
  tool: string;
  requests: Array<{ method: string; path: string }>;
  refusedBySecretGate: boolean;
}

const recorder = createRecorder();
const savedEnv = { ...process.env };

/** Call every tool of every server once, for one release and one gate setting. */
async function exerciseAll(release: Release, secretRead: boolean): Promise<Call[]> {
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead }));
  const calls: Call[] = [];
  for (const server of SERVERS) {
    const conn = await connect(server);
    // Every route: a merged tool once per variant of the release (REQ-SRV-029).
    for (const tool of await callsOf(server, conn.tools, release)) {
      recorder.take();
      const { text } = await conn.call(tool.name, { ...requiredArguments(tool.inputSchema), ...tool.select });
      const requests = recorder.take().map((r) => ({ method: r.method, path: r.path }));
      calls.push({
        release, server, tool: tool.key, requests,
        refusedBySecretGate: requests.length === 0 && /ALLOW_SECRET_READ/.test(text),
      });
    }
    await conn.close();
  }
  return calls;
}

const template = (path: string) => path.split(ID).join('{id}');

beforeAll(() => recorder.listen());
afterAll(() => {
  recorder.close();
  process.env = savedEnv;
});

describe('secret derivation from the OpenAPI specs (self-check)', () => {
  const key = (r: Release) => secretBearingOperations(r).map((o) => `${o.method} ${o.path}`);

  it('finds the BitLocker secrets (26R1) and LAPS credentials (both releases)', () => {
    expect(key('26R1')).toEqual(expect.arrayContaining([
      'GET /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets',
      'PATCH /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets',
      'GET /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
      'PATCH /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
    ]));
    expect(key('25R2')).toEqual(expect.arrayContaining([
      'GET /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
      'PATCH /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
    ]));
  });

  it('matches camelCase names and ignores non-string status flags', () => {
    const secrets = secretBearingOperations('26R1').find((o) => o.path.endsWith('/{id}/Secrets'));
    expect(secrets?.secretFields).toContain('BitLockerSecrets.initialStartupPin');
    const state = loadOperations('26R1').find((o) => o.method === 'GET' && o.path === '/v2.0/BitLocker/WindowsEndpoints/{id}');
    expect(state).toBeDefined();
    expect(state!.secretFields).toEqual([]); // isStartupPinEnabled is a boolean
  });
});

describe.each(RELEASES)('secret gate, bMS %s', (release) => {
  let closed: Call[];

  beforeAll(async () => {
    closed = await exerciseAll(release, false);
  }, 120_000);

  it('exercises every tool (no silent gaps)', () => {
    const idle = closed.filter((c) => c.requests.length === 0 && !c.refusedBySecretGate);
    expect(idle.map((c) => `${c.server}:${c.tool}`)).toEqual([]);
  });

  it('never reaches a secret-bearing operation with ALLOW_SECRET_READ unset', () => {
    const leaks: string[] = [];
    for (const call of closed) {
      if (SECRET_ALLOW[call.tool]) continue;
      for (const r of call.requests) {
        const op = findOperation(release, r.method, r.path);
        if (op && op.secretFields.length) {
          leaks.push(`${call.tool} → ${r.method} ${template(r.path)} returns ${op.secretFields.join(', ')}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('keeps every secret allow-list entry in use', () => {
    const used = new Set(
      closed.filter((c) => c.requests.some((r) => findOperation(release, r.method, r.path)?.secretFields.length))
        .map((c) => c.tool),
    );
    expect(Object.keys(SECRET_ALLOW).filter((t) => !used.has(t))).toEqual([]);
  });
});
