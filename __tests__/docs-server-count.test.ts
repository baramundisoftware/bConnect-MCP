/**
 * A document that tells a reader how many servers there are must be right.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `docs-tool-counts.test.ts` guards the TOOL numbers, and it works: the README
 * has said "141 tools across 14 servers" correctly since insights shipped.
 * Nothing guarded the PROSE beside it. Measured 2026-08-23, while assessing
 * whether the tree was fit to propose to the vendor:
 *
 *     README.md:7    141 tools ... across 14 servers      <- guarded, correct
 *     README.md:96   The 13 servers share a common package
 *     README.md:478  serves all 13 servers on a single HTTP port
 *     SECURITY.md:51 Thirteen MCP servers plus an optional gateway
 *
 * Nineteen such claims across eight shipped documents, including the first
 * paragraph of SECURITY.md and the opening line of the installation guide — a
 * reader's first impression contradicting the guarded number a few lines above.
 * The same defect shape as everything else here: a checked number sitting
 * beside an unchecked sentence that says the same thing in words.
 *
 * ── What counts as a claim, and the correction that shaped it ───────────────
 * TOTALITY phrasings only: "all N servers", "the N servers", "N MCP servers",
 * and "(N servers)" with the paren closing immediately.
 *
 * The first draft matched any cardinal before "servers" and was WRONG on three
 * lines — "across 9 servers" and "(9 servers, 80 tool schemas)" are the
 * write-enabled SUBSET, and "how eleven servers kept a defect" is a subset at a
 * moment in time. All three are true sentences, and a guard that flagged them
 * would have pushed a reader to edit truth into error. That is the failure mode
 * worth naming: a documentation guard is not neutral — a false positive here
 * actively argues for a wrong change.
 *
 * ── The allowlist, currently empty ──────────────────────────────────────────
 * Narrowing the matcher turned out to remove every historical match, so
 * `HISTORICAL` is empty. The mechanism stays, with the staleness ratchet
 * `suite-no-hardcoded-server-lists` uses, because the next sentence that was
 * true when written and is false now will need it — and rewriting history to
 * satisfy a counter would make the document wrong.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** The count, discovered — never written down. */
const SERVER_COUNT = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^bconnect-.+-mcp$/.test(e.name))
  .length;

/**
 * Documents a user reads — DISCOVERED, not listed.
 *
 * The first draft named eleven files by hand, which is the defect
 * `suite-no-hardcoded-server-lists` exists to forbid, and it had already gone
 * wrong: CHANGELOG.md was absent from the list for no reason anyone had
 * decided, so three stale claims in it were invisible to the guard while a
 * plain grep found them. The exclusion turned out to be CORRECT and the
 * reasoning did not exist — which is exactly the shape this suite calls a
 * defect. Discovery plus a named exclusion makes the reasoning explicit, and a
 * document added next month is scanned without anyone remembering this file.
 *
 * `install/` sits beside the suite in the working repository and inside it in
 * the publication cut, so both are walked — the layout-independence lesson from
 * `gateway-launchers-preload`.
 */
const DOC_ROOTS = ['.', 'docs', 'install', '../install'];

/**
 * Documents that state counts which were true WHEN WRITTEN. The value is why.
 */
const EXCLUDED: Record<string, string> = {
  'CHANGELOG.md':
    'a changelog is history by definition — its entries describe the release ' +
    'they shipped in, and "INT-53 across all 13 servers" was true of that ' +
    'release. Correcting it would falsify the record rather than fix it.',
};

