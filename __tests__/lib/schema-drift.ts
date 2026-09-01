/**
 * The comparison behind T2: every registered tool's `inputSchema` against what
 * the generated OpenAPI types declare for the operation that tool actually
 * calls.
 *
 * Kept separate from the test file so the assertions and their allowlists stay
 * readable — the allowlist is the part a reviewer needs to argue with.
 *
 * Findings are classified, not lumped together, because the fixes differ:
 *
 *   unverifiableRoute  the URL the module builds is in no generated `paths`
 *                      entry, so nothing about the tool can be checked
 *   verbDrift          the route exists; the module uses a verb it does not
 *                      declare  -> 405
 *   undeclaredParam    the tool exposes something the operation does not
 *                      declare -> silently dropped (D6) or rejected
 *   staleTypes         the tool is right and the *types* are behind the shipped
 *                      26R1 spec -> regenerate, do not touch the tool
 *   enumDrift          an enum-typed parameter typed as a bare string, or
 *                      carrying a value the API does not accept -> HTTP 400,
 *                      which is what makes this worse than omitting it
 *   wrapperBody        the handler forwards a nested object the schema never
 *                      describes (D12)
 *   bodyRequired       a field the request schema requires that the tool cannot
 *                      supply, or does not enforce (B3, B6)
 *   omittedQueryParam  a declared filter no tool exposes (D14b)
 */

import { readdirSync } from 'node:fs';
import {
  loadSuiteTypes,
  enumValuesOf,
  loadShippedSpec,
  type GeneratedTypes,
  type ShippedSpec,
} from './generated-openapi.js';
import { readModuleRoutes, readToolDispatch, findPathEntry } from './tool-routes.js';

export interface Finding {
  /** Stable identity used by the allowlists: `server/tool` or `server/tool.param`. */
  key: string;
  detail: string;
}

export interface DriftReport {
  toolCount: number;
  mappedCount: number;
  stubTypeFiles: string[];
  borrowedTypes: string[];
  composite: Finding[];
  unresolvedMethod: Finding[];
  unverifiableRoute: Finding[];
  /**
   * The route or verb IS in the shipped spec for the release the suite targets
   * — the vendored generated types are simply behind it. Split out from
   * `unverifiableRoute` and `verbDrift` because the fix is "regenerate", and
   * calling it a tool bug would send someone to change working code.
   */
  staleTypeRoutes: Finding[];
  verbDrift: Finding[];
  undeclaredParam: Finding[];
  staleTypes: Finding[];
  enumDrift: Finding[];
  wrapperBody: Finding[];
  bodyRequired: Finding[];
  omittedQueryParam: Finding[];
}

export interface ToolDef {
  name: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; enum?: string[] } | undefined>;
    required?: string[];
  };
}

export type ServerLoader = () => Promise<{ createServer: () => { server: unknown } }>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Response-shaping vocabulary the MCP servers consume THEMSELVES — these are
 * not API query parameters and are never meant to reach bConnect, so "the
 * operation does not declare them" is the expected state, not D6 drift:
 *
 *   countOnly     answered by `isCountOnlyRequest`/`fetchCount` (mcp-core,
 *                 TOK-25). The count probe strips it before the request is
 *                 built — `NON_FILTER_PARAMS` in packages/mcp-core/src/count-only.ts.
 *   detail        full-record escape hatch of the list shapers (TOK-21/TOK-27).
 *   fields        column projection, same shapers.
 *   includeSteps  jobs-mcp's own flag: keep steps[] in the projection.
 *
 * Verified in server source before being excluded here: endpoints-mcp projects
 * onto declared keys (`queryParams` + *_LIST_QUERY_KEYS), jobs-mcp strips them
 * (`CLIENT_SIDE_PARAMS`/`apiParams`), software-mcp strips them (`SHAPING_KEYS`/
 * `apiParams`); on the count path every server goes through `fetchCount`, which
 * strips them for all. Known residue: servers without a strip helper forward
 * `args` wholesale on the non-count path, so an explicit `countOnly: false` —
 * a no-op the caller cannot be relying on — can reach the wire and be dropped.
 * That is wire hygiene, not the D6 hazard (no answer depends on the API
 * interpreting it).
 *
 * This is a structural property of the tool surface, not a drift allowlist:
 * a name added here must be consumed by the server and stripped (or
 * meaningless) on every path to the API.
 */
const CLIENT_SHAPING_PARAMS: ReadonlySet<string> = new Set(
  ['countOnly', 'detail', 'fields', 'includeSteps'].map(norm)
);

export async function listTools(load: ServerLoader): Promise<ToolDef[]> {
  const { server } = (await load()).createServer();
  const handler = (
    server as { _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>> }
  )._requestHandlers.get('tools/list');
  return (await handler?.({ method: 'tools/list' }))?.tools ?? [];
}

