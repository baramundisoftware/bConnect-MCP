/**
 * The live tier refuses an outdated build (#273): a server or the shared core
 * whose sources are newer than its build would test old code against a live bMS.
 * No bMS needed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, SERVERS } from '../lib/exerciser.js';
import { checkBuilds, outdatedBuilds } from './lib/build.js';

const dir = mkdtempSync(join(tmpdir(), 'live-build-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A package with one source file and, unless `built` is undefined, a build, at the given times (s). */
function pkg(name: string, source: number, built: number | undefined, extra: Record<string, number> = {}): string {
  const root = join(dir, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  const files: Record<string, number> = { 'src/index.ts': source, ...extra };
  for (const [file, time] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), '');
    utimesSync(join(root, file), time, time);
  }
  if (built !== undefined) {
    mkdirSync(join(root, 'build'), { recursive: true });
    writeFileSync(join(root, 'build', 'index.js'), '');
    utimesSync(join(root, 'build', 'index.js'), built, built);
  }
  return name;
}

describe('outdatedBuilds', () => {
  const fresh = pkg('fresh', 1000, 2000);
  const stale = pkg('stale', 3000, 2000);
  const missing = pkg('missing', 1000, undefined);
  const nested = pkg('nested', 1000, 2000, { 'src/modules/deep.ts': 3000 });
  const ignored = pkg('ignored', 1000, 2000, { 'src/__tests__/x.test.ts': 3000, 'src/types.d.ts': 3000 });

  it('accepts packages whose build is newer than every source file', () => {
    expect(outdatedBuilds(dir, [fresh, ignored])).toEqual([]);
  });

  it('names a package with a newer source file, also in a subdirectory, and one without a build', () => {
    const problems = outdatedBuilds(dir, [fresh, stale, missing, nested]);
    expect(problems.map((p) => p.pkg)).toEqual([stale, missing, nested]);
    expect(problems.find((p) => p.pkg === missing)?.reason).toMatch(/not built/);
    expect(problems.find((p) => p.pkg === nested)?.reason).toMatch(/src[\\/]modules[\\/]deep\.ts/);
  });

  it('checkBuilds stops with one message naming every package and the command to run', () => {
    expect(() => checkBuilds(dir, [fresh])).not.toThrow();
    expect(() => checkBuilds(dir, [fresh, stale, missing])).toThrow(/stale[\s\S]*missing[\s\S]*npm run build/);
  });
});

describe('live tier', () => {
  const source = readFileSync(join(ROOT, '__tests__', 'live', 'bms-live.test.ts'), 'utf8');

  it('checks the core and every server build before the first request', () => {
    const check = source.search(/^checkBuilds\(ROOT, \['packages\/mcp-core', \.\.\.SERVERS\]\);$/m);
    expect(check).toBeGreaterThan(-1);
    // Module level, ahead of the reachability check (the first request to bMS) and every test.
    expect(check).toBeLessThan(source.indexOf('checkReachable(config)'));
    expect(check).toBeLessThan(source.indexOf('describe('));
  });

  it('finds the core and the servers built in this checkout', () => {
    expect(SERVERS.length).toBe(13);
    expect(outdatedBuilds(ROOT, ['packages/mcp-core', ...SERVERS]).map((p) => `${p.pkg}: ${p.reason}`)).toEqual([]);
  });
});
