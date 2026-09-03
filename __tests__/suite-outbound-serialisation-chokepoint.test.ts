/**
 * The outbound chokepoint is universal — enforced, not asserted in prose.
 *
 * ── The claim, and why it needed a guard ────────────────────────────────────
 * `packages/mcp-core/src/serialize.ts` makes a load-bearing security claim:
 *
 *     "all 276 `serializeToolResult` call sites pass through this function, so
 *      unlike a projection-time fix it CANNOT BE FORGOTTEN BY A NEW TOOL."
 *
 * That is the whole argument for putting the outbound trust boundary at the
 * serialiser instead of at each projection, and SECURITY.md repeats it as "the
 * one control here that a new tool cannot forget to apply". It was true of the
 * code and unenforced by anything.
 *
 * The only check that existed is in `suite-client-lifetime.test.ts` (D21):
 *
 *     expect(src).not.toMatch(/JSON\.stringify\(.+, null, 2\)/);
 *     expect(src).toContain('serializeToolResult(');
 *
 * Both pass for a server that adds ONE new tool returning
 * `toolTextResult(JSON.stringify(row))`: there is no pretty-print, and the file
 * still contains the helper's name at its other twenty call sites. So the
 * property everything rests on — *every* estate-bearing result is sanitised —
 * was checked by a substring that cannot see a single forgotten tool. That is
 * the exact defect class this repository keeps finding: a guard that matches a
 * spelling instead of asserting the property.
 *
 * ── What this asserts, as a property ────────────────────────────────────────
 * Every expression that becomes the `text` of a tool-result content block must
 * satisfy one of:
 *
 *   1. It routes through `serializeToolResult` — directly, or through a
 *      single-expression local helper that does. (`bconnect-software-mcp`'s
 *      `shaped()` is the reason indirection is resolved rather than banned: one
 *      line of it makes the chokepoint invisible to a grep while remaining
 *      completely correct.)
 *
 *   2. It carries no estate data at all. Enforced by dataflow, not by a
 *      wordlist: the expression must not reference any identifier bound to an
 *      `await` in the enclosing function. An API response is always reached by
 *      awaiting it, so "mentions nothing that was awaited" is what makes
 *      `Job instance ${args!.id} started successfully` provably estate-free
 *      while `JSON.stringify(result)` is not.
 *
 * Rule 2 fails CLOSED: a message that does reference an awaited value is
 * required to serialise, even if a human can see the particular field is safe.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Directories are found by looking for a `package.json`, never by globbing
 * `bconnect-*-mcp` — that glob does not match `bconnect-mcp-gateway` and has
 * caused two separate bugs in this repository.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Workspace directories, discovered by asking the filesystem for manifests. */
function workspaceDirs(): string[] {
  const out: string[] = [];
  const consider = (dir: string): void => {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src'))) {
      out.push(dir);
    }
  };
  for (const entry of fs.readdirSync(REPO_ROOT)) {
    const full = path.join(REPO_ROOT, entry);
    if (!fs.statSync(full).isDirectory() || entry === 'node_modules') {
      continue;
    }
    consider(full);
    // packages/* holds the shared core.
    if (entry === 'packages') {
      for (const sub of fs.readdirSync(full)) {
        consider(path.join(full, sub));
      }
    }
  }
  return out.sort();
}

