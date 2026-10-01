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
  release: Release;
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
 * - `route`: a request doesn't go to the method + route of a declared operation.
 */
export function checkTools(args: {
  release: Release;
  server: string;
  domain: string;
  table: Readonly<Record<string, readonly string[]>>;
  exercised: ExercisedTool[];
  operations?: ApiOperation[];
}): Violation[] {
  const { release, server, domain, table, exercised } = args;
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
    if (known.length === 0) continue; // nothing to compare with; reported above
    for (const r of requests) {
      const m = /^\/([^/]+)(\/.*)$/.exec(r.path);
      const ok = !!m && m[1].toLowerCase() === domain && known.some((op) => op.matches(r.method, m[2]));
      if (!ok) v('route', tool, `${r.method} ${r.path}`);
    }
  }
  return out;
}

/** Table rows for tools no release registers (dead entries). */
export function checkStaleBindings(server: string, release: Release, table: Readonly<Record<string, readonly string[]>>, registeredInAnyRelease: Set<string>): Violation[] {
  return Object.keys(table)
    .filter((tool) => !registeredInAnyRelease.has(tool))
    .map((tool) => ({ check: 'binding-stale', release, server, tool, detail: '-' }));
}

/** `coverage`: an operation of the release's spec that no tool declares. */
export function checkCoverage(release: Release, domain: string, declared: Set<string>, operations?: ApiOperation[]): Violation[] {
  return (operations ?? loadOperations(release))
    .filter((op) => op.domain === domain && !declared.has(op.operationId))
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
