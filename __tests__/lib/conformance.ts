/**
 * Spec-conformance checks (REQ-QA-001), as pure functions so the guard can be
 * proven on known-bad fixtures as well as run on the real servers.
 *
 * A violation has a stable key: `<check> <release> <server> <tool> <detail>`.
 * Known violations live in __tests__/spec-conformance.baseline.json, each with
 * the GitHub issue that fixes it.
 */
import { type ApiOperation, type Release, loadOperations } from './spec.js';

export interface Violation {
  check: string;
  release: Release | '-'; // '-' for checks that don't depend on the release
  server: string;
  tool: string; // '-' for checks that aren't about one tool
  detail: string;
}

export const keyOf = (v: Violation): string => `${v.check} ${v.release} ${v.server} ${v.tool} ${v.detail}`;

export interface ExercisedTool {
  tool: string;
  requests: Array<{ method: string; path: string }>; // path below the base URL: /<domain>/v2.0/…
}

/** The operation with this id in the domain, for the release. */
export function operationIn(ops: ApiOperation[], domain: string, operationId: string): ApiOperation | undefined {
  return ops.find((op) => op.domain === domain && op.operationId === operationId);
}

/**
 * Binding and route checks for one server and release.
 * - `binding-missing`: a registered tool has no entry in TOOL_OPERATIONS.
 * - `binding-unknown-op`: a declared operationId doesn't exist in this release's spec.
 * - `no-request`: the tool sent nothing (all gates open, valid arguments).
 * - `route`: a request doesn't go to the method + route of a declared operation
 *   (also when none of the declared operations exists in this release, so the
 *   baseline pins the exact path).
 *
 * `covered` collects the operationIds a request actually reached, for the
 * coverage check: a table row alone doesn't count.
 */
export function checkTools(args: {
  release: Release;
  server: string;
  domain: string;
  table: Readonly<Record<string, readonly string[]>>;
  exercised: ExercisedTool[];
  operations?: ApiOperation[];
  covered?: Set<string>;
}): Violation[] {
  const { release, server, domain, table, exercised, covered } = args;
  const ops = args.operations ?? loadOperations(release);
  const out: Violation[] = [];
  const v = (check: string, tool: string, detail: string): void => {
    out.push({ check, release, server, tool, detail });
  };
  for (const { tool, requests } of exercised) {
    const declared = table[tool];
    if (!declared || declared.length === 0) {
      v('binding-missing', tool, '-');
      continue;
    }
    const known = declared.map((id) => operationIn(ops, domain, id)).filter((op): op is ApiOperation => !!op);
    for (const id of declared) {
      if (!operationIn(ops, domain, id)) v('binding-unknown-op', tool, id);
    }
    if (requests.length === 0) {
      v('no-request', tool, '-');
      continue;
    }
    for (const r of requests) {
      const m = /^\/([^/]+)(\/.*)$/.exec(r.path);
      const hit = m && m[1].toLowerCase() === domain ? known.find((op) => op.matches(r.method, m[2])) : undefined;
      if (hit) covered?.add(hit.operationId);
      else v('route', tool, `${r.method} ${r.path}`);
    }
  }
  return out;
}

/** Table rows for tools no release registers (dead entries). */
export function checkStaleBindings(server: string, table: Readonly<Record<string, readonly string[]>>, registeredInAnyRelease: Set<string>): Violation[] {
  return Object.keys(table)
    .filter((tool) => !registeredInAnyRelease.has(tool))
    .map((tool) => ({ check: 'binding-stale', release: '-', server, tool, detail: '-' }));
}

/** `coverage`: an operation of the release's spec that no tool's request reached. */
export function checkCoverage(release: Release, domain: string, covered: Set<string>, operations?: ApiOperation[]): Violation[] {
  return (operations ?? loadOperations(release))
    .filter((op) => op.domain === domain && !covered.has(op.operationId))
    .map((op) => ({ check: 'coverage', release, server: domain, tool: '-', detail: op.operationId }));
}

export type Baseline = Record<string, number>;

/**
 * Compare observed violations with the baseline.
 * - new: observed, not in the baseline → must be fixed or triaged into an issue
 * - stale: in the baseline, no longer observed → the fix is proven; remove the entry
 * - untriaged: baseline entries without an issue number (> 0)
 */