const SKIP_DIRS = new Set(['__tests__', 'generated', 'build', 'node_modules', 'dist']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        out.push(...sourceFiles(full));
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface TextSite {
  file: string;
  line: number;
  expr: string;
  /** Serialised (directly or via a local helper). */
  serialised: boolean;
  /** Awaited identifiers this expression references — estate-data suspicion. */
  awaitedRefs: string[];
}

const SERIALISER = 'serializeToolResult';

function subtreeCalls(node: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Identifiers referenced anywhere in an expression. */
function referencedIdentifiers(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      names.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** Nearest enclosing function-like node, or the source file. */
function enclosingFunction(node: ts.Node): ts.Node {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return node.getSourceFile();
}

/** Names bound to an initialiser containing `await`, within one scope. */
function awaitBoundNames(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      let hasAwait = false;
      const look = (m: ts.Node): void => {
        if (ts.isAwaitExpression(m)) {
          hasAwait = true;
        }
        ts.forEachChild(m, look);
      };
      look(n.initializer);
      if (hasAwait) {
        // Covers `const x = await f()` and `const { a, b } = await f()`.
        for (const id of referencedIdentifiers(n.name)) {
          names.add(id);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return names;
}

/** Local helpers whose body reaches the serialiser (e.g. software-mcp's `shaped`). */
function serialisingHelpers(source: ts.SourceFile): Set<string> {
  const helpers = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) &&
        subtreeCalls(n.initializer, SERIALISER)
      ) {
        helpers.add(n.name.text);
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name && n.body && subtreeCalls(n.body, SERIALISER)) {
      helpers.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return helpers;
}

function collect(file: string): TextSite[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true
  );
  const helpers = serialisingHelpers(source);
  const sites: TextSite[] = [];

  const record = (exprNode: ts.Node, node: ts.Node): void => {
    const routed =
      subtreeCalls(exprNode, SERIALISER) ||
      [...helpers].some((h) => subtreeCalls(exprNode, h));
    const awaited = awaitBoundNames(enclosingFunction(node));
    const refs = [...referencedIdentifiers(exprNode)].filter((id) => awaited.has(id));
    sites.push({
      file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      expr: exprNode.getText(source).replace(/\s+/g, ' ').slice(0, 120),
      serialised: routed,
      awaitedRefs: refs,
    });
  };

  const visit = (node: ts.Node): void => {
    // Shape 1: { type: "text", text: EXPR }
    if (ts.isObjectLiteralExpression(node)) {
      const props = node.properties.filter(ts.isPropertyAssignment);
      const isText = props.some(
        (p) => p.name.getText(source) === 'type' && /["']text["']/.test(p.initializer.getText(source))
      );
      const textProp = props.find((p) => p.name.getText(source) === 'text');
      if (isText && textProp) {
        record(textProp.initializer, node);
      }
    }
    // Shape 2: toolTextResult(EXPR) / toolErrorResult(EXPR)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      if ((fn === 'toolTextResult' || fn === 'toolErrorResult') && node.arguments.length > 0) {
        record(node.arguments[0]!, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

const SITES: TextSite[] = workspaceDirs().flatMap((dir) =>
  sourceFiles(path.join(dir, 'src')).flatMap(collect)
);

const serialised = SITES.filter((s) => s.serialised);
const estateFree = SITES.filter((s) => !s.serialised && s.awaitedRefs.length === 0);
const offenders = SITES.filter((s) => !s.serialised && s.awaitedRefs.length > 0);

const report = (list: TextSite[]): string =>
  list
    .map((s) => `${s.file}:${s.line}\n      text: ${s.expr}\n      awaited: ${s.awaitedRefs.join(', ')}`)
    .join('\n');

describe('the scan itself is not vacuous', () => {
  it('found the suite-wide population of tool-result text sites', () => {
    // A scan that finds nothing passes every assertion below while proving
    // nothing — the failure mode this repository has been bitten by twice.
    expect(SITES.length).toBeGreaterThan(250);
  });

  it('sees both kinds of site, so neither branch is untested', () => {
    // If everything were "serialised" the dataflow half would never run; if
    // everything were "estate-free" the chokepoint half would never run.
    expect(serialised.length).toBeGreaterThan(200);
    expect(estateFree.length).toBeGreaterThan(10);
  });

  it('resolves serialisation through a local helper, not only direct calls', () => {
    // bconnect-software-mcp's `shaped()` serialises inside a one-line arrow.
    // If helper resolution regressed, those four sites would be misreported as
    // offenders and this guard would cry wolf.
    const viaHelper = serialised.filter((s) => !/serializeToolResult/.test(s.expr));
    expect(viaHelper.length).toBeGreaterThan(0);
  });
});

describe('every estate-bearing tool result passes the outbound chokepoint', () => {
  it('no tool-result text derives from an awaited value without serialising it', () => {
    expect(
      offenders,
      `These tool results put an awaited (API-derived) value into the model's context ` +
        `without routing it through ${SERIALISER}, so invisible and text-reordering ` +
        `characters from the estate would reach the model verbatim:\n${report(offenders)}`
    ).toEqual([]);
  });
});
