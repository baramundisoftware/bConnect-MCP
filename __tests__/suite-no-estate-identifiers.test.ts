/**
 * No live-estate identifier may survive into a publication cut.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The previous cut's estate scrub was done BY HAND across 84 files and
 * "verified by an independent sweep" — a one-time human check with nothing to
 * re-run. The tree then went stale at 215 commits, and regenerating it meant
 * redoing the scrub by hand, with the same one-time verification. A scrub that
 * cannot be re-checked is a scrub you have to trust rather than read.
 *
 * ── Why the identifiers are hashed and not written down ─────────────────────
 * A guard that greps for the lab's domain contains that domain, and it ships to
 * the public repository. Naming what you removed, in the file that proves you
 * removed it, publishes the thing. So the forbidden tokens are stored as salted
 * SHA-256 and the tree is matched against them.
 *
 * This is not hypothetical: the first draft of this file spelled the domain out
 * in the sentence above and the endpoint's name in the one below, and the guard
 * failed on its own source. It was right to.
 *
 * This is OBFUSCATION, not secrecy, and saying so plainly matters more than the
 * hashing does: a salted hash of a short token is guessable by anyone who
 * already suspects the answer. What it buys is that the identifier is not
 * PUBLISHED — nobody reading this file learns it who did not already know it.
 * The protection that counts is that the strings are absent from the tree.
 *
 * ── Why it does not simply always enforce ───────────────────────────────────
 * This file ships, so it also runs in the working repository, where these
 * identifiers legitimately exist — it is a lab that talks to a real bMS. It
 * therefore enforces only when `.publication-cut` says it is looking at a cut.
 *
 * That marker is the one thing here that could fail silently, which is the
 * defect class this repository has hit most often (`test-catalog-drift` skipping
 * on a path that never resolved, and printing "skipped" where nobody read it).
 * So the skip is NOT silent: the no-marker branch still asserts that the hash
 * list is well-formed and non-empty, so the guard cannot rot into a no-op while
 * reporting success, and it says out loud which mode it ran in.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const SALT = 'bconnect-mcp-publication-scrub-v1';

/**
 * Salted SHA-256 of each forbidden token, lower-cased.
 *
 * The lengths are recorded because the scan hashes only tokens of a matching
 * length, which is what keeps it fast. That does disclose how long each
 * identifier is; see the header on why that trade is acceptable.
 */
const FORBIDDEN: ReadonlyArray<{ hash: string; length: number }> = [
  { hash: 'cd99eccf4e531b77088dd84149406d7b4313b7b0bd5b13fa094093e68c18b1c4', length: 7 },
  { hash: '1427d2e7bc8faca9acc196a9cac5a56896498303b7544c024fde8060ff909b06', length: 8 },
  { hash: '2ad90efb7a3877c5e3a027e25862943123c9be9130ed41761e11fb6df1e5f74c', length: 12 },
  // The operator's account name. Added after a scrubbed UPN still shipped its
  // local part: replacing the domain half of an address leaves behind most of
  // what identified it.
  { hash: 'b6aaa4d6fb1370dfdd747187f2ba43bdca1eb64f64fd70ad2ec7b4c345f97502', length: 7 },
  // The development machine's working-tree directory. Found by a sweep for
  // absolute local paths rather than by the identifier list — and found ONLY in
  // its comment, because the shipped default that mattered more was spelled with
  // doubled backslashes and the sweep's own pattern could not match it. The same
  // escape-blindness as the two defects above, in the instrument this time.
  { hash: '7a0b67db8d6c180b21340d6fdd442d97fd01eadff93115820441a0953d45db60', length: 12 },
];

const FORBIDDEN_HASHES = new Set(FORBIDDEN.map((f) => f.hash));
const FORBIDDEN_LENGTHS = new Set(FORBIDDEN.map((f) => f.length));

const BINARY = /\.(png|jpg|jpeg|gif|ico|zip|gz|docx|xlsx|pdf|woff2?|ttf|exe|dll)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'coverage', 'out']);

/** Words, hostname labels and hyphenated names — the shapes an identifier takes. */
const TOKEN = /[A-Za-z0-9-]+/g;

