import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No shipped document routes a customer to a mailbox.
 *
 * Security reports go through GitHub private vulnerability reporting; everything
 * else goes through issues or a contact the owner sets at publication time. The
 * defect this replaces was one named individual's address standing as the
 * support, security AND conduct channel across four files that ship — a channel
 * that stops existing the day that person does something else.
 *
 * The rule is "no address", not "not that address", for two reasons: writing the
 * old address into a test would re-ship the personal data the change removed,
 * and a role address added later still deserves a deliberate review rather than
 * arriving because a template had a slot for one. Adding one means editing the
 * allowlist below, on purpose.
 *
 * NOT covered: `package.json`'s `author.email`. It is a manifest field, it still
 * carries a personal address, and it is not this file's to change — but it is
 * the last remaining site and should be closed with the same decision.
 */

const ROOT = join(__dirname, '..');

/**
 * Email-shaped strings that are legitimate in shipped prose.
 *
 * `support@baramundi.com` was added deliberately on 2026-08-04, which is the
 * review this allowlist exists to force. It is a monitored role address, not an
 * individual's, so it survives any one person moving on — the property whose
 * absence made the original defect a defect.
 *
 * Where it may stand, and why each is a different decision:
 *   SUPPORT.md         the private route for a problem carrying estate detail a
 *                      customer cannot paste into a public issue.
 *   CODE_OF_CONDUCT.md a conduct report must not be filed in public, and must
 *                      not depend on one named maintainer reading their mail.
 *   SECURITY.md        the ALTERNATIVE channel only. GitHub private
 *                      vulnerability reporting remains preferred and is listed
 *                      first; this exists so a reporter without a GitHub account,
 *                      or barred from using one, still has somewhere to go. A
 *                      reporter with no workable channel discloses publicly or
 *                      not at all.
 *
 * Adding anything else here means making the same argument for it.
 */
const ALLOWED = new Set<string>(['support@baramundi.com']);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** The files `scripts/release.sh` puts in front of a customer. */
function shippedProse(): string[] {
  const files: string[] = [];
  for (const name of readdirSync(ROOT)) {
    if (name.endsWith('.md')) {files.push(join(ROOT, name));}
    if (name.endsWith('.env.example') || name === '.env.example') {files.push(join(ROOT, name));}
  }
  const docs = join(ROOT, 'docs');
  if (existsSync(docs)) {
    for (const name of readdirSync(docs)) {
      if (name.endsWith('.md')) {files.push(join(docs, name));}
    }
  }
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('bconnect-')) {continue;}
    for (const leaf of ['README.md', '.env.example']) {
      const candidate = join(ROOT, entry.name, leaf);
      if (existsSync(candidate)) {files.push(candidate);}
    }
  }
  return files;
}

describe('shipped documents carry no mailbox as a contact channel', () => {
  it('no README, guide or .env.example contains an email address', () => {
    const offenders: string[] = [];
    for (const file of shippedProse()) {
      for (const match of readFileSync(file, 'utf8').match(EMAIL) ?? []) {
        if (!ALLOWED.has(match)) {offenders.push(`${file.slice(ROOT.length + 1)}: ${match}`);}
      }
    }
    expect(
      offenders,
      'Security reports go through GitHub private vulnerability reporting and the email channel is ' +
        'dropped. If a role address is genuinely wanted, add it to ALLOWED here as a deliberate act:\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('SECURITY.md names the private-reporting channel it now relies on', () => {
    const text = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
    expect(text).toMatch(/private vulnerability reporting/i);
  });

  it('finds the whole shipped set rather than a subset that passes vacuously', () => {
    // The original defect survived because the address was checked in two files
    // and lived in five. A scan that silently matched nothing would pass too.
    const files = shippedProse();
    expect(files.length).toBeGreaterThanOrEqual(30);
    for (const required of ['SECURITY.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md']) {
      expect(files.some((f) => f.endsWith(required)), `${required} must be in scope`).toBe(true);
    }
  });
});