export function compareWithBaseline(observed: Violation[], baseline: Baseline): { new: string[]; stale: string[]; untriaged: string[] } {
  const keys = new Set(observed.map(keyOf));
  return {
    new: [...keys].filter((k) => !(k in baseline)).sort(),
    stale: Object.keys(baseline).filter((k) => !keys.has(k)).sort(),
    untriaged: Object.entries(baseline).filter(([, issue]) => !(Number.isInteger(issue) && issue > 0)).map(([k]) => k).sort(),
  };
}

/** One tool call with every documented argument plus one undeclared one. */
export interface ParamCall {
  tool: string;
  inputSchema: Record<string, any>;
  /** Distinct GUID per ID-like argument, so a path slot can be traced to its argument. */
  idsByArg: Record<string, string>;
  /** Name and value of the undeclared argument; neither may reach the wire. */
  unknownName: string;
  unknownValue: string;
  /** The tool call returned an error. */
  failed: boolean;
  requests: Array<{ method: string; path: string; query: Array<[string, string]>; body: string }>;
}

/** Path-slot names of a spec template, e.g. ['logicalGroupId'] for /v2.0/LogicalGroups/{logicalGroupId}/Endpoints. */
const slotsOf = (template: string): Array<string | null> =>
  template.split('/').map((seg) => /^\{(\w+)\}$/.exec(seg)?.[1] ?? null);

/**
 * True when the argument fills the slot by name: the same name ignoring case
 * and a trailing `Id`, or either side is the generic `id`. `dynamicGroupId`
 * doesn't fit `{universalDynamicGroupId}`: different entities.
 */
function slotFits(slot: string, arg: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/id$/, '');
  return norm(slot) === '' || norm(arg) === '' || norm(slot) === norm(arg);
}

/**
 * Parameter checks for calls made with all documented arguments:
 * - `arg-leak`: the undeclared argument's value reached the query or the body.
 * - `query-undeclared`: a query parameter the operation doesn't declare was sent.
 * - `query-not-offered`: a query parameter the operation declares is neither in the tool's input
 *   schema nor sent (a tool may offer it under its own argument name).
 * - `path-slot`: a path slot is filled by an argument whose name doesn't fit the slot.
 * - `page-description`: a page argument (any case) isn't described as zero-based, or a page-size
 *   argument doesn't state the 1000 maximum.
 * - `params-not-exercised`: the call failed or sent nothing, so none of the above could be checked.
 * Requests that don't match a declared operation are left to the route check (arg-leak and the
 * descriptions are still checked).
 *
 * Argument names are compared exactly (case matters: `includeSubGroups` is not `includeSubfolders`).
 */
export function checkParams(args: {
  release: Release;
  server: string;
  domain: string;
  table: Readonly<Record<string, readonly string[]>>;
  calls: ParamCall[];
  operations?: ApiOperation[];
}): Violation[] {
  const { release, server, domain, table, calls } = args;
  const ops = args.operations ?? loadOperations(release);
  const out: Violation[] = [];
  const v = (check: string, tool: string, detail: string): void => {
    out.push({ check, release, server, tool, detail });
  };
  for (const call of calls) {
    const props: Record<string, any> = call.inputSchema.properties ?? {};
    for (const [name, schema] of Object.entries(props)) {
      const text = String(schema?.description ?? '');
      if (/^page$/i.test(name) && !(/zero[- ]?(based|indexed)|\b0-(based|indexed)|starts? (at|from) 0\b/i.test(text)
        && !/1-based|one-based|starts? (at|from) 1\b/i.test(text))) {
        v('page-description', call.tool, name);
      }
      if (/^page-?size$/i.test(name) && !/max\w*[^0-9]{0,12}1000\b|up to 1000\b|\b1\s*[–-]\s*1000\b/i.test(text)) v('page-description', call.tool, name);
    }
    if (call.failed || call.requests.length === 0) v('params-not-exercised', call.tool, '-');

    const declared = (table[call.tool] ?? [])
      .map((id) => ops.find((op) => op.domain === domain && op.operationId === id))
      .filter((op): op is ApiOperation => !!op);
    for (const r of call.requests) {
      const leaked = (text: string): boolean => text.includes(call.unknownValue) || text.includes(call.unknownName);
      if (leaked(r.body) || leaked(r.path) || r.query.some(([k, val]) => leaked(k) || leaked(val))) {
        v('arg-leak', call.tool, '-');
      }
      const m = /^\/([^/]+)(\/.*)$/.exec(r.path);
      const op = m && m[1].toLowerCase() === domain ? declared.find((o) => o.matches(r.method, m[2])) : undefined;
      if (!op) continue;
      for (const [name, val] of r.query) {
        if (!op.queryParams.includes(name) && !val.includes(call.unknownValue)) v('query-undeclared', call.tool, name);
      }
      // Offered = in the input schema, or sent (a tool may map its own argument name onto it).
      const sent = new Set(r.query.map(([k]) => k));
      for (const name of op.queryParams) {
        if (!(name in props) && !sent.has(name)) v('query-not-offered', call.tool, name);
      }
      const segments = m![2].split('/');
      slotsOf(op.path).forEach((slot, i) => {
        if (!slot) return;
        const arg = Object.entries(call.idsByArg).find(([, guid]) => guid === segments[i])?.[0];
        if (arg && !slotFits(slot, arg)) v('path-slot', call.tool, `{${slot}} ← ${arg}`);
      });
    }
  }
  // A tool calls one operation, so each finding appears once per call; keep keys unique.
  return [...new Map(out.map((x) => [keyOf(x), x])).values()];
}

