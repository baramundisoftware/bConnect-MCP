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

const GLOBALS = ['globalThis', 'global'];

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
  (isAccess(node) && keyOf(node) === 'process' && ts.isIdentifier(node.expression) && GLOBALS.includes(node.expression.text));

/** `process.env`, `process['env']`, `globalThis.process.env`. */
const isProcessEnv = (node: ts.Node): boolean => isAccess(node) && keyOf(node) === 'env' && isProcess(node.expression);

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
    if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) {
      add(node, node.name.text);
    } else if (ts.isElementAccessExpression(node) && isEnvObject(node.expression)) {
      const key = node.argumentExpression;
      add(node, ts.isStringLiteralLike(key) ? key.text : null);
    } else if (isProcess(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      // `process` itself is fine when a member other than env is used (`process.exit`); copied,
      // destructured (`const { env } = process`) or passed on, the reads behind it can't be seen.
      const parent = node.parent;
      const member = isAccess(parent) && parent.expression === node;
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

export interface ClientConstruction {
  line: number;
  text: string;
  /** Built from `helper(...)` directly, or from a variable that is only ever assigned `helper(...)`. */
  fromHelper: boolean;
}

const isHelperCall = (node: ts.Node | undefined, helper: string): boolean =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === helper;

/**
 * Every `new <ctor>(...)` in `source`, and whether its config comes from `helper(...)`
 * unchanged. An object literal, a spread or a variable assigned anything else doesn't.
 */
export function clientConstructions(source: string, ctor: string, helper: string, fileName = 'source.ts'): ClientConstruction[] {
  const file = parse(source, fileName);
  // Every value assigned to each variable name in the file.
  const assigned = new Map<string, Array<ts.Expression | undefined>>();
  const remember = (name: string, value: ts.Expression | undefined) =>
    assigned.set(name, [...(assigned.get(name) ?? []), value]);
  const found: Array<{ node: ts.NewExpression; arg: ts.Expression | undefined }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) remember(node.name.text, node.initializer);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      remember(node.left.text, node.right);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ctor) {
      found.push({ node, arg: node.arguments?.[0] });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found.map(({ node, arg }) => {
    let fromHelper = isHelperCall(arg, helper);
    if (!fromHelper && arg !== undefined && ts.isIdentifier(arg)) {
      // A declaration without a value (`let config: T;`) is fine; every assignment must be the helper.
      const values = (assigned.get(arg.text) ?? []).filter((v): v is ts.Expression => v !== undefined);
      fromHelper = values.length > 0 && values.every((v) => isHelperCall(v, helper));
    }
    return {
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      text: node.getText(file),
      fromHelper,
    };
  });
}

/**
 * Problems with where `helper` comes from in `source`: it must be imported from
 * `module` and not declared again in the file (a local function of the same name
 * would pass every other check). Empty when the file doesn't use it.
 */
export function helperProvenance(source: string, helper: string, module: string, fileName = 'source.ts'): string[] {
  const file = parse(source, fileName);
  const problems: string[] = [];
  let imported = false;
  let used = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const from = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.name.text !== helper) continue;
          if (from === module && (element.propertyName ?? element.name).text === helper) imported = true;
          else problems.push(`imports ${helper} from ${from}`);
        }
      }
      return;
    }
    const declared =
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === helper;
    if (declared) problems.push(`declares its own ${helper} (line ${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1})`);
    if (ts.isIdentifier(node) && node.text === helper) used = true;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (used && !imported) problems.push(`uses ${helper} without importing it from ${module}`);
  return problems;
}
