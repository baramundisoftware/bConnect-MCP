/**
 * Results of a live run: the checks on the run as a whole, console sanitising,
 * and the summary that may be published.
 *
 * The local report (reports/live-bms.json, gitignored) keeps everything. Console
 * output carries no credentials, host or object IDs. The published summary
 * carries only counts, tool names, statuses and finding classes.
 */
import type { SchemaFinding } from '../../lib/spec-validator.js';
import { LiveConfigError } from './env.js';
import type { Profile } from './profile.js';

export type Outcome = 'ok' | 'expected' | 'failed' | 'not verified live' | 'skipped';
export interface ToolRun {
  server: string;
  tool: string;
  outcome: Outcome;
  /** ok: the operation; expected: the reason; failed: the tool's error; not verified live / skipped: why. Local report only. */
  detail: string;
  args?: Record<string, unknown>;
  ms?: number;
  statuses?: number[];
  requests?: string[];
  schema?: SchemaFinding[];
  /** `<domain> <spec path>` of the tool's operation. */
  route?: string;
}

/** A live run that exercised nothing is a failed run, not a pass. */
export function assertExercised(counts: { startups: number; calls: number }): void {
  if (counts.startups === 0 && counts.calls === 0) throw new LiveConfigError('nothing was exercised: no server started and no tool was called');
  if (counts.calls === 0) throw new LiveConfigError('no read tool was called against the bMS');
}

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Text fit for the console: credentials, the bMS host and object IDs replaced. */
export function sanitise(text: string, run: { hostname: string; secrets: string[] }): string {
  let out = run.secrets.reduce((acc, secret) => acc.split(secret).join('***'), text);
  if (run.hostname) out = out.split(run.hostname).join('<bms>');
  return out.replace(GUID, '{id}');
}

/** Refused requests as console lines (method, path, reason), sanitised like all console text. */
export function refusedLines(refused: Array<{ method: string; path: string; reason: string }>, run: { hostname: string; secrets: string[] }): string[] {
  return refused.map((r) => sanitise(`${r.method} ${r.path} (${r.reason})`, run));
}

export interface SummaryInput {
  release: string;
  bmsVersion?: string;
  tlsVerified: boolean;
  plainHttp?: boolean;
  caFile: boolean;
  startups: { ok: number; total: number };
  runs: ToolRun[];
  profile?: Profile;
}

/** Markdown for a PR, an issue or release notes: counts, tool names, statuses, finding classes. */
export function sanitisedSummary(input: SummaryInput): string {
  const { runs } = input;
  const by = (o: Outcome): ToolRun[] => runs.filter((r) => r.outcome === o);
  const statuses = (r: ToolRun): string => (r.statuses?.length ? r.statuses.join(', ') : '–');
  const skippedBy = new Map<string, number>();
  for (const r of by('skipped')) {
    // "no ID from /v2.0/LogicalGroups on this bMS" → one class per route kind, no values.
    const reason = r.detail.replace(/ from \S+ on this bMS$/, ' from its parent list on this bMS');
    skippedBy.set(reason, (skippedBy.get(reason) ?? 0) + 1);
  }
  const lines = [
    '## Live bMS run',
    '',
    `- bMS release ${input.release}${input.bmsVersion ? ` (version ${input.bmsVersion})` : ''}`,
    `- TLS: ${input.plainHttp ? 'none (plain HTTP; credentials travel unencrypted)'
      : input.tlsVerified ? `certificates verified${input.caFile ? ' (CA file set)' : ''}` : 'NOT verified (NODE_TLS_REJECT_UNAUTHORIZED=0)'}`,
    `- Startup: ${input.startups.ok}/${input.startups.total} servers started with the startup check and sent nothing else`,
    `- Read tools: ${by('ok').length} ok, ${by('expected').length} expected, ${by('failed').length} failed, ${by('not verified live').length} not verified live, ${by('skipped').length} skipped`,
  ];
  const p = input.profile;
  if (p) {
    const types = Object.entries(p.endpointTypes)
      .map(([type, n]) => `${type} ${n.total}${n.total > 0 && n.enrolled === 0 ? ' (none enrolled)' : ''}`).join(', ');
    lines.push(
      `- Endpoint types: ${types || 'none counted'}`,
      `- MDM: ${p.mdm}; Entra ID: ${p.entraId}`,
      ...p.untestedReleases.map((r) => `- ${r}: not verified live (no test installation)`),
    );
  }
  if (by('failed').length) {
    lines.push('', '### Failed', '', '| Tool | Status |', '| --- | --- |', ...by('failed').map((r) => `| \`${r.tool}\` | ${statuses(r)} |`));
  }
  if (by('not verified live').length) {
    lines.push('', '### Not verified live (data class missing on this bMS)', '', '| Tool | Why |', '| --- | --- |',
      ...by('not verified live').map((r) => `| \`${r.tool}\` | ${r.detail} |`));
  }
  if (by('expected').length) {
    lines.push('', '### Expected non-success answers', '', '| Tool | Status |', '| --- | --- |',
      ...by('expected').map((r) => `| \`${r.tool}\` | ${statuses(r)} |`));
  }
  const drift = runs.filter((r) => r.schema?.length);
  if (drift.length) {
    lines.push('', '### Response-schema differences (reported, not failed)', '', '| Tool | Differences |', '| --- | --- |',
      ...drift.map((r) => `| \`${r.tool}\` | ${[...new Set(r.schema?.map((f) => `\`${f.path}\` ${f.keyword}`))].join('; ')} |`));
  }
  if (skippedBy.size) {
    lines.push('', '### Skipped', '', '| Reason | Tools |', '| --- | --- |',
      ...[...skippedBy].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `| ${reason} | ${n} |`));
  }
  return lines.join('\n') + '\n';
}
