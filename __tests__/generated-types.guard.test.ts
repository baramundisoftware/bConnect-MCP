/**
 * The generated OpenAPI type files match the specifications (#335).
 *
 * The files in each server's src/generated were stale or mixed (jobs matched
 * 25R2, endpoints, servermanagement and defensecontrol neither release,
 * assets was hand-written), and endpoints and jobs carried nine copies of
 * other modules that nothing imported. scripts/generate-api-types.mjs now
 * writes every file from openapi-specs/<release>/; this guard fails when a
 * file differs from what it generates, when src/generated holds a file the
 * script doesn't write, and when nothing imports a generated file.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ROOT } from './lib/exerciser.js';
import { TYPE_FILES, generate } from '../scripts/generate-api-types.mjs';

const normalize = (text: string) => text.replace(/\r\n/g, '\n');
const SERVER_DIRS = readdirSync(ROOT).filter((d) => /^bconnect-.+-(mcp|template)$/.test(d));

/** Every .ts file under a directory, recursively. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

describe('generated API types', () => {
  it.each(TYPE_FILES.map((entry) => [entry.file, entry] as const))('%s is what the generator produces', async (file, entry) => {
    const expected = await generate(entry);
    const actual = normalize(readFileSync(join(ROOT, file), 'utf8'));
    // On a mismatch, run `node scripts/generate-api-types.mjs` and commit the result.
    expect(actual === normalize(expected), `${file} is stale: run node scripts/generate-api-types.mjs`).toBe(true);
  });

  it('src/generated holds only the files the generator writes', () => {
    const listed = new Set(TYPE_FILES.map((entry) => entry.file));
    const present = SERVER_DIRS.flatMap((dir) => {
      const generated = join(ROOT, dir, 'src', 'generated');
      return existsSync(generated) ? readdirSync(generated).map((f) => `${dir}/src/generated/${f}`) : [];
    });
    expect(present.filter((file) => !listed.has(file))).toEqual([]);
    expect(present.length).toBe(listed.size);
  });

  it.each(TYPE_FILES.map((entry) => entry.file))('%s is imported by its server', (file) => {
    const server = file.split('/')[0];
    const name = basename(file, '.ts');
    const importers = tsFiles(join(ROOT, server, 'src'))
      .filter((f) => dirname(f) !== join(ROOT, server, 'src', 'generated'))
      .filter((f) => readFileSync(f, 'utf8').includes(`generated/${name}.js`));
    expect(importers.length, `${file}: nothing imports it`).toBeGreaterThan(0);
  });
});

describe('no production code path only for tests (#335)', () => {
  it.each(SERVER_DIRS)("%s doesn't reach into the SDK server's internals", (dir) => {
    const offenders = tsFiles(join(ROOT, dir, 'src'))
      .filter((f) => !/[\\/]__tests__[\\/]/.test(f))
      .filter((f) => /_requestHandlers/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
