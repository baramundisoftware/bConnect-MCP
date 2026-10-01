/**
 * Local secrets stay local (REQ-REPO-001).
 *
 * The setup docs tell operators to copy an `.env*.example` template and fill in
 * the bConnect credential. Every such copy, in any directory, and a `secrets/`
 * directory must be ignored by git, so `git add .` can't commit them. The
 * templates themselves stay tracked.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    // check-ignore exits 1 when nothing is ignored; that's an answer, not a failure.
    const e = error as { status?: number; stdout?: string };
    return e.status === 1 ? (e.stdout ?? '') : null;
  }
}

const hasGit = git(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';

/** Paths an operator creates with real credentials, per the setup docs. */
const SECRET_PATHS = [
  '.env',
  '.env.gateway',
  '.env.production',
  '.env.local',
  'secrets/bconnect-password',
  'bconnect-jobs-mcp/.env',
  'bconnect-jobs-mcp/.env.local',
  'bconnect-mcp-gateway/.env.gateway',
];

const ignored = (paths: string[]): string[] =>
  (git(['check-ignore', '--no-index', ...paths]) ?? '').split('\n').filter(Boolean);

describe.skipIf(!hasGit)('local secrets are ignored by git', () => {
  it.each(SECRET_PATHS)('ignores %s', (path) => {
    expect(ignored([path])).toEqual([path]);
  });

  it('keeps every env template tracked and not ignored', () => {
    const templates = (git(['ls-files']) ?? '').split('\n').filter((f) => /(^|\/)\.env[^/]*\.example$/.test(f));
    expect(templates.length).toBeGreaterThan(0);
    expect(ignored(templates)).toEqual([]);
  });

  it('tracks no file that would hold a secret', () => {
    const tracked = (git(['ls-files']) ?? '').split('\n').filter(Boolean);
    const secretLike = tracked.filter((f) =>
      (/(^|\/)\.env(\.[^/]*)?$/.test(f) && !f.endsWith('.example')) || /(^|\/)secrets\//.test(f));
    expect(secretLike).toEqual([]);
  });
});