/**
 * JavaScript escapes and template interpolations, DECODED before tokenising.
 *
 * Found the hard way, twice. The sanitisation suites carry thirteen strings in
 * which the write-test endpoint's name is written with a zero-width escape in
 * the MIDDLE of it, because that is exactly what those suites exist to strip.
 * Tokenising such a string on the raw text splits it at the backslash into two
 * fragments, neither of which is the forbidden token, so a leftover would have
 * passed this guard while sitting in the tree in plain sight.
 *
 * The first fix STRIPPED escapes, which handles that case and not its twin.
 * Mutation-testing this guard with one of the forbidden names spelled so that a
 * LETTER OF THE NAME ITSELF was written as its own `\u00NN` escape passed
 * cleanly: stripping that escape deletes the letter, leaving a six-character
 * word that is not the token. Stripping fixes an invisible character INSERTED
 * into a name; only decoding fixes a character of the name ENCODED as an escape.
 *
 * (Written without quoting either spelling. The first draft of this paragraph
 * illustrated the point with the real domain, and this guard failed on its own
 * source — correctly, and while proving the case it was describing.)
 *
 * So: decode, then remove the invisible class, then tokenise. Decoding alone
 * would reintroduce the first problem — a decoded zero-width space is still a
 * token separator — so both steps are needed, and neither is sufficient.
 * A VALUE PRESENT BUT WRITTEN DIFFERENTLY IS NOT A VALUE ABSENT.
 */
const JS_ESCAPE = /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g;
const INTERPOLATION = /\$\{[^{}]*\}/g;

/**
 * Characters that carry no width — the class this project's own sanitiser
 * removes from estate text, for the same reason: they hide structure inside
 * something that looks like one word.
 */
const INVISIBLE =
  /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁩ㅤ﻿ﾠ]|[\u{E0000}-\u{E007F}]/gu;

/** Decode escapes, drop interpolations, then remove the invisible class. */
function normalise(text: string): string {
  return text
    .replace(JS_ESCAPE, (_m, braced?: string, four?: string, hex?: string) => {
      const code = parseInt(braced ?? four ?? hex ?? '', 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(INTERPOLATION, '')
    .replace(INVISIBLE, '');
}

function textFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {continue;}
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      textFiles(full, out);
    } else if (!BINARY.test(entry.name) && statSync(full).size < 8 * 1024 * 1024) {
      out.push(full);
    }
  }
  return out;
}

const hash = (token: string): string =>
  createHash('sha256').update(SALT + token.toLowerCase()).digest('hex');

describe('no live-estate identifier survives into a publication cut', () => {
  const isCut = existsSync(join(ROOT, '.publication-cut'));

  it('has a well-formed, non-empty forbidden list', () => {
    // Runs in BOTH trees. Without this the guard could lose its list and still
    // report success in the cut, which is the failure it exists to prevent.
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(3);
    for (const { hash: h, length } of FORBIDDEN) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(length).toBeGreaterThan(3);
    }
    expect(FORBIDDEN_HASHES.size, 'duplicate entries').toBe(FORBIDDEN.length);
  });

  it(
    isCut
      ? 'finds no forbidden identifier anywhere in the cut'
      : 'is running in the working repository, where these identifiers are legitimate',
    () => {
      if (!isCut) {
        // Deliberately not an enforcement. Stated out loud rather than skipped,
        // so a cut that somehow loses its marker is visible in the output
        // instead of passing quietly.
        expect(existsSync(join(ROOT, '.publication-cut'))).toBe(false);
        return;
      }

      const offenders: string[] = [];
      let scanned = 0;
      let tokensHashed = 0;

      for (const file of textFiles(ROOT)) {
        scanned++;
        const text = normalise(readFileSync(file, 'utf8'));
        TOKEN.lastIndex = 0;
        for (const m of text.matchAll(TOKEN)) {
          const token = m[0];
          if (!FORBIDDEN_LENGTHS.has(token.length)) {continue;}
          tokensHashed++;
          if (FORBIDDEN_HASHES.has(hash(token))) {
            const where = relative(ROOT, file).split(sep).join('/');
            if (!offenders.includes(where)) {offenders.push(where);}
          }
        }
      }

      // Canary: if the walk found nothing, every assertion below is vacuous.
      expect(scanned, 'the scan found no files — it is measuring nothing').toBeGreaterThan(100);
      expect(tokensHashed, 'no token of a forbidden length exists anywhere, which means the ' +
        'tokeniser is not producing the shapes the hashes were taken of').toBeGreaterThan(0);

      expect(
        offenders,
        `${offenders.length} file(s) still contain a live-estate identifier. Re-run ` +
          `scripts/scrub-estate.mjs against this tree from the source repository.`
      ).toEqual([]);
    }
  );
});
