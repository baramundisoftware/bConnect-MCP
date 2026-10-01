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
function operationIn(ops: ApiOperation[], domain: string, operationId: string): ApiOperation | undefined {
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
  /** Value of the undeclared argument; it must never reach the wire. */
  unknownValue: string;
  requests: Array<{ method: string; path: string; query: Array<[string, string]>; body: string }>;
}

/** Path-slot names of a spec template, e.g. ['logicalGroupId'] for /v2.0/LogicalGroups/{logicalGroupId}/Endpoints. */
const slotsOf = (template: string): Array<string | null> =>
  template.split('/').map((seg) => /^\{(\w+)\}$/.exec(seg)?.[1] ?? null);

/** True when the argument plausibly fills the slot: same name, or either side is the generic `id`. */
function slotFits(slot: string, arg: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/id$/, '');
  return slot.toLowerCase() === 'id' || arg.toLowerCase() === 'id'
    || norm(slot).includes(norm(arg)) || norm(arg).includes(norm(slot));
}

/**
 * Parameter checks for calls made with all documented arguments:
 * - `arg-leak`: the undeclared argument's value reached the query or the body.
 * - `query-undeclared`: a query parameter the operation doesn't declare was sent.
 * - `query-not-offered`: a query parameter the operation declares is neither in the tool's input
 *   schema nor sent (a tool may offer it under its own argument name).
 * - `path-slot`: a path slot is filled by an argument whose name doesn't fit the slot.
 * - `page-description`: `Page` isn't described as zero-based, or `PageSize` doesn't state the 1000 limit.
 * Calls whose requests don't match a declared operation are left to the route check.
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
    const page = props.Page?.description as string | undefined;
    if (props.Page && !(page && /zero|\b0\b/i.test(page) && !/1-based|one-based|starts? (at|from) 1\b/i.test(page))) {
      v('page-description', call.tool, 'Page');
    }
    const pageSize = props.PageSize?.description as string | undefined;
    if (props.PageSize && !(pageSize && /\b1000\b/.test(pageSize))) v('page-description', call.tool, 'PageSize');

    const declared = (table[call.tool] ?? [])
      .map((id) => ops.find((op) => op.domain === domain && op.operationId === id))
      .filter((op): op is ApiOperation => !!op);
    for (const r of call.requests) {
      if (r.body.includes(call.unknownValue) || r.query.some(([k, val]) => k.includes(call.unknownValue) || val.includes(call.unknownValue))) {
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
