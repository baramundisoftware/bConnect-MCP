/**
 * A bounded walk must say it was bounded — and say it the same way twice.
 *
 * ── Where this comes from ───────────────────────────────────────────────────
 * Three separate modules were found presenting a partial read as a complete
 * answer: `get_security_posture` reported one page as the estate,
 * `scan-recency` cached a truncated walk and served it as fact, and
 * `get_unpatched_endpoints` reported a truncated array length as the estate
 * size. All three are fixed. This guard exists so a fourth cannot appear
 * quietly.
 *
 * ── What was actually found when this was written, which is not what was
 *    expected ─────────────────────────────────────────────────────────────
 * The Phase 4 hand-off said a suite-wide guard should assert every composite
 * emits `resultTrustworthy` and its reasons. Measured against the tree: nine
 * modules declare a page bound and only five use the shared contract — but the
 * other four are NOT hiding anything. They disclose truncation in their own
 * words: `truncated`, `historyTruncated`, `scopeTruncated`,
 * `neverScannedTrustworthy`.
 *
 * So the real defect is milder and different from the one described: not
 * concealment, but **five vocabularies for one concept** — which is this
 * project's most repeated failure class, arriving in a new costume. A caller
 * that learns to read `resultTrustworthy` still has to learn four more names
 * to get the same fact out of four other tools.
 *
 * Hence two rules with different jobs:
 *
 *   1. HARD — a module that bounds a walk must disclose the bound. All nine
 *      pass; this is a regression guard, and it is stated as one rather than
 *      dressed up as a discovery.
 *   2. RATCHET — the number of distinct vocabularies must not GROW. Pinned at
 *      what exists today. Converging them is a refactor across four modules
 *      that two agents are editing concurrently, so this bounds the problem
 *      now and leaves the convergence to be done deliberately rather than
 *      wedged in beside unrelated work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** Every server module that declares a page ceiling. */
function boundedModules(): Array<{ server: string; file: string; source: string }> {
  const out: Array<{ server: string; file: string; source: string }> = [];
  for (const server of readdirSync(ROOT).filter((d) => /^bconnect-.*-mcp$/.test(d))) {
    const dir = join(ROOT, server, 'src', 'modules');
    if (!existsSync(dir)) {continue;}
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      // A declared ceiling — `MAX_ENDPOINT_PAGES`, `MAX_THREAT_PAGES`, … — is
      // the signal that this module can return less than the whole answer.
      if (/\bMAX_[A-Z_]*PAGES\b/.test(source)) {
        out.push({ server, file, source });
      }
    }
  }
  return out;
}

/**
 * Names this suite uses to say "this answer may be incomplete".
 *
 * `pagesFetched` was in this list and has been REMOVED, on an independent
 * audit's finding that it made the rule near-vacuous. A page count says how
 * much was read; it says nothing about whether that was all of it.
 * `pagesFetched: 3` is equally true of a complete three-page walk and of a
 * walk cut off at three — which is exactly the distinction this guard exists
 * to force, so accepting it as the disclosure defeated the purpose.
 *
 * Every one of the nine bounded modules also carries a real signal, so
 * removing it changes no verdict today. It changes what a future module can
 * get away with, which is the only thing a guard is for.
 */
const DISCLOSURE_VOCABULARY = [
  'resultTrustworthy',
  'truncated',
  'Truncated',
  'Trustworthy',
];

describe('every bounded walk discloses that it was bounded', () => {
  it('no module can bound a read without saying so', () => {
    const silent: string[] = [];
    const modules = boundedModules();

    for (const m of modules) {
      const discloses = DISCLOSURE_VOCABULARY.some((word) => m.source.includes(word));
      if (!discloses) {
        silent.push(`${m.server}/${m.file}`);
      }
    }

    // If this hits zero the rule has stopped testing anything — most likely
    // because the `MAX_*_PAGES` convention changed, not because the bounds went
    // away. A bound that stops being findable is worse than one that is.
    expect(modules.length, 'no bounded module found; the MAX_*_PAGES convention may have changed')
      .toBeGreaterThan(5);
    expect(
      silent,
      `${silent.length} module(s) bound a read and never disclose it. A partial answer ` +
        `presented as a whole one is the defect class behind this project's worst shipped bug:\n  ` +
        silent.join('\n  ')
    ).toEqual([]);
    console.log(`[truncation] ${modules.length} bounded module(s), all disclosing`);
  });
});

describe('the ways of saying it do not multiply', () => {
  it('no new truncation vocabulary appears', () => {
    // The ratchet. Every DISTINCT field name used to signal incompleteness,
    // across every bounded module. Convergence on `resultTrustworthy` + reasons
    // is the goal; this stops the set growing while that is pending.
    const found = new Set<string>();
    for (const m of boundedModules()) {
      for (const match of m.source.matchAll(
        /\b([a-z][A-Za-z]*(?:Truncated|Trustworthy)|truncated|resultTrustworthy)\b/g
      )) {
        found.add(match[1]!);
      }
    }

    // Pinned 2026-08-03. Each is a real, currently-shipping name — this is a
    // record of the divergence, not an endorsement of it.
    const KNOWN = new Set([
      'resultTrustworthy', // the shared contract, in result-trust.ts
      'truncated', // the common one, used by most
      'historyTruncated', // scan-recency: its job-history walk specifically
      'scopeTruncated', // preview-assignment: the assignment scope specifically
      'neverScannedTrustworthy', // scan-recency: trust of one derived count
      'historyIncomplete', // scan-recency
    ]);

    // `<noun>WalkTruncated` is a FAMILY, not a new vocabulary each time: a
    // module that performs more than one bounded walk needs to say which one
    // was cut, and `endpointWalkTruncated` / `instanceWalkTruncated` are the
    // same convention applied to different walks.
    //
    // This exemption was added because the ratchet caught `instanceWalkTruncated`
    // the moment it appeared — in work committed minutes earlier — which is the
    // rule doing its job. Allowing a consistent family is not the thing this
    // guard exists to prevent; six unrelated inventions is.
    const WALK_FAMILY = /^[a-z][A-Za-z]*WalkTruncated$/;

    const novel = [...found]
      .filter((name) => !KNOWN.has(name) && !WALK_FAMILY.test(name))
      .sort();
    expect(
      novel,
      `${novel.length} new truncation vocabulary name(s). Five ways to say "this answer may be ` +
        `incomplete" is already four too many — a caller that learns resultTrustworthy should not ` +
        `have to learn another name per tool. Use assessResultTrust from ` +
        `@bconnect/mcp-core, or add the name here with the reason it cannot:\n  ${novel.join('\n  ')}`
    ).toEqual([]);
    console.log(`[truncation] ${found.size} distinct disclosure name(s) in use`);
  });
});
