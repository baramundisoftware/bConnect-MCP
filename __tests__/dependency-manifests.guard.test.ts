/**
 * Dependency manifest guard (REQ-DEP-001).
 *
 * - dotenv stays on major 16 in every manifest: from 17 on it logs to stdout by
 *   default, which corrupts the JSON-RPC stream of a stdio MCP server.
 * - Build-time tools are devDependencies, so they aren't shipped (or audited) as
 *   runtime code.
 * - Every package the root tests import is declared at the root, not reached
 *   through another package's dependencies.
 * - In the shipped packages (core, servers, template, gateway) the runtime
 *   dependencies are exactly what the non-test sources import: nothing unused is
 *   shipped, and nothing works only because npm hoisted another package's copy.
 * - One Express major, 5, declared as it runs (REQ-DEP-002, #69): the root lockfile
 *   holds one express and one @types/express; the gateway, which isn't a workspace
 *   member and runs on the root install, has no lockfile of its own, and every
 *   version it declares is the one the root lockfile installs.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const read = (dir: string): Manifest => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));

const MANIFEST_DIRS = [
  '.',
  'bconnect-mcp-gateway',
  'bconnect-server-template',
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway'),
  ...readdirSync(join(ROOT, 'packages')).map((d) => join('packages', d)),
].sort();

/** Code generators and packaging tools: never runtime dependencies. */
const BUILD_TOOLS = ['openapi-typescript', '@cyclonedx/cyclonedx-npm', 'typescript'];

describe.each(MANIFEST_DIRS)('%s/package.json', (dir) => {
  const manifest = read(dir);
  const all = { ...manifest.dependencies, ...manifest.devDependencies };

  it('keeps dotenv on major 16', () => {
    if (!all.dotenv) return;
    expect(all.dotenv).toMatch(/^[~^]?16\./);
  });

  it('lists build-time tools only as devDependencies', () => {
    expect(BUILD_TOOLS.filter((name) => name in (manifest.dependencies ?? {}))).toEqual([]);
  });
});

it('declares every package the root tests import', () => {
  const root = read('.');
  const declared = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})]);
  const testDirs = ['__tests__', join('__tests__', 'lib')];
  const imported = new Set<string>();
  for (const dir of testDirs) {
    for (const file of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(ROOT, dir, file), 'utf8');
      for (const [, spec] of text.matchAll(/from ['"]([^'".][^'"]*)['"]/g)) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!spec.startsWith('node:') && !builtinModules.includes(name)) imported.add(name);
      }
    }
  }
  expect([...imported].filter((name) => !declared.has(name)).sort()).toEqual([]);
});

/** The npm packages a directory's non-test sources import (no relative paths, no Node built-ins). */
function sourceImports(dir: string): Set<string> {
  const found = new Set<string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!['node_modules', 'build', 'dist', 'generated', '__tests__'].includes(entry.name)) walk(join(current, entry.name));
        continue;
      }
      if (!/\.(ts|js|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      const text = readFileSync(join(current, entry.name), 'utf8');
      for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!spec.startsWith('node:') && !builtinModules.includes(name)) found.add(name);
      }
    }
  };
  walk(join(ROOT, dir, 'src'));
  return found;
}

describe.each(MANIFEST_DIRS.filter((dir) => dir !== '.'))('%s runtime dependencies', (dir) => {
  it('are exactly what its sources import (none unused, none undeclared)', () => {
    const declared = Object.keys(read(dir).dependencies ?? {}).sort();
    const imported = [...sourceImports(dir)].sort();
    expect({ unused: declared.filter((n) => !imported.includes(n)), undeclared: imported.filter((n) => !declared.includes(n)) })
      .toEqual({ unused: [], undeclared: [] });
  });
});

