/**
 * Every string this server can emit, read as a customer would read it.
 *
 * Tool results and tool descriptions are prose a model relays verbatim to an
 * operator who has never seen this repository. Two classes of sentence are
 * therefore not shippable, and both had escaped review because they read
 * perfectly well to someone who DOES know the project:
 *
 *   1. Internal evaluation IDs (D5, D11, D15, PER-16, TOK-27, …). To a customer
 *      these are a citation to a document they will never be given, arriving in
 *      the middle of an answer about their own production estate. They belong in
 *      comments — where they are genuinely useful — and nowhere else.
 *
 *   2. Claims measured on ONE bMS and phrased as facts about the reader's.
 *      "A false value is never serialised on this estate" was measured here;
 *      the operator reads "this estate" as theirs, and if their build behaves
 *      differently the diagnosis built on it is confidently wrong.
 *
 * Also caught: pointers to documents that are not part of the product. A note
 * that ends "see X.md" is only helpful if X.md is something the reader has.
 *
 * The scan walks the real TypeScript AST rather than grepping lines, so a
 * comment containing a finding ID passes and the same text inside a literal
 * fails — which is exactly the distinction being enforced. Template literals
 * are covered piece by piece, so an ID interpolated into a longer sentence is
 * still seen.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = join(fileURLToPath(new URL('../', import.meta.url)));

/** Generated API types are vendor output, and tests are allowed to name the
 *  findings they cover — neither ships as runtime prose. */
const SKIP_DIRS = new Set(['__tests__', 'generated', 'build', 'node_modules']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {out.push(...sourceFiles(full));}
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Literal {
  file: string;
  line: number;
  text: string;
}

/** Every string-literal and template-literal fragment in one file. */
function literals(file: string): Literal[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true
  );
  const found: Literal[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({
        file: relative(SRC, file).split(sep).join('/'),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: node.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const ALL: Literal[] = sourceFiles(SRC).flatMap(literals);

const report = (hits: Literal[]): string =>
  hits.map((h) => `${h.file}:${h.line}  ${JSON.stringify(h.text.slice(0, 160))}`).join('\n');

describe('runtime text hygiene', () => {
  it('scans a non-trivial number of literals — a scan that finds nothing proves nothing', () => {
    expect(ALL.length).toBeGreaterThan(200);
  });

  /**
   * Deliberately anchored on the ID shapes this project actually uses. A looser
   * pattern would flag `D` + digit inside version strings and CVE text; a
   * tighter one would miss the bare `(D9)` form that shipped.
   */
  it('emits no internal finding ID', () => {
    const pattern =
      /(?:\b(?:upstream|finding|findings|per|see)\s+)?\b(?:[DBMX]\d{1,2}|PER-\d+|TOK-\d+|OPT-\d+|INT-\d+)\b/;
    const hits = ALL.filter((l) => pattern.test(l.text));
    expect(hits, `internal finding IDs in emitted strings:\n${report(hits)}`).toEqual([]);
  });

  it('asserts nothing about "this estate"', () => {
    const pattern = /\b(?:this|our|the reference|the demo)\s+estate\b/i;
    const hits = ALL.filter((l) => pattern.test(l.text));
    expect(hits, `estate-specific claims in emitted strings:\n${report(hits)}`).toEqual([]);
  });

  it('points at no document that is not part of the product', () => {
    // A `.md` filename in a tool result is a promise the reader can open it.
    const hits = ALL.filter((l) => /\b[\w-]+\.md\b/i.test(l.text));
    expect(hits, `references to non-shipping documents:\n${report(hits)}`).toEqual([]);
  });
});
