/**
 * One spec validator (REQ-QA-005 AC 1): only __tests__/lib/spec-validator.ts
 * loads ajv. A second ajv setup is how spec quirks get handled twice, and
 * differently (nullable, formats, allOf), so every other test file uses the
 * shared module.
 *
 * The walk reads the files on disk, not `git ls-files`, so a new untracked file
 * counts too.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const ALLOWED = new Set(['lib/spec-validator.ts', 'one-ajv.guard.test.ts']);
const SOURCE = /\.(?:[cm]?ts|[cm]?js)$/;

/** Module specifiers of ajv or ajv-formats in import, export-from, require() or import(). */
export function ajvSpecifiers(text: string): string[] {
  const found: string[] = [];
  const re = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])(ajv(?:-formats)?(?:\/[^'"`]*)?)\1/g;
  for (const m of text.replace(/\r\n?/g, '\n').matchAll(re)) found.push(m[2]);
  return found;
}

/** Every source file below `dir` (relative, with "/"), skipping node_modules; fails when there is none. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE.test(entry.name)) out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  if (out.length === 0) throw new Error(`no test sources found below ${dir}`);
  return out;
}

describe('one ajv setup', () => {
  it('no test file except the shared spec validator loads ajv', () => {
    const offenders = sourceFiles(TESTS)
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) => ajvSpecifiers(readFileSync(join(TESTS, f), 'utf8')).map((s) => `${f}: ${s}`));
    expect(offenders).toEqual([]);
  });

  it('the shared spec validator exists, so the allow-list names a real file', () => {
    expect(sourceFiles(TESTS)).toContain('lib/spec-validator.ts');
  });

  describe('self-test', () => {
    it('finds every import form, also with CRLF line endings', () => {
      const text = [
        "import { Ajv } from 'ajv';",
        'import addFormats from "ajv-formats";',
        "const { Ajv2019 } = require('ajv/dist/2019');",
        "const lazy = await import('ajv');",
        "import 'ajv-formats';",
        "export { Ajv } from 'ajv';",
        'const x = require ( `ajv` );',
      ].join('\r\n');
      expect(ajvSpecifiers(text)).toEqual(['ajv', 'ajv-formats', 'ajv/dist/2019', 'ajv', 'ajv-formats', 'ajv', 'ajv']);
    });

    it('ignores other modules and prose that only mentions ajv', () => {
      // require()/import() forms, so the dependency-manifest guard doesn't read them as real imports.
      expect(ajvSpecifiers("require('ajvx');\nawait import('my-ajv');\n// ajv is loaded elsewhere\nconst s = 'ajv';")).toEqual([]);
    });

    it('fails, rather than passing, when the walk finds no source file', () => {
      const empty = mkdtempSync(join(tmpdir(), 'one-ajv-'));
      try {
        writeFileSync(join(empty, 'notes.md'), "import { Ajv } from 'ajv';");
        expect(() => sourceFiles(empty)).toThrow(/no test sources/);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });
});