it('the root declares no runtime dependency that nothing in the repository imports', () => {
  const dirs = MANIFEST_DIRS.filter((dir) => dir !== '.');
  const used = new Set(dirs.flatMap((dir) => [...sourceImports(dir)]));
  const rootTests = readdirSync(join(ROOT, '__tests__'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
  for (const file of rootTests) {
    const text = readFileSync(join(ROOT, '__tests__', file), 'utf8');
    for (const [, spec] of text.matchAll(/from ['"]([^'".][^'"]*)['"]/g)) {
      used.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  }
  expect(Object.keys(read('.').dependencies ?? {}).filter((n) => !used.has(n)).sort()).toEqual([]);
});

describe('root workspaces', () => {
  const workspaces: string[] = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).workspaces ?? [];

  it('use no wildcard inside a name (Dependabot expands only a trailing "/*" and drops such workspaces from the lockfile: #181, #240, #260)', () => {
    expect(workspaces.filter((w) => w.includes('*') && !/^[^*]+\/\*$/.test(w))).toEqual([]);
  });

  it('list exactly the domain servers and the template, plus packages/*', () => {
    const servers = readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway').sort();
    expect([...workspaces].sort()).toEqual(['bconnect-server-template', 'packages/*', ...servers].sort());
  });
});

/** The root lockfile's packages, by install path (`node_modules/express`, `packages/mcp-core/node_modules/express`, …). */
const LOCK: Record<string, { version?: string }> = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages;
/** Every version of `name` the root lockfile installs, at any depth. */
const lockedVersions = (name: string): string[] =>
  Object.entries(LOCK).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)).map(([, p]) => p.version ?? '?');

/**
 * Whether `version` satisfies `range` for the forms the manifests use: `^x.y.z`, `~x.y.z` and an
 * exact `x.y.z` (a caret below 1.0 keeps the minor fixed). Anything else is reported as unsupported.
 */
function satisfies(version: string, range: string): boolean | 'unsupported' {
  const m = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m || !v) return 'unsupported';
  const [want, have] = [m.slice(2).map(Number), v.slice(1).map(Number)];
  const atLeast = have[0] !== want[0] ? have[0] > want[0] : have[1] !== want[1] ? have[1] > want[1] : have[2] >= want[2];
  if (m[1] === '') return have.join('.') === want.join('.');
  if (m[1] === '~') return atLeast && have[0] === want[0] && have[1] === want[1];
  return atLeast && have[0] === want[0] && (want[0] > 0 || have[1] === want[1]);
}

describe('one Express major, declared as it runs (REQ-DEP-002, #69)', () => {
  it('self-check: the range check', () => {
    expect(satisfies('5.2.1', '^5.2.1')).toBe(true);
    expect(satisfies('5.3.0', '^5.2.1')).toBe(true);
    expect(satisfies('4.22.3', '^5.2.1')).toBe(false);
    expect(satisfies('5.2.0', '^5.2.1')).toBe(false);
    expect(satisfies('0.3.9', '^0.3.1')).toBe(true);
    expect(satisfies('0.4.0', '^0.3.1')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.3', '>=1')).toBe('unsupported');
  });

  it.each(['express', '@types/express'])('the root lockfile installs one %s, major 5', (name) => {
    const versions = lockedVersions(name);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatch(/^5\./);
  });

  it.each(['packages/mcp-core', 'bconnect-mcp-gateway'])('%s declares express ^5 and @types/express ^5', (dir) => {
    const manifest = read(dir);
    expect(manifest.dependencies?.express).toMatch(/^\^5\./);
    expect(manifest.devDependencies?.['@types/express']).toMatch(/^\^5\./);
  });

  it('the gateway has no lockfile of its own: it runs on the root install', () => {
    expect(existsSync(join(ROOT, 'bconnect-mcp-gateway', 'package-lock.json'))).toBe(false);
  });

  it('every version the gateway declares is the one the root lockfile installs', () => {
    const manifest = read('bconnect-mcp-gateway');
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    const wrong = Object.entries(declared).filter(([, range]) => !range.startsWith('file:')).flatMap(([name, range]) => {
      const installed = LOCK[`node_modules/${name}`]?.version;
      if (installed === undefined) return [`${name}: not in the root lockfile`];
      const ok = satisfies(installed, range);
      return ok === true ? [] : [`${name}: declares ${range}, root installs ${installed}${ok === 'unsupported' ? ' (range form not checked)' : ''}`];
    });
    expect(wrong).toEqual([]);
  });

  it('Dependabot watches only the root lockfile and no longer ignores the Express majors', () => {
    const config = readFileSync(join(ROOT, '.github', 'dependabot.yml'), 'utf8');
    expect(config).not.toMatch(/^\s*-\s*"\/bconnect-mcp-gateway"\s*$/m);
    expect(config).not.toMatch(/dependency-name:\s*"(@types\/)?express"/);
  });
});
