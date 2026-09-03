/**
 * Maps a registered MCP tool to the API operation it actually calls.
 *
 * The mapping is derived from source, never guessed from the tool's name:
 *
 *   1. `src/index.ts`   tool name  -> module method   (the executing switch)
 *   2. `src/modules/*.ts` method   -> HTTP verb + URL template
 *   3. `src/generated/*-types.ts`  URL template -> path entry -> operationId
 *
 * Reading `src/` rather than `build/` is deliberate: the assertion must hold on
 * a clean checkout, and a stale `build/` is exactly the kind of thing that lets
 * a check pass while the source it claims to cover has changed underneath it.
 *
 * A method that makes no HTTP call of its own — `searchEndpoints` delegates to
 * `getEndpoints` — is left unmapped rather than being attributed a route.
 * Method-scoped extraction is what makes that possible; the earlier audit
 * script used a fixed-width lookahead and silently ran past the end of a
 * delegating method into the next one's URL.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GeneratedTypes } from './generated-openapi.js';

export interface ModuleRoute {
  method: string;
  httpVerb: string;
  /** e.g. `/compliance/v2.0/DetectedRuleViolations/{}` — path params collapsed. */
  urlTemplate: string;
  /** Module segment of the URL: `compliance`, `endpoints`, … */
  moduleSegment?: string;
  /** `/v2.0/...` — the template as the generated `paths` keys spell it. */
  specPath?: string;
  /** operationId(s) the method's own type aliases name, if any. */
  declaredOperationIds: string[];
}

