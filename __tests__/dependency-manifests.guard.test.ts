/**
 * Dependency manifest guard (REQ-DEP-001).
 *
 * - dotenv stays on major 16 in every manifest: from 17 on it logs to stdout by
 *   default, which corrupts the JSON-RPC stream of a stdio MCP server.
 * - Build-time tools are devDependencies, so they aren't shipped (or audited) as
 *   runtime code.
 * - Every package the root tests import is declared at the root, not reached
 *   through another package's dependencies.
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
