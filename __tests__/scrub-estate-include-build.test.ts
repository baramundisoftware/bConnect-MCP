/**
 * scrub-estate.mjs --include-build: the flag the offline bundle depends on.
 *
 * ── Why build/ needs a flag at all ──────────────────────────────────────────
 * The publication cut never has a build/ directory — `git archive` exports
 * tracked files and build output is ignored — so the scrubber always skipped
 * `build` by name. The OFFLINE BUNDLE is different: it ships compiled output
 * beside src, tsc preserves comments, and the 2026-09-11 bundle acceptance
 * run found the identifiers the src scrub removes riding along in 20 built
 * .js/.d.ts files. `--include-build` closes that; DEFAULT OFF keeps the cut's
 * behaviour byte-identical.
 *
 * ── Why the probe token is a GUID and not an estate name ────────────────────
 * A literal estate name written here would itself be scrubbed when this test
 * ships in the publication cut — and the scrubber's own replacement table is
 * scrubbed too, so a name-derived assertion goes vacuous exactly where it
 * must keep working. GUID replacement has no such self-reference: any
 * non-vendor GUID is rewritten deterministically, in the working tree and in
 * the cut alike, so the same assertion is non-vacuous in both.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(__dirname, '..');
const SCRUB = join(ROOT, 'scripts', 'scrub-estate.mjs');
const GUID = 'e57a7e00-0000-4000-8000-000000000042';

/**
 * The scrubber DOES NOT SHIP in a publication cut — its table is the plaintext
 * identifier list, which is exactly what the cut must not carry (the shipping
 * guard matches salted hashes for the same reason). So in the cut the three
 * behavioural tests below skip — visibly, never with a bare return — and the
 * presence test keeps the skip honest: the only tree allowed to lack the
 * scrubber is one carrying the cut marker. The first cut that ran this file
 * proved the point by failing: the tests tried to execute a script that is
 * deliberately absent there.
 */
const scrubberShips = existsSync(SCRUB);

function probeTree(): string {
  const tree = mkdtempSync(join(tmpdir(), 'scrub-probe-'));
  mkdirSync(join(tree, 'pkg', 'src'), { recursive: true });
  mkdirSync(join(tree, 'pkg', 'build'), { recursive: true });
  writeFileSync(join(tree, 'pkg', 'src', 'a.ts'), `// measured against ${GUID}\n`);
  writeFileSync(join(tree, 'pkg', 'build', 'a.js'), `// measured against ${GUID}\n`);
  return tree;
}

function scrub(tree: string, ...flags: string[]): void {
  execFileSync(process.execPath, [SCRUB, tree, ...flags], { stdio: 'pipe' });
}

describe('the scrubber ships exactly where it must', () => {
  it('is present in the working repository, or this tree is a marked cut', () => {
    // Runs EVERYWHERE. Without it, the skips below could quietly hide the
    // scrubber going missing from the working repository itself.
    expect(scrubberShips || existsSync(join(ROOT, '.publication-cut'))).toBe(true);
  });
});

describe.skipIf(!scrubberShips)('scrub-estate --include-build', () => {
  it('without the flag, src is scrubbed and build/ is left byte-identical (the cut path)', () => {
    const tree = probeTree();
    try {
      scrub(tree);
      const src = readFileSync(join(tree, 'pkg', 'src', 'a.ts'), 'utf8');
      const build = readFileSync(join(tree, 'pkg', 'build', 'a.js'), 'utf8');
      // Vacuity guard first: the scrub must have DONE something to src, or
      // every assertion below is agreement between two untouched files.
      expect(src).not.toContain(GUID);
      expect(build).toContain(GUID);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('with the flag, build/ is scrubbed exactly like src (the bundle path)', () => {
    const tree = probeTree();
    try {
      scrub(tree, '--include-build');
      const src = readFileSync(join(tree, 'pkg', 'src', 'a.ts'), 'utf8');
      const build = readFileSync(join(tree, 'pkg', 'build', 'a.js'), 'utf8');
      expect(src).not.toContain(GUID);
      expect(build).not.toContain(GUID);
      // Same replacement, not merely "also changed": both files started
      // byte-identical, so a deterministic scrub must leave them byte-identical.
      expect(build).toBe(src);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('a bare flag with no tree is refused, not treated as the tree', () => {
    expect(() =>
      execFileSync(process.execPath, [SCRUB, '--include-build'], { stdio: 'pipe' })
    ).toThrow();
  });
});
