/**
 * An estate-wide answer must say whose estate it is.
 *
 * ── The defect this guards ──────────────────────────────────────────────────
 * bConnect filters list results by the API key's rights and answers HTTP 200
 * with fewer rows, an agreeing `totalItems`, and no warning of any kind. A
 * rights-scoped key is therefore served a SMALLER ESTATE THAT LOOKS COMPLETE,
 * and every completeness check in this repo passes on it — because nothing is
 * incomplete. The reads finished. See `packages/mcp-core/src/result-trust.ts`.
 *
 * Measured 2026-08-16 with two keys on one estate
 * (`scripts/compare-estate-aggregates-by-scope.mjs`): all TEN estate-wide
 * aggregates diverge, and SEVEN assert `resultTrustworthy: true` on both sides
 * while giving different answers. Some counts do not merely shrink, they reach
 * zero — `get_security_posture` reports `tpmNotEnabled` 10 -> 0, and
 * `get_unpatched_endpoints` reports `neverScanned` 6 -> 0. "Zero machines lack
 * TPM" is a clean bill of health that the estate does not support.
 *
 * ── Why this is a guard and not a fix ───────────────────────────────────────
 * Nothing in a response reveals the scoping, and no route returns a profile's
 * permission set, so the disclosure cannot be conditional — it is printed
 * always. What CAN rot is coverage: a ninth aggregate ships, nobody remembers,
 * and it answers about a slice of the estate with no note. That failure is
 * silent by construction, which is this project's most-repeated shape.
 *
 * ── The discriminator, and why it is discovered rather than listed ──────────
 * A module that emits `resultTrustworthy` as a RESPONSE FIELD is, by that act,
 * making a completeness claim about what it read. That is exactly the set of
 * modules that owe the scope note, and it is discoverable from the tree — so
 * this guard has no hand-written list of the ten. A list of ten is a list
 * of thirteen servers by another name, and that class has now been found five
 * times in this project: it never fails, it reports a clean figure for
 * something it never looked at.
 *
 * Prose is stripped before matching. Half a dozen files discuss
 * `resultTrustworthy` in comments and tool descriptions without emitting it,
 * and `shape-response.ts` was already a false positive in the server-list audit
 * for the same reason.
 *
 * ── The exception list, and why it is not a cheat ───────────────────────────
 * PER-OBJECT composites make a completeness claim about ONE object, not about
 * the estate, and the same measurement shows they are unaffected:
 * `get_endpoint_briefing` returned identical answers to both credentials at 97
 * of 97 leaves. A question about one endpoint both keys can see has one answer.
 * Those are named below with that reason. Silence fails — absence from the list
 * is how a module declares itself fine, and that is the property that let six
 * guards go blind on 2026-08-14.
 *
 * ── Every entry here now rests on a MEASUREMENT, and two of them did not ────
 * The first version of this list held four. Two were exempted on an ARGUMENT —
 * that `diagnose_job` and `explain_job_failure` are per-object because the
 * caller supplies an id — and both were wrong when measured on 2026-08-16:
 *
 *   explain_job_failure  every option is OPTIONAL, so the default call walks
 *                        every JobInstance and clusters the estate's failures.
 *                        distinctCauses 6 -> 1, jobsAffected 8 -> 2, both sides
 *                        resultTrustworthy: TRUE. A ninth aggregate.
 *   diagnose_job         the id bounds which JOB, not which endpoints' instances
 *                        of it are visible. Its history is a scoped population.
 *
 * The argument was about the arguments a tool MAY take; the exposure is in the
 * call it actually answers. An exemption reasoned rather than measured is a
 * claim to more certainty than the list has, which is the rule this whole file
 * serves. Both remaining entries were compared under two credentials and came
 * back identical.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SCOPE_NOTE } from '@bconnect/mcp-core';

const ROOT = join(__dirname, '..');

/** Strip comments, so a field discussed in PROSE is not mistaken for one emitted. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The two ways a module ships a completeness claim, and it must be BOTH.
 *
 * The first draft of this guard tested only the literal property and found
 * FIVE modules where the measurement had found twelve. The five domain-server
 * aggregates never write `resultTrustworthy` at all — they spread the shared
 * helper, `...assessResultTrust(...)`, so the field appears at runtime and
 * nowhere in the source. A guard matching only the literal would have reported
 * a clean result for `get_security_posture`, `get_fleet_summary`,
 * `get_stale_endpoints`, `get_vulnerability_exposure` and
 * `get_unpatched_endpoints` — the exact five the first scope measurement also
 * never looked at, missed the second time for an unrelated reason. Left alone
 * it would have been the sixth instance of this project's defect class.
 *
 * - `assessResultTrust(` — the shared helper. Calling it IS emitting the field.
 * - `resultTrustworthy:` as a property — insights composites compute the
 *   boolean themselves and never import the helper.
 *
 * A tool description reading "read meta.resultTrustworthy before quoting any
 * count" has no colon adjacent and does not match. A type declaration
 * `resultTrustworthy: boolean` does, correctly: a module that declares the
 * field in its public shape ships it.
 */