function docFiles(): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const dir of DOC_ROOTS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) {continue;}
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {continue;}
      if (entry.name in EXCLUDED) {continue;}
      // '../install/X' and 'install/X' are the same file in one layout or the
      // other, never both.
      const key = `${dir.replace(/^\.\.\//, '')}/${entry.name}`.replace(/^\.\//, '');
      if (seen.has(key)) {continue;}
      seen.add(key);
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Sentences that state a HISTORICAL count and are correct as written.
 * The value is why. An entry that stops matching fails below rather than
 * lingering, so this list can only shrink.
 */
const HISTORICAL: Record<string, string> = {
  // Currently EMPTY, and that is a result rather than an oversight: once the
  // matcher was narrowed to totality claims, no historical sentence matched.
  // "eleven of thirteen servers" and "how eleven servers kept a defect" are
  // subset claims about a moment in time and are correct as written. The
  // mechanism stays, because the next true-then-false-now sentence will need it.
};

const NUMBER_WORDS: Record<string, number> = {
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
};

interface Claim {
  doc: string;
  line: number;
  text: string;
  count: number;
}

function claims(): Claim[] {
  const found: Claim[] = [];
  const seen = new Set<string>();

  for (const rel of docFiles()) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) {continue;}
    const key = rel.replace(/^\.\.\//, '').split('\\').join('/');
    if (seen.has(key)) {continue;}
    seen.add(key);

    readFileSync(path, 'utf8').split(/\r?\n/).forEach((text, i) => {
      // TOTALITY phrasings only. "across 9 servers" is a SUBSET claim — nine of
      // the fourteen carry write tools — and flagging it would push a reader to
      // "correct" a true sentence into a false one. The first draft of this
      // matcher did exactly that on three lines, which is why the rule now
      // requires an article or an explicit "MCP": "all N servers", "the N
      // servers", "N MCP servers", "(N servers)".
      const NUM = String.raw`\d{1,2}|eleven|twelve|thirteen|fourteen|fifteen|sixteen`;
      // The parenthesised form must CLOSE immediately: "(14 servers)" is the
      // whole set, while "(9 servers, 80 tool schemas)" is the write-enabled
      // subset. Without the closing paren the second one matched too, which
      // would have argued a true sentence into a false one.
      const re = new RegExp(
        String.raw`\b(?:all|the)\s+(${NUM})\s+servers\b` + '|' +
          String.raw`\((${NUM})\s+servers\)` + '|' +
          String.raw`\b(${NUM})\s+MCP\s+servers\b`,
        'gi'
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = (m[1] ?? m[2] ?? m[3]).toLowerCase();
        const count = NUMBER_WORDS[raw] ?? Number(raw);
        if (!Number.isFinite(count)) {continue;}
        found.push({ doc: key, line: i + 1, text: text.trim(), count });
      }
    });
  }
  return found;
}

function isHistorical(text: string): string | null {
  for (const [phrase, reason] of Object.entries(HISTORICAL)) {
    if (text.toLowerCase().includes(phrase)) {return reason;}
  }
  return null;
}

describe('the documents agree with how many servers there are', () => {
  const all = claims();

  it('finds the claims at all — the canary', () => {
    // Counted a second way and required to agree: if the scan stopped matching,
    // "no wrong claims" would pass over nothing. This project's own
    // `CALLS.length >= 9` floor moved in lockstep with its blind spot.
    expect(SERVER_COUNT, 'no bconnect-*-mcp directories were discovered').toBeGreaterThanOrEqual(14);
    expect(
      all.length,
      'no document states a server count — either the docs changed shape or ' +
        'the matcher stopped working, and every assertion below is then vacuous'
    ).toBeGreaterThanOrEqual(10);
  });

  it('states the real count everywhere it is not describing history', () => {
    const wrong = all
      .filter((c) => c.count !== SERVER_COUNT)
      .filter((c) => isHistorical(c.text) === null)
      .map((c) => `${c.doc}:${c.line} says ${c.count}, not ${SERVER_COUNT} — "${c.text.slice(0, 90)}"`);

    expect(
      wrong,
      `a reader is told a server count that disagrees with the ${SERVER_COUNT} ` +
        `directories on disk. Fix the sentence, or — if it is describing what ` +
        `was true at the time — add the phrase to HISTORICAL with its reason.`
    ).toEqual([]);
  });

  it('scans every shipped document except the ones excluded with a reason', () => {
    // The blind spot that prompted discovery: a document nobody listed is a
    // document nobody checks, and its absence reads identically to a clean
    // result. Every exclusion must still exist, or it is a permission left
    // lying around.
    const scanned = new Set(all.map((c) => c.doc));
    expect(scanned.size, 'no document was scanned at all').toBeGreaterThanOrEqual(4);

    for (const [name, reason] of Object.entries(EXCLUDED)) {
      expect(
        existsSync(join(ROOT, name)),
        `${name} is excluded (${reason}) but no longer exists — delete the entry`
      ).toBe(true);
    }
  });

  it('has no HISTORICAL entry that has gone stale', () => {
    // The ratchet's other direction: an exemption whose sentence no longer
    // exists is a permission nobody re-examines.
    const texts = all.map((c) => c.text.toLowerCase());
    const unused = Object.keys(HISTORICAL).filter(
      (phrase) => !texts.some((t) => t.includes(phrase))
    );
    expect(unused, 'these no longer match any sentence — delete their entry').toEqual([]);
  });
});
