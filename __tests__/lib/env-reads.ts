/**
 * Finds, in TypeScript source, which environment variables the code reads and
 * which functions call which. Parsed with the TypeScript compiler, so names in
 * comments, strings and log messages don't count.
 *
 * Used by the client-config guard (REQ-SRV-019) and the README environment guard.
 */
import ts from 'typescript';

export interface EnvRead {
  /** Variable name, or `null` when the code reads the environment in a way that hides the name. */
  name: string | null;
  line: number;
  /** The source text of the read, for messages. */
  text: string;
}

const isProcessEnv = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'env' &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'process';

/** An object the code reads variables from: `process.env`, or anything called `env`. */
const isEnvObject = (node: ts.Node): boolean =>
  isProcessEnv(node) || (ts.isIdentifier(node) && node.text === 'env');

const parse = (source: string, fileName: string) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Functions that may be handed `process.env` whole; their own reads are scanned where they live. */
export const ENV_TAKERS = ['clientConfigFromEnv'];

/**
 * Every environment read in `source`: `process.env.X`, `process.env['X']`,
 * `env.X`, `env['X']`, `const { X } = process.env`. Reads whose name can't be
 * known (a computed key, `process.env` copied into a variable or passed to a
 * function other than `takers`, destructured with a rest element) are
 * returned with `name: null`.
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
    if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) {
      add(node, node.name.text);
    } else if (ts.isElementAccessExpression(node) && isEnvObject(node.expression)) {
      const key = node.argumentExpression;
      add(node, ts.isStringLiteralLike(key) ? key.text : null);
    } else if (isProcessEnv(node)) {
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

/** `function f(env = process.env)`: the reads happen through `env`, which is scanned. */
const isDeclaredParameterDefault = (node: ts.Node): boolean =>
  ts.isParameter(node.parent) && node.parent.initializer === node;

/** `f(...)` or `x.f(...)` → `f`. */
function calleeName(call: ts.CallExpression): string | undefined {
  const target = call.expression;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return undefined;
}

/** The function named `name`, declared at the top level of the file (exported or not). */
function topLevelFunction(file: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  return file.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name,
  );
}

/**
 * Whether the top-level function `fn` calls `callee` anywhere in its body
 * (including nested closures). `undefined` when there is no such function.
 */
export function functionCalls(source: string, fn: string, callee: string, fileName = 'source.ts'): boolean | undefined {
  const file = parse(source, fileName);
  const decl = topLevelFunction(file, fn);
  if (!decl?.body) return undefined;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      if (calleeName(node) === callee) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(decl.body);
  return found;
}
