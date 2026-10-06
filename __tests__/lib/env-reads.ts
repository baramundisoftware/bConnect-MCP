/**
 * Finds, in TypeScript source, which environment variables the code reads.
 * Parsed with the TypeScript compiler, so names in comments, strings and log
 * messages don't count.
 *
 * Used by the client-config guard (REQ-SRV-019), the README, docs and gateway
 * environment guards.
 */
import ts from 'typescript';

export interface EnvRead {
  /** Variable name, or `null` when the code reads the environment in a way that hides the name. */
  name: string | null;
  line: number;
  /** The source text of the read, for messages. */
  text: string;
}

const GLOBALS = ['globalThis', 'global'];
const PROCESS_MODULES = ['process', 'node:process'];

/** A string key or property name: `.x`, `['x']`. */
const keyOf = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
};

const isAccess = (node: ts.Node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);

/** `process`, `globalThis.process`, `global['process']`. */
const isProcess = (node: ts.Node): boolean =>
  (ts.isIdentifier(node) && node.text === 'process') ||
  (isAccess(node) && keyOf(node) === 'process' && isGlobalObject(unwrap(node.expression)));

const isGlobalObject = (node: ts.Node): boolean => ts.isIdentifier(node) && GLOBALS.includes(node.text);

/** `process.env`, `process['env']`, `globalThis.process.env`. */
// Look through `as`, `!` and parentheses: `(process as X).env` is still process.env.
const isProcessEnv = (node: ts.Node): boolean => isAccess(node) && keyOf(node) === 'env' && isProcess(unwrap(node.expression));

/** An object the code reads variables from: `process.env`, or anything called `env`. */
const isEnvObject = (node: ts.Node): boolean =>
  isProcessEnv(node) || (ts.isIdentifier(node) && node.text === 'env');

const parse = (source: string, fileName: string) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Functions that may be handed `process.env` whole; their own reads are scanned where they live. */
export const ENV_TAKERS = ['clientConfigFromEnv'];

/**
 * Every environment read in `source`: `process.env.X`, `process.env['X']`,
 * `process['env'].X`, `globalThis.process.env.X`, `env.X`, `env['X']`,
 * `const { X } = process.env`. Reads whose name can't be known (a computed
 * key, `process.env` or `process` copied into a variable, destructured or
 * passed to a function other than `takers`, a rest element) are returned with
 * `name: null`.
 */
export function envReads(source: string, fileName = 'source.ts', takers: string[] = ENV_TAKERS): EnvRead[] {
  const file = parse(source, fileName);
  const reads: EnvRead[] = [];
  const add = (node: ts.Node, name: string | null) =>
    reads.push({
      name,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      text: node.getText(file),
    });

  const visit = (node: ts.Node): void => {
    // `import … from "node:process"` / `require("process")`: process under another name.
    const moduleName =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
              node.expression.kind === ts.SyntaxKind.ImportKeyword)
          ? node.arguments[0]
          : undefined;
    if (moduleName && ts.isStringLiteralLike(moduleName) && PROCESS_MODULES.includes(moduleName.text)) {
      add(node, null);
    }
    // `const g = globalThis; g.process.env.X`: the global object copied or passed on.
    if (
      ts.isIdentifier(node) &&
      GLOBALS.includes(node.text) &&
      !isMemberBase(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
      !isBenignName(node)
    ) {
      add(node, null);
    }
    if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) {
      add(node, node.name.text);
    } else if (ts.isElementAccessExpression(node) && isEnvObject(node.expression)) {
      const key = node.argumentExpression;
      add(node, ts.isStringLiteralLike(key) ? key.text : null);
    } else if (
      isProcess(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !isBenignName(node)
    ) {
      // `process` itself is fine when a member other than env is used (`process.exit`); copied,
      // destructured (`const { env } = process`) or passed on, the reads behind it can't be seen.
      const parent = node.parent;
      const member = isMemberBase(node);
      const inner = ts.isIdentifier(node) && isAccess(parent) && isProcess(parent);
      if (!member && !inner) add(node, null);
    }
    if (isProcessEnv(node)) {
      const parent = node.parent;
      const read = ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent);
      const passed =
        ts.isCallExpression(parent) &&
        parent.arguments.some((a) => a === node) &&
        takers.includes(calleeName(parent) ?? '');
      const destructured =
        ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name);
      if (destructured) {
        for (const element of (parent.name as ts.ObjectBindingPattern).elements) {
          const key = element.propertyName ?? element.name;
          const name = !element.dotDotDotToken && (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) ? key.text : null;
          add(element, name);
        }
      } else if (!read && !passed && !isDeclaredParameterDefault(node)) {
        // Copied, spread or assigned: what is read from it later can't be seen here.
        add(node, null);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return reads;
}

/** `x.y`, `(x as T).y`, `x!.y`: the node is the object a member is read from. */
const isMemberBase = (node: ts.Node): boolean => {
  const base = outermost(node);
  return isAccess(base.parent) && base.parent.expression === base;
};

/**
 * A name that isn't the global object or `process` itself: a property name
 * (`{ process: x }`, `interface J { process: string }`), a type position
 * (`typeof globalThis` as a type), `declare global`, or a `typeof x` test.
 */
function isBenignName(node: ts.Node): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  if (ts.isModuleDeclaration(parent) || ts.isTypeOfExpression(parent)) return true;
  for (let n: ts.Node | undefined = parent; n && !ts.isSourceFile(n); n = n.parent) {
    // `class A extends mixin(process)`: the extends expression runs; it isn't a type.
    if (ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent) &&
      n.parent.token === ts.SyntaxKind.ExtendsKeyword && !ts.isInterfaceDeclaration(n.parent.parent)) return false;
    if (ts.isTypeNode(n)) return true;
  }
  return false;
}

/** `function f(env = process.env)`: the reads happen through `env`, which is scanned. */
const isDeclaredParameterDefault = (node: ts.Node): boolean =>
  ts.isParameter(node.parent) &&
  node.parent.initializer === node &&
  ts.isIdentifier(node.parent.name) &&
  node.parent.name.text === 'env';

/** `f(...)` or `x.f(...)` → `f`. */
function calleeName(call: ts.CallExpression): string | undefined {
  const target = call.expression;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return undefined;
}

/** `(x)`, `x as T`, `x satisfies T`, `x!` → `x`. */
const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;

/** Parentheses, `as`, `satisfies`, `!`: wrappers that leave the value as it is. */
const isWrapper = (node: ts.Node): boolean =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node);

/** Climb from `node` through parentheses and type assertions. */
const outermost = (node: ts.Node): ts.Node => (isWrapper(node.parent) ? outermost(node.parent) : node);