export async function buildDriftReport(
  repoRoot: string,
  servers: Record<string, ServerLoader>,
  release = '26R1'
): Promise<DriftReport> {
  const dirs = Object.keys(servers).sort();
  const suite = loadSuiteTypes(
    repoRoot,
    readdirSync(repoRoot).filter((d) => /^bconnect-.*-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')
  );

  const r: DriftReport = {
    toolCount: 0,
    mappedCount: 0,
    stubTypeFiles: suite.stubs.map((s) => `${s.server}/${s.file.split(/[\\/]/).pop()}`),
    borrowedTypes: [],
    composite: [],
    unresolvedMethod: [],
    unverifiableRoute: [],
    staleTypeRoutes: [],
    verbDrift: [],
    undeclaredParam: [],
    staleTypes: [],
    enumDrift: [],
    wrapperBody: [],
    bodyRequired: [],
    omittedQueryParam: [],
  };

  const specCache = new Map<string, ShippedSpec | undefined>();
  const shippedSpec = (segment: string | undefined): ShippedSpec | undefined => {
    if (!segment) {return undefined;}
    if (!specCache.has(segment)) {specCache.set(segment, loadShippedSpec(repoRoot, release, segment));}
    return specCache.get(segment);
  };

  for (const dir of dirs) {
    const routes = readModuleRoutes(repoRoot, dir);
    const dispatch = readToolDispatch(repoRoot, dir);
    const tools = await listTools(servers[dir]);
    r.toolCount += tools.length;

    for (const tool of tools) {
      const id = `${dir}/${tool.name}`;
      const call = dispatch.get(tool.name);

      if (call?.localFunction) {
        r.composite.push({ key: id, detail: `dispatches to local ${call.localFunction}()` });
        continue;
      }
      const route = call?.method ? routes.get(call.method) : undefined;
      if (!route) {
        r.unresolvedMethod.push({ key: id, detail: `${call?.method ?? '(no dispatch case)'} makes no HTTP call of its own` });
        continue;
      }

      const segment = route.moduleSegment;
      const picked = segment ? suite.resolved.get(dir)?.get(segment) : undefined;
      if (picked && picked.fromServer !== dir) {
        const note = `${dir}: ${segment} types borrowed from ${picked.fromServer}`;
        if (!r.borrowedTypes.includes(note)) {r.borrowedTypes.push(note);}
      }
      const types: GeneratedTypes | undefined = picked?.types;
      if (!types || !route.specPath) {
        r.unverifiableRoute.push({ key: id, detail: `${route.urlTemplate} — no generated types for module '${segment}'` });
        continue;
      }

      const spec = shippedSpec(segment);
      const entry = findPathEntry(types, route.specPath);
      if (!entry) {
        const alias = route.declaredOperationIds.length ? ` (the method types itself against ${route.declaredOperationIds.join(', ')})` : '';
        const bucket = spec?.hasRoute(route.specPath) ? r.staleTypeRoutes : r.unverifiableRoute;
        const why = spec?.hasRoute(route.specPath)
          ? `the shipped ${release} spec declares ${route.specPath}; the vendored generated types do not`
          : `${route.httpVerb.toUpperCase()} ${route.specPath} is in no generated paths entry and in no shipped ${release} spec${alias}`;
        bucket.push({ key: id, detail: why });
        continue;
      }
      const opId = entry.methods[route.httpVerb];
      if (!opId) {
        const specVerbs = spec?.verbsOf(entry.key) ?? [];
        if (specVerbs.includes(route.httpVerb)) {
          r.staleTypeRoutes.push({
            key: id,
            detail: `the shipped ${release} spec declares ${route.httpVerb.toUpperCase()} ${entry.key}; the vendored generated types declare only ${Object.keys(entry.methods).join('/').toUpperCase()}`,
          });
        } else {
          r.verbDrift.push({ key: id, detail: `sends ${route.httpVerb.toUpperCase()} ${entry.key}, which declares only ${Object.keys(entry.methods).join('/').toUpperCase()}` });
        }
        continue;
      }
      const op = types.operations.get(opId)!;
      r.mappedCount++;

      const props = Object.entries(tool.inputSchema?.properties ?? {});
      const toolRequired = new Set((tool.inputSchema?.required ?? []).map(norm));
      const toolNames = new Set(props.map(([n]) => norm(n)));
      const byQuery = new Map(op.query.map((p) => [norm(p.name), p]));
      const pathNames = op.path.map((p) => norm(p.name));
      const bodySchema = op.requestBodySchema ? types.schemas.get(op.requestBodySchema) : undefined;
      const byBody = new Map((bodySchema?.properties ?? []).map((p) => [norm(p.name), p]));
      const jsonPatch = op.requestBodyMediaType === 'application/json-patch+json';
      const opaqueBody = !!op.requestBodyMediaType && !bodySchema && !jsonPatch;
      const patchable = new Set((op.patchablePaths ?? []).map(norm));

      // A tool property supplies a path parameter when it matches the declared
      // name, or — for the near-universal `{id}` — when it is any *Id property.
      // Tools rename `{id}` to `endpointId`/`ruleId` for the model's benefit,
      // which is good practice and must not read as drift.
      const isPathParam = (n: string) =>
        pathNames.some((p) => n === p || n.endsWith(p)) || (pathNames.includes('id') && /id$/.test(n));

      // D12 — a lone `…Data`/`…Payload` property standing in for a body the
      // tool never describes. Recognised on JSON-Patch routes too, where the
      // patch example is the thing it should have been flattened against.
      const wrapper = props.find(
        ([n]) => /(data|payload|body)$/i.test(n) && !byBody.has(norm(n)) && !patchable.has(norm(n))
      )?.[0];
      const wrapperApplies = !!wrapper && (!!bodySchema || (jsonPatch && patchable.size > 0));

      const specQuery = spec?.queryParams(route.httpVerb, entry.key);

      for (const [name] of props) {
        const n = norm(name);
        // Client-side shaping vocabulary is consumed by the MCP server, never
        // sent to the API — skipped before any classification so it can be
        // reported neither as undeclared drift nor as stale types.
        if (CLIENT_SHAPING_PARAMS.has(n)) {continue;}
        if (isPathParam(n) || byQuery.has(n) || byBody.has(n)) {continue;}
        if (wrapperApplies && name === wrapper) {continue;}

        if (jsonPatch) {
          if (!patchable.size) {continue;} // no example — nothing to check against
          if (patchable.has(n) || /^(patch)?operations$/.test(n)) {continue;}
          r.undeclaredParam.push({
            key: `${id}.${name}`,
            detail: `JSON-Patch ${entry.key}: the operation's example enumerates the modifiable properties and '${name}' is not among them (${[...patchable].join(', ')})`,
          });
          continue;
        }
        if (opaqueBody) {continue;}

        if (specQuery && [...specQuery].some((s) => norm(s) === n)) {
          r.staleTypes.push({
            key: `${id}.${name}`,
            detail: `the shipped ${release} spec declares '${name}' on ${route.httpVerb.toUpperCase()} ${entry.key}; the vendored generated ${opId} does not`,
          });
          continue;
        }
        r.undeclaredParam.push({
          key: `${id}.${name}`,
          detail: `${route.httpVerb.toUpperCase()} ${entry.key} -> ${opId} declares no '${name}'`,
        });
      }

      const omitted = op.query.filter((p) => !toolNames.has(norm(p.name))).map((p) => p.name);
      if (omitted.length) {r.omittedQueryParam.push({ key: id, detail: `${opId} declares ${omitted.join(', ')}` });}

      for (const [name, schema] of props) {
        const declared = byQuery.get(norm(name)) ?? byBody.get(norm(name));
        if (!declared) {continue;}
        const allowed = enumValuesOf(declared.tsType, types);
        if (!allowed) {continue;}
        const exposed = schema?.enum ?? [];
        if (!exposed.length) {
          r.enumDrift.push({
            key: `${id}.${name}`,
            detail: `typed as a plain string; ${opId} declares an enum (${allowed.join(' | ')}). A wrong guess on an enum returns HTTP 400, not a silently-ignored 200`,
          });
          continue;
        }
        const illegal = exposed.filter((v) => !allowed.includes(v));
        const absent = allowed.filter((v) => !exposed.includes(v));
        if (illegal.length || absent.length) {
          r.enumDrift.push({
            key: `${id}.${name}`,
            detail: `${illegal.length ? `values the API does not accept: ${illegal.join(', ')}; ` : ''}values the API accepts but the tool omits: ${absent.join(', ') || '(none)'}`,
          });
        }
      }

      if (wrapperApplies) {
        const needs = (bodySchema?.properties ?? []).filter((p) => p.required && !p.hasDefault).map((p) => p.name);
        r.wrapperBody.push({
          key: id,
          detail: `forwards '${wrapper}' as the request body; ${op.requestBodySchema ?? 'the JSON-Patch document'} requires ${needs.join(', ') || '(nothing, but the shape is still undescribed)'}`,
        });
      } else if (bodySchema && !jsonPatch) {
        // `hasDefault` excluded: openapi-typescript emits a defaulted property
        // as non-optional even when the spec does not require it.
        const required = bodySchema.properties.filter((p) => p.required && !p.hasDefault).map((p) => p.name);
        const cannotSupply = required.filter((p) => !toolNames.has(norm(p)));
        const notEnforced = required.filter((p) => toolNames.has(norm(p)) && !toolRequired.has(norm(p)));
        if (cannotSupply.length || notEnforced.length) {
          r.bodyRequired.push({
            key: id,
            detail: `${op.requestBodySchema} requires ${required.join(', ')}` +
              (cannotSupply.length ? ` — tool cannot supply ${cannotSupply.join(', ')}` : '') +
              (notEnforced.length ? ` — tool exposes but does not require ${notEnforced.join(', ')}` : ''),
          });
        }
      }
    }
  }
  return r;
}

/** `key` set of a finding list, for set comparison against an allowlist. */
export const keysOf = (fs: Finding[]): string[] => fs.map((f) => f.key).sort();

/** Render for a failure message: one finding per line, with its explanation. */
export const explain = (fs: Finding[]): string =>
  fs.map((f) => `  ${f.key}\n      ${f.detail}`).join('\n');
