/**
 * A reader for the openapi-typescript output under `bconnect-*-mcp/src/generated/`.
 *
 * Why parse the .ts and not `openapi-specs/26R1/*.json`:
 *
 *  1. The generated types are what the *code* is typed against — modules write
 *     `operations['GetAllMobileDeviceRules']['parameters']['query']`. If a tool
 *     schema and the generated types disagree, that is drift inside one
 *     repository, which is exactly what R1 describes. Comparing against the
 *     spec JSON instead measures drift against an artefact the build does not
 *     consume.
 *  2. Coverage is strictly better. `openapi-specs/26R1/bConnect_Endpoints.json`
 *     has no `IndustrialEndpoints` paths at all, so the earlier spec-driven
 *     audit had to skip four Industrial tools. The generated types declare
 *     them, so they can be checked here.
 *  3. Enums are legible. The spec hides them behind `allOf` + `$ref`, which is
 *     how ten tools ended up typing an enum filter as a bare string; the
 *     generated output renders them as a string-literal union that resolves in
 *     one step.
 *
 * The parser is indentation-driven rather than a real TS parse. That is sound
 * here because the input is machine-generated with a fixed emitter: four-space
 * indent, one member per line, no reformatting. `assertWellFormed()` below
 * fails loudly if that assumption ever stops holding, so a silently-empty
 * parse cannot masquerade as "no drift found".
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** A single query/path parameter as the generated operation declares it. */
export interface GeneratedParam {
  name: string;
  required: boolean;
  /** Raw TypeScript type text, e.g. `string`, `components["schemas"]["Scope"]`. */
  tsType: string;
  /**
   * True when the emitter's JSDoc carries `@default`. openapi-typescript emits
   * a non-nullable property that has a default as NON-optional even though the
   * spec's `required` array does not list it — its reasoning is that the server
   * always supplies a value. Treating those as spec-required would report three
   * enrollment tools as broken for not demanding a field the API defaults;
   * checked against 25R2 and 26R1, neither lists them as required.
   */
  hasDefault?: boolean;
}

export interface GeneratedOperation {
  id: string;
  query: GeneratedParam[];
  path: GeneratedParam[];
  /** Schema name behind `requestBody.content["application/json"]`, if any. */
  requestBodySchema?: string;
  requestBodyMediaType?: string;
  /**
   * For a JSON-Patch body, the property paths the operation's `@example`
   * enumerates. The emitter carries the spec's example verbatim, and for this
   * API that example is documented as containing *all* modifiable properties —
   * which makes it the only machine-readable statement of what a PATCH tool is
   * allowed to expose. Without it a JSON-Patch route has no checkable contract
   * at all, because its schema is the generic `JsonPatchDocument`.
   */
  patchablePaths?: string[];
}

export interface GeneratedSchema {
  name: string;
  /** Present for object schemas. */
  properties: GeneratedParam[];
  /** Present for enum aliases (`Scope: "A" | "B";`). */
  enumValues?: string[];
}