/** Method name -> the route that method calls. */
export function readModuleRoutes(repoRoot: string, serverDir: string): Map<string, ModuleRoute> {
  const dir = resolve(repoRoot, serverDir, 'src', 'modules');
  const routes = new Map<string, ModuleRoute>();
  if (!existsSync(dir)) {return routes;}

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(resolve(dir, file), 'utf8');
    const basePath = src.match(/basePath[^=\n]*=\s*['"]([^'"]+)['"]/)?.[1] ?? '';

    // Class methods are emitted at two-space indent. Slice each method's body
    // at the next declaration so a URL can never be attributed across methods.
    const decl = /^ {2}(?:public |private |protected )?(?:async )?([A-Za-z0-9_$]+)\s*\(/gm;
    const starts: { name: string; at: number; bodyAt: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = decl.exec(src))) {starts.push({ name: m[1], at: m.index, bodyAt: decl.lastIndex });}

    for (let i = 0; i < starts.length; i++) {
      const body = src.slice(starts[i].bodyAt, starts[i + 1]?.at ?? src.length);
      const call = body.match(
        /this\.(?:httpClient|client|axios)\s*\.\s*(get|post|patch|put|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*`([^`]+)`/
      );
      if (!call) {continue;} // delegating, or no HTTP call — correctly unmapped

      const urlTemplate = call[2]
        .replace('${this.basePath}', basePath)
        .replace(/\$\{[^}]+\}/g, '{}');

      const moduleSegment = urlTemplate.match(/^\/([a-z]+)\/v2\.0/)?.[1];
      const specPath = moduleSegment ? urlTemplate.replace(/^\/[a-z]+\/v2\.0/, '/v2.0') : undefined;

      // Type aliases inside the method's own signature, e.g.
      //   params: GetAllMobileDeviceRulesParams
      // resolve back to `operations['GetAllMobileDeviceRules']` at the top of
      // the file. Collect those so a route mismatch can be told apart from a
      // route the types simply do not have.
      // Signature only — stop at the first `{`, which is either the body or a
      // `= {}` default. Reading further would pull in the *next* method's
      // aliases and invent a mismatch that is not there.
      const seg = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
      const brace = seg.indexOf('{');
      const sig = brace >= 0 ? seg.slice(0, brace) : seg;
      const declaredOperationIds: string[] = [];
      for (const alias of sig.matchAll(/\b([A-Z][A-Za-z0-9_$]*)\b/g)) {
        const def = src.match(new RegExp(`^type\\s+${alias[1]}\\s*=\\s*([^;]+);`, 'm'));
        const id = def?.[1]?.match(/operations\[['"]([^'"]+)['"]\]/)?.[1];
        if (id && !declaredOperationIds.includes(id)) {declaredOperationIds.push(id);}
      }

      routes.set(starts[i].name, {
        method: starts[i].name,
        httpVerb: call[1],
        urlTemplate,
        moduleSegment,
        specPath,
        declaredOperationIds,
      });
    }
  }
  return routes;
}

export interface Dispatch {
  /** Module method the case awaits, e.g. `getAllVulnerabilities`. */
  method?: string;
  /**
   * A free function the case awaits instead of a module method — how the
   * locally-added composite tools (`get_fleet_summary`, `preview_assignment`, …)
   * are wired. These have no single API operation behind them by design.
   */
  localFunction?: string;
  /**
   * The case block's raw source, bounded by the next label — what the arm
   * actually executes. Added for the dispatch-reads-declared-parameters rule
   * (Rule I): `link_entra_id_data` read `args!.deviceId`, a parameter its
   * schema never declared, so the value was undefined on every call and the
   * advertised parameters were read by nothing. Only source can see that.
   */
  blockSource?: string;
}

/**
 * Tool name -> what its dispatch case actually calls, read from `src/index.ts`.
 *
 * Case blocks are delimited by the *next* `case` label rather than by a
 * character budget. That matters more than it looks: with a fixed lookahead,
 * a case whose call does not match (a composite calling a free function) lets
 * the scan run on into the following case and steal its call — which both
 * mis-maps the composite and makes the next tool vanish from the map
 * entirely. Two compliance tools were silently lost that way before this was
 * delimited properly.
 *
 * The write-gate switch earlier in the same file lists the same tool names with
 * no block body, so requiring `{` after the label keeps the two apart.
 */
export function readToolDispatch(repoRoot: string, serverDir: string): Map<string, Dispatch> {
  const src = readFileSync(resolve(repoRoot, serverDir, 'src', 'index.ts'), 'utf8');
  const labels: { name: string | null; at: number; hasBlock: boolean }[] = [];
  // `default:` is collected too, so the final case in a switch is bounded by
  // it rather than running to the end of the file.
  const labelRe = /(?:case\s+["']([a-z_0-9]+)["']|(default))\s*:\s*(\{?)/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(src))) {labels.push({ name: m[1] ?? null, at: labelRe.lastIndex, hasBlock: m[3] === '{' });}

  const out = new Map<string, Dispatch>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!label.name || !label.hasBlock || out.has(label.name)) {continue;}
    const body = src.slice(label.at, labels[i + 1]?.at ?? src.length);
    // Module calls are reached through one or more property hops
    // (`compliance.getX(`, `bconnect.endpoints.getX(`); the last segment is
    // the method. A bare `await getX(` is a local function instead.
    const viaModule = body.match(/await\s+[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*\.([A-Za-z0-9_$]+)\s*\(/);
    // `fetchCount` (mcp-core, TOK-25) wraps the real module call in a callback:
    //   await fetchCount((p) => vars.getVariableInstances(p as never), args)
    // The inner call carries no `await`, so resolving the first awaited local
    // here would pin every countOnly-enabled tool to `fetchCount` and lose its
    // route — which silently blinded this guard on ~81 read tools. Skip the
    // known wrappers so resolution falls through to the real call.
    const viaLocal = matchLocalCall(body);
    if (viaModule && (!viaLocal || viaModule.index! <= viaLocal.index!)) {
      out.set(label.name, { method: viaModule[1], blockSource: body });
    } else if (viaLocal) {
      out.set(label.name, { localFunction: viaLocal[1], blockSource: body });
    } else {
      // Only a wrapped call was found: resolve the module method inside it.
      const inCallback = body.match(
        /await\s+(?:fetchCount|countOnlyResult)\s*\(\s*\([^)]*\)\s*=>\s*[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*\.([A-Za-z0-9_$]+)\s*\(/
      );
      if (inCallback) {
        out.set(label.name, { method: inCallback[1], blockSource: body });
      } else {
        // No resolvable call at all — still record the block, so Rule I can
        // judge what the arm reads even when the route stays unmapped.
        out.set(label.name, { blockSource: body });
      }
    }
  }
  return out;
}

/**
 * Local helpers that wrap a module call rather than being the route themselves.
 * Resolving a tool to one of these hides the route it actually reaches.
 * `countOnlyResult` is the TOK-3 successor of `fetchCount` in the endpoints
 * server: same shape (the real module call sits in its callback, un-awaited),
 * same failure mode when unlisted — `list_logical_groups`, a plain
 * single-route tool, resolved to `countOnlyResult` and fell out of the mapped
 * set until this was added.
 */
const CALL_WRAPPERS = new Set(['fetchCount', 'countOnlyResult']);

/**
 * First awaited local call that is not a known wrapper and not a route-table
 * pick. The collapsed families (TOK-3) choose their module function at call
 * time — `const route = LIST_ROUTE[type]!; … await route(…)` — so `route` is
 * not a single method and resolving to it would be attributing one arm of a
 * dispatch matrix to the whole tool. Left unresolved instead, which is the
 * same classification the groups-mcp dispatchers already get.
 */
function matchLocalCall(body: string): RegExpExecArray | null {
  const re = /await\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (CALL_WRAPPERS.has(m[1])) {continue;}
    if (new RegExp(`(?:const|let|var)\\s+${m[1]}\\s*=\\s*[A-Za-z0-9_$]+\\[`).test(body)) {continue;}
    return m;
  }
  return null;
}

/** Match a URL template against the generated `paths` keys, ignoring param names. */
export function findPathEntry(
  types: GeneratedTypes,
  specPath: string
): { key: string; methods: Record<string, string> } | undefined {
  const wild = (p: string) => p.replace(/\{[^}]*\}/g, '{}');
  const want = wild(specPath);
  for (const [key, methods] of types.paths) {if (wild(key) === want) {return { key, methods };}}
  return undefined;
}