const EMITS = [/\bassessResultTrust\s*\(/, /(?:^|[{,(\s])resultTrustworthy\s*:/m];

/**
 * The disclosure ASSIGNED to the field, not merely named in the file.
 *
 * The first draft tested `source.includes('CREDENTIAL_SCOPE_NOTE')` and two
 * mutations survived it: deleting the whole `credentialScope:` line from
 * `get_security_posture`, and replacing the shared constant with a
 * copy-pasted paraphrase in `get_fleet_summary`. Both left the IMPORT
 * statement standing, and the import alone satisfied the check. A guard that
 * passes on an unused import is measuring that someone once intended to
 * disclose.
 *
 * Pinning the field NAME as well as the value is deliberate. This suite's
 * other disclosure guard exists because one concept grew five vocabularies
 * (`truncated`, `historyTruncated`, `scopeTruncated`, …) and a caller had to
 * learn a name per tool. One name, fixed here, from the start.
 */
const DISCLOSES = /credentialScope\s*:\s*CREDENTIAL_SCOPE_NOTE\b/;

interface Claiming { server: string; file: string; rel: string; source: string }

/** Every server module that emits a completeness claim. */
function claimingModules(): Claiming[] {
  const out: Claiming[] = [];
  for (const server of readdirSync(ROOT).filter((d) => /^bconnect-.*-mcp$/.test(d))) {
    const dir = join(ROOT, server, 'src', 'modules');
    if (!existsSync(dir)) {continue;}
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = code(readFileSync(join(dir, file), 'utf8'));
      if (EMITS.some((re) => re.test(source))) {
        out.push({ server, file, rel: `${server}/src/modules/${file}`, source });
      }
    }
  }
  return out;
}

/**
 * Modules that make a completeness claim WITHOUT owing the estate-scope note.
 * The value is why, and the reason is checkable by a reader.
 *
 * This list can only shrink. A module that gains an estate-wide aggregate must
 * leave it, and a stale entry — one naming a module that no longer claims, or
 * that now carries the note — fails below rather than lingering.
 */
const NOT_ESTATE_WIDE: Record<string, string> = {
  'bconnect-insights-mcp/src/modules/endpoint-briefing.ts':
    'per-object: one endpoint, and measured IDENTICAL across both credentials at 97 of 97 leaves',
  'bconnect-insights-mcp/src/modules/endpoint-reach.ts':
    'per-object: one endpoint. Predicted to mix scopes (unscoped UDG walk, scoped membership reads) and measured NOT to — same answer to both keys',
};

describe('every estate-wide aggregate discloses whose estate it describes', () => {
  it('a module that claims completeness carries the scope note or records why not', () => {
    const modules = claimingModules();
    const silent: string[] = [];

    for (const m of modules) {
      if (DISCLOSES.test(m.source)) {continue;}
      if (m.rel in NOT_ESTATE_WIDE) {continue;}
      silent.push(m.rel);
    }

    // VACUITY. A rule that finds nothing to check passes identically whether
    // the defect is gone or the discriminator broke — and a ratchet at zero is
    // the dangerous state, not the finished one. Eight aggregates plus four
    // per-object composites were the measured population; requiring more than
    // eight means the EMITS pattern still finds modules at all.
    expect(
      modules.length,
      'no module emits resultTrustworthy; the field was renamed or the matcher rotted, ' +
        'and this guard is now measuring nothing'
    ).toBeGreaterThan(8);

    expect(
      silent,
      `${silent.length} module(s) make a completeness claim about an estate they may only ` +
        `partly be allowed to see, and say nothing about it. bConnect filters list results by ` +
        `the key's rights with HTTP 200 and no signal, so these counts can reach ZERO while the ` +
        `estate is not empty. Import CREDENTIAL_SCOPE_NOTE from @bconnect/mcp-core and put it at ` +
        `meta.credentialScope, or add the module to NOT_ESTATE_WIDE with the reason:\n  ` +
        silent.join('\n  ')
    ).toEqual([]);

    const disclosed = modules.filter((m) => DISCLOSES.test(m.source));
    console.log(
      `[scope] ${disclosed.length} estate-wide aggregate(s) disclosing, ` +
        `${Object.keys(NOT_ESTATE_WIDE).length} per-object exempt, ${modules.length} claiming total`
    );
  });

  it('the exception list holds no stale entry', () => {
    const claiming = new Map(claimingModules().map((m) => [m.rel, m]));
    const stale: string[] = [];

    for (const rel of Object.keys(NOT_ESTATE_WIDE)) {
      const m = claiming.get(rel);
      if (!m) {
        stale.push(`${rel} — no longer emits resultTrustworthy, or has moved`);
      } else if (DISCLOSES.test(m.source)) {
        stale.push(`${rel} — now carries the note, so the exemption is spent`);
      }
    }

    expect(
      stale,
      `${stale.length} stale exemption(s). An exception list that outlives its reason is how a ` +
        `module declares itself fine without anyone checking:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });
});

describe('the disclosure says the thing it exists to say', () => {
  it('names the credential, the silence, and what a zero means', () => {
    // The note is imported, not retyped — a test that restates the string it
    // checks agrees with any edit, including the edit that guts it. These
    // assert the CLAIMS a reader depends on, so a rewrite that drops one fails
    // while a rewrite that rephrases them does not.
    expect(CREDENTIAL_SCOPE_NOTE, 'must say the counts are bounded by the key')
      .toMatch(/THIS API KEY MAY SEE/);
    expect(CREDENTIAL_SCOPE_NOTE, 'must say the filtering is silent')
      .toMatch(/no warning/i);
    expect(
      CREDENTIAL_SCOPE_NOTE,
      "must say a zero is not an all-clear — tpmNotEnabled went 10 -> 0 under a scoped key"
    ).toMatch(/never 'none exist'/);
    expect(
      CREDENTIAL_SCOPE_NOTE,
      'must separate itself from resultTrustworthy, which reports only that the reads finished'
    ).toMatch(/resultTrustworthy/);
  });

  it('quotes no figure from our own estate', () => {
    // An earlier draft carried the measurement (27 -> 9, 2454 -> 1544, 170 -> 0)
    // because it made the warning concrete. Shipped, every customer's response
    // would carry OUR lab's numbers as though they described theirs — the
    // hallucinated-fact family inside the text written to prevent the
    // missing-fact one. The numbers belong in result-trust.ts's header.
    // An HTTP status code is not an estate figure, and naming the 200 is the
    // point of the sentence — the whole defect is that the filtering arrives
    // as a success. Everything else numeric is suspect.
    const digits = CREDENTIAL_SCOPE_NOTE.replace(/HTTP \d{3}/g, 'HTTP').match(/\d+/g) ?? [];
    expect(
      digits,
      `the disclosure quotes ${digits.length} number(s) (${digits.join(', ')}). Any figure here ` +
        `is from one estate — ours — and would be served to every reader as though it were theirs.`
    ).toEqual([]);
  });
});
