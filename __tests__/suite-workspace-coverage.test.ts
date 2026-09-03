/**
 * Every package in this repo is inside the npm workspace set.
 *
 * ── The defect this exists to remove ────────────────────────────────────────
 * `bconnect-mcp-gateway` sat outside `workspaces` for the whole life of the
 * project, because the glob is `bconnect-*-mcp` and the gateway is
 * `bconnect-mcp-gateway` — it ends in `-gateway`, so the pattern never matched
 * it. Nobody excluded it; a naming convention quietly did.
 *
 * The consequence was not cosmetic. `npm audit` audits the root lockfile, and
 * the root lockfile had **zero** gateway entries (866 entries, none of them the
 * gateway, which kept its own 334-entry lock instead). So `npm audit`,
 * `npm ls`, the `audit` script's `--workspaces`, and every dependency bump ran
 * against a tree that did not include the one component in this repo that
 * listens on a socket.
 *
 * Measured both directions before the fix landed, by injecting a known-CVE
 * package (`minimist@1.2.0`) into the gateway's own package.json:
 *
 *   gateway OUTSIDE workspaces -> root `npm audit` said "found 0 vulnerabilities"
 *   gateway INSIDE  workspaces -> root `npm audit` reported it as critical, at
 *                                 path `bconnect-mcp-gateway/node_modules/minimist`
 *
 * ── Why this is a test and not a CI step ────────────────────────────────────
 * The failure mode was SILENCE. A missing workspace does not error, it just
 * quietly narrows what every other tool can see — which is why this survived
 * four rounds of review and an audit. The dependency audit in ci.yml is
 * deliberately `continue-on-error` (see the rationale there: pre-existing
 * advisory backlogs must not redden unrelated PRs). That policy is right, and
 * it is also exactly why it cannot catch this: a non-blocking job reporting on
 * an incomplete tree reports "clean" just as quietly.
 *
 * So the invariant that gets guarded here is not "no vulnerabilities" — it is
 * "nothing is invisible". Renaming a package to something the globs miss now
 * fails a test instead of silently shrinking the audit surface.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Turn an npm workspace glob into a matcher. npm supports a trailing `/*`. */
function globToMatcher(glob: string): (dir: string) => boolean {
  if (glob.endsWith('/*')) {
    const prefix = glob.slice(0, -2);
    return (dir) => dir.startsWith(`${prefix}/`) && dir.slice(prefix.length + 1).indexOf('/') === -1;
  }
  // `*` matches any run of characters within a single path segment.
  const rx = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
  return (dir) => rx.test(dir);
}

/** Every directory holding a package.json, one level deep and under packages/. */
function packageDirs(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(REPO, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) { continue; }
    if (existsSync(join(REPO, entry.name, 'package.json'))) { found.push(entry.name); }
    const nested = join(REPO, entry.name);
    for (const sub of readdirSync(nested, { withFileTypes: true })) {
      if (!sub.isDirectory() || sub.name === 'node_modules') { continue; }
      if (existsSync(join(nested, sub.name, 'package.json'))) { found.push(`${entry.name}/${sub.name}`); }
    }
  }
  return found;
}

describe('npm workspace coverage', () => {
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { workspaces: string[] };
  const matchers = root.workspaces.map(globToMatcher);
  const dirs = packageDirs();

  it('finds the packages it is supposed to be checking', () => {
    // A matcher bug that returned an empty directory list would make every
    // assertion below vacuously true. Pin the shape instead: 13 servers, the
    // gateway, the template, and mcp-core.
    expect(dirs.length).toBeGreaterThanOrEqual(16);
    expect(dirs).toContain('bconnect-mcp-gateway');
    expect(dirs).toContain('packages/mcp-core');
  });

  it('every package directory is matched by a workspace glob', () => {
    const orphans = dirs.filter((d) => !matchers.some((m) => m(d)));
    expect(
      orphans,
      `these directories have a package.json but no workspace glob matches them, so npm audit ` +
      `and every dependency tool silently ignore them: ${orphans.join(', ')}`
    ).toEqual([]);
  });

  it('the gateway specifically is a workspace', () => {
    // Named on its own because this is the one that was actually broken, and
    // because it is the only component here that listens on a socket.
    expect(matchers.some((m) => m('bconnect-mcp-gateway'))).toBe(true);
  });

  it('no package keeps a nested package-lock.json shadowing the root lock', () => {
    // The gateway kept its own 334-entry lock while outside the workspace set.
    // Inside one, a nested lock is dead weight that npm ignores but humans read.
    const strays = dirs.filter((d) => existsSync(join(REPO, d, 'package-lock.json')));
    expect(strays, `nested lockfiles shadow the root lock: ${strays.join(', ')}`).toEqual([]);
  });

  it('the root lockfile actually contains an entry for every workspace', () => {
    // The globs matching is necessary but not sufficient — this is the fact
    // `npm audit` depends on, so assert the outcome rather than the config.
    const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    const missing = dirs.filter((d) => !(d in lock.packages));
    expect(
      missing,
      `present on disk and matched by a glob, but absent from package-lock.json — ` +
      `run npm install: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
