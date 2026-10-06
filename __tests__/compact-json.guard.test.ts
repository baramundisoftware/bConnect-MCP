/**
 * No server formats a tool result itself (REQ-SRV-025 AC 3, #164).
 *
 * Tool results are formatted by the core (`toolJson` / `toolJsonResult`), so
 * the format is chosen in one place. In each server's `src/` (and the
 * template's) the guard fails on:
 * - `JSON.stringify` with an indent argument, and
 * - a `text:` property set directly from `JSON.stringify(…)`.
 * It walks the TypeScript syntax tree, so strings and comments don't count;
 * a plain substring check on `, null, 2)` also covers comments, so the
 * template's commented examples can't teach the old pattern. No regular
 * expression runs on source text.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { ROOT, SERVERS } from './lib/exerciser.js';

const DIRS = [...SERVERS, 'bconnect-server-template'].map((d) => join(ROOT, d, 'src'));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === '__mocks__' || e.name === 'generated' ? [] : sourceFiles(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.test.ts') ? [path] : [];
  });

const isJsonStringify = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'JSON' &&
  node.expression.name.text === 'stringify';

/** True for an absent or `undefined` indent argument. */
const noIndent = (arg: ts.Expression | undefined): boolean =>
  arg === undefined || (ts.isIdentifier(arg) && arg.text === 'undefined');

/** Each place in `source` that formats a result itself, as "line: text". */
export function selfFormatted(source: string, file = 'source.ts'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const report = (node: ts.Node, why: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    found.push(`${line}: ${why}: ${node.getText(sf).slice(0, 80)}`);
  };
  const visit = (node: ts.Node): void => {
    if (isJsonStringify(node) && !noIndent(node.arguments[2])) report(node, 'indented JSON');
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'text') {
      let value: ts.Expression = node.initializer;
      while (ts.isParenthesizedExpression(value)) value = value.expression;
      if (isJsonStringify(value)) report(node, 'text set from JSON.stringify');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // Comments too (the template's examples), without a regular expression.
  source.split('\n').forEach((line, i) => {
    if (line.includes(', null, 2)') && !found.some((f) => f.startsWith(`${i + 1}: `))) {
      found.push(`${i + 1}: indented JSON (text): ${line.trim().slice(0, 80)}`);
    }
  });
  return found;
}

describe('the guard itself', () => {
  it.each([
    ['indent 2', 'const t = JSON.stringify(result, null, 2);'],
    ['tab indent', 'const t = JSON.stringify(result, undefined, "\\t");'],
    ['indent variable', 'const indent = 4; const t = JSON.stringify(result, null, indent);'],
    ['indent in a template literal', 'const t = `Updated:\\n${JSON.stringify(result, null, 2)}`;'],
    ['text from JSON.stringify', 'return { content: [{ type: "text", text: JSON.stringify(result) }] };'],
    ['text from JSON.stringify in parentheses', 'return { content: [{ type: "text", text: (JSON.stringify(result)) }] };'],
    ['commented example', '// return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };'],
  ])('finds %s', (_name, source) => {
    expect(selfFormatted(source)).toHaveLength(1);
  });

  it.each([
    ['compact JSON in prose', 'const t = `result unknown (bMS answered ${JSON.stringify(result)}).`;'],
    ['the core helper', 'return toolJsonResult(result, { lead: "Updated:" });'],
    ['no indent', 'const key = JSON.stringify(values, undefined, undefined);'],
    ['a string that looks like it', 'const s = "JSON.stringify(x, null, 4)";'],
  ])('passes %s', (_name, source) => {
    expect(selfFormatted(source)).toEqual([]);
  });
});

describe('servers', () => {
  it('scans every server and the template', () => {
    expect(DIRS).toHaveLength(14);
    expect(DIRS.flatMap(sourceFiles).length).toBeGreaterThanOrEqual(14);
  });

  it.each(DIRS.map((d) => [relative(ROOT, d), d]))('%s formats no tool result itself', (_name, dir) => {
    const found = sourceFiles(dir).flatMap((file) =>
      selfFormatted(readFileSync(file, 'utf8'), file).map((f) => `${relative(ROOT, file)}:${f}`));
    expect(found).toEqual([]);
  });
});