export interface GeneratedTypes {
  /** Absolute path of the .ts file this came from. */
  file: string;
  /** URL path template -> HTTP method (lowercase) -> operationId. */
  paths: Map<string, Record<string, string>>;
  operations: Map<string, GeneratedOperation>;
  schemas: Map<string, GeneratedSchema>;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Resolve a TypeScript type expression to its enum members, if it is one.
 * Handles the two forms the emitter produces:
 *   - inline union            `"A" | "B"`
 *   - reference (or array of) `components["schemas"]["Scope"]`, `…["Scope"][]`
 * Returns undefined for anything that is not an enum.
 */
export function enumValuesOf(tsType: string, types: GeneratedTypes): string[] | undefined {
  const bare = tsType.trim().replace(/\[\]$/, '').replace(/\s*\|\s*null$/, '');

  const ref = bare.match(/^components\["schemas"\]\["([^"]+)"\]$/);
  if (ref) {
    const target = types.schemas.get(ref[1]);
    return target?.enumValues;
  }

  // Inline union of string literals — every member must be a literal, so a
  // `string | null` is not mistaken for a one-value enum.
  const members = bare.split('|').map((m) => m.trim());
  if (members.length > 1 && members.every((m) => /^"[^"]*"$/.test(m))) {
    return members.map((m) => m.slice(1, -1));
  }
  return undefined;
}

/** Parse one `*-types.ts` file emitted by openapi-typescript. */
export function parseGeneratedTypes(file: string): GeneratedTypes {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const out: GeneratedTypes = { file, paths: new Map(), operations: new Map(), schemas: new Map() };

  type Region = 'none' | 'paths' | 'operations' | 'schemas';
  let region: Region = 'none';

  // Cursors for the member currently being filled in.
  let curPath: string | null = null;
  let curOp: GeneratedOperation | null = null;
  let curParamBlock: 'query' | 'path' | null = null;
  let curSchema: GeneratedSchema | null = null;
  let schemaDepth = 0; // brace depth inside the current schema body

  // JSDoc immediately preceding the member currently being read.
  let doc = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {continue;}
    if (line.trim().startsWith('*') || line.trim().startsWith('/*')) { doc += line; continue; }
    const memberDoc = doc;
    doc = '';

    // ── region switches (all at column 0) ────────────────────────────────
    if (/^export interface paths \{/.test(line)) { region = 'paths'; continue; }
    if (/^export interface operations \{/.test(line)) { region = 'operations'; continue; }
    if (/^export interface components \{/.test(line)) { region = 'none'; continue; }
    if (/^export type|^export interface/.test(line)) { region = 'none'; continue; }
    if (/^\}/.test(line)) { region = 'none'; curPath = null; curOp = null; curSchema = null; continue; }

    // `schemas` lives inside `components`, one level down.
    if (/^    schemas: \{/.test(line)) { region = 'schemas'; continue; }
    if (region === 'schemas' && /^    \};?/.test(line)) { region = 'none'; continue; }

    const indent = indentOf(line);
    const body = line.trim();

    // ── paths ───────────────────────────────────────────────────────────
    if (region === 'paths') {
      if (indent === 4) {
        const m = body.match(/^"([^"]+)": \{$/);
        curPath = m ? m[1] : null;
        if (curPath) {out.paths.set(curPath, {});}
        continue;
      }
      if (indent === 8 && curPath) {
        const m = body.match(/^(get|put|post|delete|options|head|patch|trace): operations\["([^"]+)"\];$/);
        if (m) {out.paths.get(curPath)![m[1]] = m[2];}
      }
      continue;
    }

    // ── operations ──────────────────────────────────────────────────────
    if (region === 'operations') {
      if (indent === 4) {
        const m = body.match(/^([A-Za-z0-9_$]+): \{$/);
        curOp = m ? { id: m[1], query: [], path: [] } : null;
        if (curOp) {out.operations.set(curOp.id, curOp);}
        curParamBlock = null;
        continue;
      }
      if (!curOp) {continue;}

      if (indent === 12) {
        const m = body.match(/^(query|path)\??: \{$/);
        curParamBlock = m ? (m[1] as 'query' | 'path') : null;
        continue;
      }
      if (indent === 16 && curParamBlock) {
        const m = body.match(/^([A-Za-z0-9_$]+)(\??): (.+);$/);
        if (m) {curOp[curParamBlock].push({ name: m[1], required: m[2] !== '?', tsType: m[3], hasDefault: /@default/.test(memberDoc) });}
        continue;
      }
      if (indent === 8) {
        curParamBlock = null;
        // `requestBody: {` … `content: {` … `"media": TYPE;`
        if (/^requestBody\??: \{$/.test(body)) {
          // Scan to the end of the requestBody block rather than a fixed
          // number of lines: a JSON-Patch body carries an `@example` comment
          // that routinely runs to 60+ lines before the media type appears.
          const patchPaths: string[] = [];
          for (let j = i + 1; j < lines.length; j++) {
            if (indentOf(lines[j]) <= 8 && lines[j].trim()) {break;} // left the block
            const ex = lines[j].match(/"path":\s*"\/([^"]+)"/);
            if (ex) {patchPaths.push(ex[1]);}
            const c = lines[j].trim().match(/^"([^"]+)": ([^"].*);$/);
            if (c) {
              curOp.requestBodyMediaType = c[1];
              curOp.requestBodySchema = c[2].match(/^components\["schemas"\]\["([^"]+)"\]$/)?.[1];
              if (patchPaths.length) {curOp.patchablePaths = [...new Set(patchPaths)];}
              break;
            }
          }
        }
      }
      continue;
    }

