/**
 * Contact address guard (#341): the only baramundi address in the repository
 * is support@baramundi.com.
 *
 * SUPPORT.md, SECURITY.md, CODE_OF_CONDUCT.md, TROUBLESHOOTING.md and the
 * package author named a personal address. Every tracked text file is
 * scanned, so a new document can't bring one back.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';

const CONTACT = 'support@baramundi.com';
const ADDRESS = /[A-Za-z0-9._%+-]+@baramundi\.(?:com|de)\b/g;

/** Tracked files; binary files and the spec downloads hold no contact address. */
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '' && !file.startsWith('openapi-specs/') && !/\.(png|jpe?g|gif|ico|zip|gz)$/i.test(file));

/** Every baramundi address a text names other than the support address. */
function otherAddresses(text: string): string[] {
  return [...text.matchAll(ADDRESS)].map((m) => m[0]).filter((address) => address.toLowerCase() !== CONTACT);
}

describe('contact address guard', () => {
  it('finds a personal address and lets the support address pass', () => {
    // Split, so this file doesn't name a personal address itself.
    const personal = 'jane.doe' + '@baramundi.de';
    expect(otherAddresses(`mail ${personal} or support@baramundi.com`)).toEqual([personal]);
    expect(otherAddresses('Support@Baramundi.com')).toEqual([]);
  });

  it('no tracked file names a baramundi address other than support@baramundi.com', () => {
    expect(tracked.length).toBeGreaterThan(100);
    const found = tracked.flatMap((file) => otherAddresses(readFileSync(join(ROOT, file), 'utf8')).map((a) => `${file}: ${a}`));
    expect(found).toEqual([]);
  });

  it.each(['SUPPORT.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'docs/TROUBLESHOOTING.md'])('%s names the support address', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(CONTACT);
  });

  it('the package author is the support address', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { author: { email: string } };
    expect(manifest.author.email).toBe(CONTACT);
  });
});
