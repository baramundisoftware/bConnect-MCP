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
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