    // ── components.schemas ──────────────────────────────────────────────
    if (region === 'schemas') {
      if (indent === 8 && !curSchema) {
        const obj = body.match(/^([A-Za-z0-9_$]+)\??: \{$/);
        if (obj) {
          curSchema = { name: obj[1], properties: [] };
          out.schemas.set(curSchema.name, curSchema);
          schemaDepth = 1;
          continue;
        }
        const alias = body.match(/^([A-Za-z0-9_$]+)\??: (.+);$/);
        if (alias) {
          const values = enumValuesOf(alias[2], out) ?? inlineUnion(alias[2]);
          out.schemas.set(alias[1], { name: alias[1], properties: [], enumValues: values });
        }
        continue;
      }
      if (curSchema) {
        // Only members at the schema's own level count as its properties;
        // anything deeper belongs to a nested inline object.
        if (schemaDepth === 1 && indent === 12) {
          const prop = body.match(/^(readonly )?"?([A-Za-z0-9_$]+)"?(\??): (.+?);?$/);
          if (prop && !/^\}/.test(body)) {
            curSchema.properties.push({
              name: prop[2],
              required: prop[3] !== '?',
              tsType: prop[4],
              hasDefault: /@default/.test(memberDoc),
            });
          }
        }
        schemaDepth += (body.match(/\{/g)?.length ?? 0) - (body.match(/\}/g)?.length ?? 0);
        if (schemaDepth <= 0) { curSchema = null; schemaDepth = 0; }
      }
    }
  }

  return out;
}

function inlineUnion(tsType: string): string[] | undefined {
  const members = tsType.trim().split('|').map((m) => m.trim());
  if (members.length > 1 && members.every((m) => /^"[^"]*"$/.test(m))) {
    return members.map((m) => m.slice(1, -1));
  }
  return undefined;
}

/**
 * Guard against a parse that succeeds vacuously. Every failure mode this
 * parser has (an emitter change, a moved region marker, a reindent) shows up
 * as *empty* results, and an empty right-hand side makes every drift check
 * pass. That is the failure this project keeps finding, so it is asserted
 * rather than assumed.
 */
export function assertWellFormed(t: GeneratedTypes): string[] {
  const problems: string[] = [];
  if (t.paths.size === 0) {problems.push(`${t.file}: parsed 0 paths`);}
  if (t.operations.size === 0) {problems.push(`${t.file}: parsed 0 operations`);}
  if (t.schemas.size === 0) {problems.push(`${t.file}: parsed 0 schemas`);}
  const opsWithoutPath = [...t.paths.values()].every((m) => Object.keys(m).length === 0);
  if (t.paths.size && opsWithoutPath) {problems.push(`${t.file}: no path resolved to an operationId`);}
  const anyQuery = [...t.operations.values()].some((o) => o.query.length > 0);
  if (t.operations.size && !anyQuery) {problems.push(`${t.file}: no operation declared a query parameter`);}
  return problems;
}

/** All `src/generated/*.ts` files for one server, keyed by module segment. */
export function loadServerTypes(repoRoot: string, serverDir: string): Map<string, GeneratedTypes> {
  const dir = resolve(repoRoot, serverDir, 'src', 'generated');
  const byModule = new Map<string, GeneratedTypes>();
  if (!existsSync(dir)) {return byModule;}
  for (const f of readdirSync(dir).filter((x) => x.endsWith('-types.ts'))) {
    byModule.set(f.replace('-types.ts', '').toLowerCase(), parseGeneratedTypes(join(dir, f)));
  }
  return byModule;
}

/**
 * The shipped spec JSON for one module, used ONLY to classify a mismatch once
 * the generated types have already found one — never as the thing tools are
 * asserted against.
 *
 * The distinction matters. When a tool declares a parameter its generated
 * operation does not, there are two very different explanations: the tool
 * invented a parameter (D14a — silently dropped, wrong answers), or the
 * generated types are behind the release the suite targets. Asking the shipped
 * 26R1 spec separates them, and the fix is different in each case.
 */
export interface ShippedSpec {
  /** wildcarded path -> verb -> declared query parameter names. */
  routes: Map<string, Map<string, Set<string>>>;
  hasRoute(pathTemplate: string): boolean;
  verbsOf(pathTemplate: string): string[];
  queryParams(verb: string, pathTemplate: string): Set<string> | undefined;
}

