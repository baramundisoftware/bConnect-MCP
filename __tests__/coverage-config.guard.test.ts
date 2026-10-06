/**
 * Coverage config guard.
 *
 * Coverage is measured by ONE root run (`npm run test:coverage`) over every
 * shipped workspace: the shared core, the 13 servers and the gateway. The
 * per-workspace runs it replaced saw only their own tests, skipped index.ts and
 * never measured the core, so they reported 4–31 % for servers at 100 %.
 *
 * 1. Every shipped workspace on disk is in the coverage `include` and has its
 *    own floor. A workspace that is not included is not measured, and nothing
 *    says so; that is how the gateway and the core went unmeasured before.
 * 2. No floor names a workspace that does not exist (a renamed one would keep
 *    a floor that checks nothing).
 * 3. `@bconnect/mcp-core` resolves to the core's source in the unit run, so
 *    core code run through a server counts. Through the build it does not.
 * 4. The CI coverage job runs that root script, and a floor miss fails it.
 *    It is not a required check (ci-workflow.guard pins that list).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import config, { COVERAGE_INCLUDE } from '../vitest.config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Not shipped: a starting point for new servers, never built into the image. */
const NOT_SHIPPED = ['bconnect-server-template'];

/**
 * Directories with a package.json and a src/, at the root and under packages/.
 * A new one fails this guard until it gets a floor or is listed in NOT_SHIPPED.
 */
function shippedWorkspaces(): string[] {
  const dirs = (base: string) =>
    readdirSync(join(ROOT, base), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
      .map((e) => (base === '.' ? e.name : `${base}/${e.name}`))
      .filter((d) => existsSync(join(ROOT, d, 'package.json')) && existsSync(join(ROOT, d, 'src')));
  return [...dirs('.'), ...dirs('packages')].filter((d) => !NOT_SHIPPED.includes(d)).sort();
}

/** `**` spans directories, `*` stays within one segment: enough for the include and exclude lists. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^$()|[\]{}\\]/g, '\\$&');
  const parts: Record<string, string> = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*' };
  return new RegExp('^' + escaped.replace(/\*\*\/?|\*/g, (m) => parts[m]) + '$');
}
const isIncluded = (path: string) => COVERAGE_INCLUDE.some((g) => globToRegExp(g).test(path));

const coverage = config.test?.coverage as {
  include?: string[];
  exclude?: string[];
  thresholds?: Record<string, unknown>;
};
const thresholds = coverage.thresholds ?? {};
const isExcluded = (path: string) => (coverage.exclude ?? []).some((g) => globToRegExp(g).test(path));
const workspaceFloors = Object.keys(thresholds).filter((k) => k.endsWith('/src/**'));

describe('coverage config', () => {
  const workspaces = shippedWorkspaces();

  it('finds the core, 13 servers and the gateway', () => {
    expect(workspaces).toContain('packages/mcp-core');
    expect(workspaces).toContain('bconnect-mcp-gateway');
    expect(workspaces.filter((w) => /^bconnect-.+-mcp$/.test(w))).toHaveLength(13);
  });

  it('the coverage run uses the exported include list', () => {
    expect(coverage.include).toEqual(COVERAGE_INCLUDE);
  });

  it.each(workspaces)('%s is in the coverage include, entry point not excluded', (ws) => {
    expect(isIncluded(`${ws}/src/index.ts`)).toBe(true);
    expect(isExcluded(`${ws}/src/index.ts`)).toBe(false);
  });

  it.each(workspaces)('%s has a lines and a branches floor', (ws) => {
    const floor = thresholds[`${ws}/src/**`] as { lines?: unknown; branches?: unknown } | undefined;
    expect(floor, `no floor for ${ws}`).toBeDefined();
    expect(typeof floor?.lines).toBe('number');
    expect(typeof floor?.branches).toBe('number');
  });

  it('every floor names a shipped workspace', () => {
    expect(workspaceFloors.map((k) => k.slice(0, -'/src/**'.length)).sort()).toEqual(workspaces);
  });

  it('the include list matches source files, not tests elsewhere', () => {
    expect(isIncluded('bconnect-jobs-mcp/src/handlers/jobs.ts')).toBe(true);
    expect(isIncluded('bconnect-mcp-gateway/src/app.ts')).toBe(true);
    expect(isIncluded('__tests__/host-check.test.ts')).toBe(false);
    expect(isIncluded('bconnect-jobs-mcp/build/index.js')).toBe(false);
    expect(isExcluded('bconnect-jobs-mcp/src/__tests__/jobs.test.ts')).toBe(true);
    expect(isExcluded('bconnect-jobs-mcp/src/generated/api.ts')).toBe(true);
  });

  it('the template is not measured', () => {
    for (const ws of NOT_SHIPPED) expect(isIncluded(`${ws}/src/index.ts`)).toBe(false);
  });

  it('keeps the total floors', () => {
    expect(thresholds.lines).toBeGreaterThanOrEqual(95);
    expect(thresholds.branches).toBeGreaterThanOrEqual(85);
  });
});

describe('core alias', () => {
  it('@bconnect/mcp-core points at the core source', () => {
    const alias = (config.resolve?.alias ?? []) as Array<{ find: RegExp; replacement: string }>;
    const core = alias.filter((a) => a.find.test('@bconnect/mcp-core'));
    expect(core.map((a) => a.replacement)).toEqual([join(ROOT, 'packages', 'mcp-core', 'src', 'index.ts')]);
    expect(core[0].find.test('@bconnect/mcp-core/x')).toBe(false);
  });

  it('a server importing the core by name gets the source copy', async () => {
    const byName = await import('@bconnect/mcp-core');
    const bySource = await import('../packages/mcp-core/src/index.js');
    expect(byName.BConnectClientBase).toBe(bySource.BConnectClientBase);
  });
});

describe('CI coverage job', () => {
  const workflow = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
    jobs: Record<string, { 'continue-on-error'?: unknown; steps?: Array<{ run?: string; uses?: string }> }>;
  };
  const job = workflow.jobs.coverage;

  it('runs the root coverage script once', () => {
    const runs = (job?.steps ?? []).map((s) => s.run ?? '').filter((r) => r.includes('coverage'));
    expect(runs).toEqual(['npm run test:coverage']);
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('fails the job below a floor (no continue-on-error)', () => {
    expect(job?.['continue-on-error']).toBeUndefined();
  });
});
