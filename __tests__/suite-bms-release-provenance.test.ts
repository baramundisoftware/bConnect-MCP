/**
 * The suite knows exactly one bMS release, and says so out loud.
 *
 * ── The gap this exists to make visible ─────────────────────────────────────
 * Every artefact in this repo is a function of ONE bConnect specification
 * release: openapi-specs/26R1 generates the types, the 216 tool descriptions
 * were written against it, and every suite-wide guard — including
 * descriptions-match-routes.test.ts, three doors down — validates the
 * catalogue against those files rather than against the server it will talk
 * to. That is the right trade for a build-time guard. It also means the guards
 * cannot notice the one thing that breaks the assumption: a bMS that is NEWER
 * than the specs.
 *
 * `evaluateBmsVersionGate` is a floor with no ceiling. Below 26R1 it refuses,
 * loudly and correctly. Above it, every version — 26R2, 27R1, 2030 R4 — takes
 * the same arm and produces the same single line, "satisfies the 26R1
 * minimum". Nothing anywhere tells the operator that the descriptions and
 * projections in front of them were generated from an older API than the one
 * answering. Routes REMOVED since 26R1 still fail loudly (a 404 carries
 * `releaseHint()`); a field RENAMED or reshaped does not fail at all. It
 * flows through into an answer that reads exactly like a correct one.
 *
 * ── What this file can and cannot do about that ─────────────────────────────
 * A ceiling has to live where both numbers are known, which is
 * packages/mcp-core/src/run-server.ts, at the moment the startup probe returns.
 * What a suite-level guard CAN own is everything around it:
 *
 *   the precondition — that "the release this suite was built from" is a
 *   single unambiguous fact and not three declarations that can drift;
 *
 *   the policy — that a newer bMS must WARN and must never be refused. A
 *   refusal shipped by mistake would take every customer offline on the
 *   morning they upgrade, which is strictly worse than the inaccuracy the
 *   ceiling is for;
 *
 *   the gap itself, recorded as an executable statement rather than a comment,
 *   so that it cannot be quietly forgotten and cannot quietly stay once fixed.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Creating an empty openapi-specs/26R2 alongside 26R1 turns the provenance
 * assertion red; the ceiling assertion was run un-marked and observed red
 * against the shipped gate before `.fails` was put on it. Both were run.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINIMUM_BMS_VERSION, evaluateBmsVersionGate } from '@bconnect/mcp-core';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The release directories under openapi-specs/, e.g. ["26R1"]. */
function shippedReleases(): string[] {
  return readdirSync(join(REPO, 'openapi-specs'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const FLOOR = `${MINIMUM_BMS_VERSION.major}R${MINIMUM_BMS_VERSION.release}`;

describe('the release this suite was generated from is one fact', () => {
  it('the shipped specs and the version gate name the same release', () => {
    // Written as a set equality rather than a containment on purpose. Adding a
    // second release directory without moving the gate is the drift that makes
    // a ceiling unstateable — after it, "newer than what we were built
    // against" has two answers.
    expect(
      shippedReleases(),
      `openapi-specs/ ships ${shippedReleases().join(', ')} but the version gate's floor is ` +
        `${FLOOR}. Every generated type, every tool description and every spec-validating ` +
        `guard in this repo is a function of the shipped release, so these cannot disagree ` +
        `about which one it is.`
    ).toEqual([FLOOR]);
  });
});

describe('the version gate warns about a newer bMS and never refuses one', () => {
  it('a bMS newer than the shipped release is allowed to start', () => {
    // The positive control first, so this cannot pass by reading a field that
    // is always false: BELOW the floor the gate does refuse.
    expect(
      evaluateBmsVersionGate('bconnect-jobs-mcp', { outcome: 'version', version: '25R2' }).refuse,
      'the floor stopped refusing an older bMS; this test is no longer testing anything'
    ).toBe(true);

    for (const version of ['26R2', '27R1', '2030 R4', '27.1.180.0']) {
      const gate = evaluateBmsVersionGate('bconnect-jobs-mcp', { outcome: 'version', version });
      expect(
        gate.refuse,
        `the gate refuses a bMS reporting "${version}". A ceiling must warn, never refuse: a ` +
          `false refusal takes every deployment offline on upgrade morning, which is worse ` +
          `than the inaccuracy a ceiling exists to disclose.`
      ).toBe(false);
    }
  });

  // MARKED `.fails` DELIBERATELY, AND THIS IS THE ONLY MARK OF ITS KIND HERE.
  //
  // The assertion below is the contract, not the current behaviour: run-server
  // has no ceiling, so it throws today and vitest records that as a pass. What
  // it buys over a comment is the other direction — the moment a ceiling lands
  // in evaluateBmsVersionGate, this test starts failing with "expected test to
  // fail", and the person who landed it is told, by the suite, to delete the
  // `.fails` and keep the assertion. A known gap that unwinds itself is worth
  // more than a TODO nobody greps for.
  //
  // The change it is waiting on, precisely: a BUILT_AGAINST_BMS_VERSION
  // constant beside MINIMUM_BMS_VERSION in packages/mcp-core/src/run-server.ts,
  // and one extra line in the `version` arm of evaluateBmsVersionGate when the
  // parsed version is above it — naming the release the descriptions and
  // response projections were generated from, and saying that a renamed or
  // reshaped field will not announce itself. Warn only; `refuse` stays false,
  // which the test above already holds it to.
  it.fails('discloses that the suite was generated from an older API than the one answering', () => {
    const gate = evaluateBmsVersionGate('bconnect-jobs-mcp', {
      outcome: 'version',
      version: '27R1',
    });
    const text = gate.lines.join(' ');
    // Not "mentions 26R1" — the existing line already says "satisfies the 26R1
    // minimum", so that would pass without a ceiling existing. The disclosure
    // has to be the thing a floor cannot say: that this is NEWER, and what the
    // consequence is.
    expect(text).toMatch(/\bwarning\b/i);
    expect(text).toMatch(/newer|generated from|built against/i);
  });
});
