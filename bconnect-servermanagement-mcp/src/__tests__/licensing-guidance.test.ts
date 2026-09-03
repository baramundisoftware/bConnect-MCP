/**
 * The catalogue must not tell a model to infer licensing from a state that
 * does not mean it.
 *
 * ── What happened ───────────────────────────────────────────────────────────
 * A Phase 4 pass measured `/servermanagement/v2.0/Microservices` live and
 * established that `state === "StoppedNotConfigured"` CANNOT distinguish
 * unlicensed from unconfigured: of the five rows carrying it, three were
 * configuration (an Apple push certificate, a VPP token) and two were
 * licensing. It recorded that as a correction to the audit's own advice.
 *
 * The correction was recorded and never propagated. Two descriptions written
 * in the same change set went on telling a model the opposite — "an unlicensed
 * module reports state:'StoppedNotConfigured' … match the state enum" — so a
 * model obeying the shipped instruction would be wrong three times in five on
 * the very estate the correction was measured against. The independent audit
 * found it.
 *
 * That is the failure this guards: not a wrong measurement, but a right one
 * that never reached the artefact. A correction recorded in a report and not in
 * the code is a correction that did not happen.
 *
 * ── Why the enum settles it ─────────────────────────────────────────────────
 * `ServiceState` in the 26R1 spec declares dedicated `NotLicensed` and
 * `RunningNotLicensed` members. Those are the licensing states. If the vendor
 * had meant `StoppedNotConfigured` to carry that meaning, it would not have
 * needed the other two.
 */
import { describe, it, expect } from 'vitest';
import { createServer } from '../index.js';

interface ToolDef {
  name: string;
  description?: string;
}

async function descriptions(): Promise<Map<string, string>> {
  process.env.VITEST = 'true';
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const handlers = (server as unknown as {
    _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>>;
  })._requestHandlers;
  const list = await handlers.get('tools/list')?.({ method: 'tools/list' });
  return new Map((list?.tools ?? []).map((t) => [t.name, t.description ?? '']));
}

describe('licensing guidance in the microservice tools', () => {
  it('no description tells a model that StoppedNotConfigured means unlicensed', async () => {
    const offenders: string[] = [];
    for (const [name, text] of await descriptions()) {
      // The specific false inference. Both halves must be present to flag —
      // naming the state is fine, and so is discussing licensing; asserting
      // that the one implies the other is not.
      const namesState = /StoppedNotConfigured/.test(text);
      const assertsLicensing =
        /unlicensed module reports/i.test(text) ||
        /match the state enum/i.test(text);
      if (namesState && assertsLicensing) {
        offenders.push(name);
      }
    }
    expect(
      offenders,
      `${offenders.length} description(s) instruct a model to read 'StoppedNotConfigured' as ` +
        `"unlicensed". Measured live, 3 of the 5 rows carrying that state were UNCONFIGURED, so ` +
        `the instruction is wrong more often than right:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('the microservice listing still explains what state does and does not mean', async () => {
    // The fix must not be "delete the sentence". A model that is told nothing
    // will infer something, and the whole point of the finding is that the
    // obvious inference is wrong.
    const text = (await descriptions()).get('list_microservices') ?? '';
    expect(text).toMatch(/NotLicensed/);
    expect(text).toMatch(/unavailable/i);
    // It must name the measurement rather than merely asserting a rule.
    expect(text).toMatch(/3 of 5|3 of the 5/);
  });
});