/** One tool call, for the body and response checks. */
export interface WriteCall {
  tool: string;
  requests: Array<{ method: string; path: string; contentType: string | null; body: string }>;
  /** The tool's result text; leave out to skip the response check. */
  result?: string;
  /** Argument values are guard samples: ignore `format` errors in the body. */
  sampleValues?: boolean;
}

/**
 * Body and response checks:
 * - `body-content-type`: a body is sent with a content type the operation doesn't declare.
 * - `body-invalid`: the body doesn't match the operation's request schema (JSON Patch format for
 *   `application/json-patch+json`).
 * - `body-undeclared`: a body is sent to an operation that declares none.
 * - `response-dropped`: the operation declares a 2xx body, but the tool's result contains none of
 *   what the API returned (the mock puts `marker` in `id`, `name` and `guardMarker`, so returning
 *   the relevant fields is enough).
 * Requests that don't match a declared operation are left to the route check.
 */
export function checkBodies(args: {
  release: Release;
  server: string;
  domain: string;
  table: Readonly<Record<string, readonly string[]>>;
  calls: WriteCall[];
  marker: string;
  validate: (op: ApiOperation, contentType: string, body: string, options?: { ignoreFormats?: boolean }) => string[];
  operations?: ApiOperation[];
}): Violation[] {
  const { release, server, domain, table, calls, marker, validate } = args;
  const ops = args.operations ?? loadOperations(release);
  const out: Violation[] = [];
  const v = (check: string, tool: string, detail: string): void => {
    out.push({ check, release, server, tool, detail });
  };
  for (const call of calls) {
    const declared = (table[call.tool] ?? [])
      .map((id) => ops.find((op) => op.domain === domain && op.operationId === id))
      .filter((op): op is ApiOperation => !!op);
    for (const r of call.requests) {
      const m = /^\/([^/]+)(\/.*)$/.exec(r.path);
      const op = m && m[1].toLowerCase() === domain ? declared.find((o) => o.matches(r.method, m[2])) : undefined;
      if (!op) continue;
      const types = Object.keys(op.requestBodies);
      const contentType = (r.contentType ?? '').split(';')[0].trim().toLowerCase();
      if (types.length === 0) {
        if (r.body !== '') v('body-undeclared', call.tool, '-');
      } else {
        if (r.body !== '' && !types.includes(contentType)) v('body-content-type', call.tool, contentType || '(none)');
        if (validate(op, contentType, r.body, { ignoreFormats: call.sampleValues }).length > 0) v('body-invalid', call.tool, '-');
      }
      if (call.result !== undefined && op.returnsBody && !call.result.includes(marker)) v('response-dropped', call.tool, '-');
    }
  }
  return [...new Map(out.map((x) => [keyOf(x), x])).values()];
}

/** `write-with-writes-off`: a non-GET request sent while ALLOW_WRITE_OPERATIONS is off. */
export function checkWritesOff(release: Release, server: string, calls: Array<{ tool: string; requests: Array<{ method: string }> }>): Violation[] {
  return calls.flatMap((c) => [...new Set(c.requests.filter((r) => r.method !== 'GET').map((r) => r.method))]
    .map((method) => ({ check: 'write-with-writes-off', release, server, tool: c.tool, detail: method })));
}