export function loadShippedSpec(
  repoRoot: string,
  release: string,
  moduleSegment: string
): ShippedSpec | undefined {
  const dir = resolve(repoRoot, 'openapi-specs', release);
  if (!existsSync(dir)) {return undefined;}
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const file = readdirSync(dir).find(
    (f) => norm(f.replace('bConnect_', '').replace('.json', '')) === norm(moduleSegment)
  );
  if (!file) {return undefined;}

  interface SpecParam { name: string; in: string }
  interface SpecOp { parameters?: SpecParam[] }
  const spec = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
    paths?: Record<string, Record<string, SpecOp>>;
  };
  const routes = new Map<string, Map<string, Set<string>>>();
  for (const [p, verbs] of Object.entries(spec.paths ?? {})) {
    const wild = p.replace(/\{[^}]*\}/g, '{}');
    if (!routes.has(wild)) {routes.set(wild, new Map());}
    for (const [verb, op] of Object.entries(verbs)) {
      routes.get(wild)!.set(
        verb.toLowerCase(),
        new Set((op.parameters ?? []).filter((x) => x.in === 'query').map((x) => x.name))
      );
    }
  }
  const key = (p: string) => p.replace(/\{[^}]*\}/g, '{}');
  return {
    routes,
    hasRoute: (p) => routes.has(key(p)),
    verbsOf: (p) => [...(routes.get(key(p))?.keys() ?? [])],
    queryParams: (verb, p) => routes.get(key(p))?.get(verb.toLowerCase()),
  };
}

export interface SuiteTypes {
  /** serverDir -> module segment -> the types that server vendors. */
  perServer: Map<string, Map<string, GeneratedTypes>>;
  /**
   * serverDir -> module segment -> the types to check that server's tools
   * against. A server's own copy is used whenever it is well-formed; several
   * servers vendor a trimmed copy of a sibling module's types, so borrowing
   * across servers by default would compare a tool against a subset of the
   * routes its own build is typed for.
   */
  resolved: Map<string, Map<string, { types: GeneratedTypes; fromServer: string }>>;
  /**
   * Files under `src/generated/` that are NOT openapi-typescript output — they
   * declare no `paths` and no `operations`, so nothing in them can be used to
   * check a tool. Kept as data rather than thrown away: a server typed against
   * one of these has no machine-checkable contract at all, which is a finding
   * in its own right.
   */
  stubs: { server: string; file: string; reason: string }[];
}

/**
 * Load every server's generated types and pick, per module segment, one
 * well-formed copy to check against.
 *
 * The suite vendors the same module's types into several servers — `jobs` and
 * `endpoints` each carry ten. Where a server's own copy is a hand-written stub
 * (see `stubs`), a sibling's real copy is used so the tools can still be
 * checked, and the substitution is reported rather than hidden.
 */
export function loadSuiteTypes(repoRoot: string, serverDirs: string[]): SuiteTypes {
  const perServer = new Map<string, Map<string, GeneratedTypes>>();
  const stubs: { server: string; file: string; reason: string }[] = [];
  const wellFormed = new Map<string, Map<string, GeneratedTypes>>(); // segment -> server -> types

  for (const server of [...serverDirs].sort()) {
    const mods = loadServerTypes(repoRoot, server);
    perServer.set(server, mods);
    for (const [segment, types] of mods) {
      const problems = assertWellFormed(types);
      if (problems.length) { stubs.push({ server, file: types.file, reason: problems.join('; ') }); continue; }
      if (!wellFormed.has(segment)) {wellFormed.set(segment, new Map());}
      wellFormed.get(segment)!.set(server, types);
    }
  }

  const resolved = new Map<string, Map<string, { types: GeneratedTypes; fromServer: string }>>();
  for (const server of perServer.keys()) {
    const forServer = new Map<string, { types: GeneratedTypes; fromServer: string }>();
    for (const segment of wellFormed.keys()) {
      const own = wellFormed.get(segment)!.get(server);
      if (own) { forServer.set(segment, { types: own, fromServer: server }); continue; }
      // Fall back to whichever server does carry a real copy — the one case
      // that needs it is bconnect-assets-mcp, whose own generated file is a
      // hand-written stub. Widest copy wins, so a trimmed sibling cannot be
      // picked over a complete one.
      const best = [...wellFormed.get(segment)!.entries()].sort((a, b) => b[1].paths.size - a[1].paths.size)[0];
      if (best) {forServer.set(segment, { types: best[1], fromServer: best[0] });}
    }
    resolved.set(server, forServer);
  }
  return { perServer, resolved, stubs };
}
