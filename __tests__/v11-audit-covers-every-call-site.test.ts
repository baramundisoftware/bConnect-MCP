/**
 * The v1.1 audit goes stale, so the suite insists on it.
 *
 * `V11-AUDIT.md` is the evidence for one claim: every bConnect v1.1 call this
 * suite makes is a call v2.0 cannot make. v1.1 authenticates as a named DOMAIN
 * account and carries that account's own bMS rights rather than the API key's,
 * so an unjustified v1.1 call is not merely redundant — it is a standing
 * privilege the installation would not otherwise have. And v1.1 is sunsetting,
 * so the justification decays on the vendor's schedule, not ours.
 *
 * A document that records that claim is a snapshot. Snapshots of a moving API
 * are how a deprecated call outlives its justification. So this reads the
 * document and fails when it stops matching the code.
 *
 * ── What makes the call-site discovery COMPLETE ──────────────────────────────
 * Not a list anyone maintains. `v11CallSites()` scans the suite's own source,
 * and the first test below is what licenses it: exactly ONE file in the suite
 * constructs the `/bConnect/v1.1` root, so every v1.1 request necessarily goes
 * through `V11Client`, and the files that name `V11Client` are therefore the
 * complete set of places a v1.1 call can be written. If someone hand-rolls a
 * second v1.1 root, that test goes red before this one can be fooled.
 *
 * ── Properties, not spellings ────────────────────────────────────────────────
 * Nothing here matches a sentence. The verdict vocabulary is read out of the
 * document's own definition table rather than hardcoded, so renaming a verdict
 * is a one-place edit and using an undefined one is still an error. A named
 * v2.0 candidate is checked against the tools the suite actually advertises,
 * not against a list — that is the `/MobileDeviceRules` failure mode (a route
 * named in a document and absent from the API) transposed to this table.
 *
 * ── Unresolvable means RED ───────────────────────────────────────────────────
 * A controller argument this file cannot resolve to a string literal fails the
 * run. A guard that cannot see a call site must not report the same colour as
 * one that saw it and found a row.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SUITE_ROOT = join(__dirname, '..');

// ─── Locating the audit ──────────────────────────────────────────────────────

/**
 * Where the audit may live, in order.
 *
 * It sits at the working repository's root today, one level above the suite.
 * `PUBLICATION-PROCEDURE.md` makes the suite directory the published repository
 * ROOT, so a published checkout carries the v1.1 call sites and — unless the
 * document is shipped with them — not the audit that justifies them.
 *
 * The candidate list is the `"install" "../install"` precedent from
 * `scripts/release.sh`: resolve, do not hardcode. What it deliberately does NOT
 * do is skip when nothing is found. "The audit is missing" and "the audit is
 * satisfied" must never render as the same result.
 */
const AUDIT_CANDIDATES = [
  join(SUITE_ROOT, '..', 'V11-AUDIT.md'),
  join(SUITE_ROOT, 'V11-AUDIT.md'),
  join(SUITE_ROOT, 'docs', 'V11-AUDIT.md'),
];

function readAudit(): string {
  const found = AUDIT_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'V11-AUDIT.md was not found in any of:\n  ' +
        AUDIT_CANDIDATES.join('\n  ') +
        '\nThis suite makes bConnect v1.1 calls, and that document is the evidence that each ' +
        'one is a call v2.0 cannot make. A tree that ships the calls must ship the audit. ' +
        'Do not weaken this check into a skip — a missing audit would then look exactly like ' +
        'a satisfied one.'
    );
  }
  return readFileSync(found, 'utf8');
}

// ─── Reading markdown tables by column NAME ──────────────────────────────────

interface Table {
  columns: string[];
  rows: Record<string, string>[];
}

/** Every GitHub-flavoured table in a document, keyed by its header names. */
function tablesIn(markdown: string): Table[] {
  const lines = markdown.split(/\r?\n/);
  const tables: Table[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i];
    const rule = lines[i + 1];
    if (!header.trimStart().startsWith('|')) {continue;}
    if (!/^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(rule)) {continue;}

    const cells = (row: string): string[] =>
      row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

    const columns = cells(header);
    const rows: Record<string, string>[] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trimStart().startsWith('|'); j += 1) {
      const values = cells(lines[j]);
      const row: Record<string, string> = {};
      columns.forEach((name, k) => {
        row[name] = values[k] ?? '';
      });
      rows.push(row);
    }
    tables.push({ columns, rows });
    i = j - 1;
  }
  return tables;
}

/** The one table whose header carries all of these words. Ambiguity is an error. */
function tableWithColumns(markdown: string, wanted: string[]): Table {
  const has = (columns: string[], word: string): boolean =>
    columns.some((c) => c.toLowerCase().includes(word));
  const matches = tablesIn(markdown).filter((t) => wanted.every((w) => has(t.columns, w)));
  expect(
    matches.length,
    `Expected exactly one table in V11-AUDIT.md whose header mentions ${wanted
      .map((w) => `"${w}"`)
      .join(', ')}; found ${matches.length}. This guard reads the table by column NAME so ` +
      'columns can be reordered or renamed freely — but two tables answering to the same ' +
      'description makes "the table" ambiguous.'
  ).toBe(1);
  return matches[0];
}

const columnNamed = (table: Table, word: string): string =>
  table.columns.find((c) => c.toLowerCase().includes(word)) as string;

/** Every `backticked` token in a cell. */
const ticked = (cell: string): string[] =>
  [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);

// ─── Finding the v1.1 call sites in the source ───────────────────────────────

/** Workspace source trees, excluding tests, generated types and build output. */
function everySourceFile(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'build' || entry === '__tests__') {continue;}
      if (entry === 'generated' || entry === '__mocks__') {continue;}
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {walk(full);}
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {out.push(full);}
    }
  };
  for (const workspace of readdirSync(SUITE_ROOT)) {
    const src = join(SUITE_ROOT, workspace, 'src');
    if (workspace.startsWith('bconnect-') && existsSync(src)) {walk(src);}
  }
  const packages = join(SUITE_ROOT, 'packages');
  if (existsSync(packages)) {
    for (const pkg of readdirSync(packages)) {
      const src = join(packages, pkg, 'src');
      if (existsSync(src)) {walk(src);}
    }
  }
  return out;
}

/**
 * Strip comments, quote-aware.
 *
 * Needed rather than nice-to-have: `bconnect-jobs-mcp/src/index.ts` carries the
 * words `server.request()` inside a comment, and a naive scan would read it as
 * an unresolvable v1.1 call site and fail the suite over prose. Quote-aware
 * rather than line-based because `https://` inside a string literal is not the
 * start of a comment.
 */
function stripComments(source: string): string {
  let out = '';
  let mode: 'code' | 'line' | 'block' | '"' | "'" | '`' = 'code';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 1; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 1; continue; }
      if (c === '"' || c === "'" || c === '`') {mode = c;}
      out += c;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; i += 1; }
      continue;
    }
    // inside a string literal
    out += c;
    if (c === '\\') { out += source[i + 1] ?? ''; i += 1; continue; }
    if (c === mode) {mode = 'code';}
  }
  return out;
}

/** `const NAME = "literal"` declarations, per workspace, for resolving arguments. */
function stringConstantsByWorkspace(): Map<string, Map<string, string>> {
  const byWorkspace = new Map<string, Map<string, string>>();
  for (const file of everySourceFile()) {
    const workspace = relative(SUITE_ROOT, file).split(sep)[0];
    const map = byWorkspace.get(workspace) ?? new Map<string, string>();
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']+)["']/g)) {
      map.set(m[1], m[2]);
    }
    byWorkspace.set(workspace, map);
  }
  return byWorkspace;
}

interface CallSite {
  controller: string;
  file: string;
}

/**
 * Every v1.1 controller this suite requests, and where from.
 *
 * Scoped to files that name `V11Client`, which the first test proves is the
 * only door to v1.1. An argument that is neither a string literal nor a
 * resolvable constant is returned as `unresolved:<expression>` so the caller
 * fails on it rather than dropping it.
 */
function v11CallSites(): CallSite[] {
  const constants = stringConstantsByWorkspace();
  const sites: CallSite[] = [];
  for (const file of everySourceFile()) {
    const raw = readFileSync(file, 'utf8');
    if (!raw.includes('V11Client')) {continue;}
    const code = stripComments(raw);
    const workspace = relative(SUITE_ROOT, file).split(sep)[0];
    for (const m of code.matchAll(/\.request\s*\(\s*([^,)]*)/g)) {
      const arg = m[1].trim();
      const literal = /^["']([^"']+)["']$/.exec(arg);
      if (literal) {
        sites.push({ controller: literal[1], file: relative(SUITE_ROOT, file) });
        continue;
      }
      const resolved = /^[A-Za-z_$][\w$]*$/.test(arg)
        ? constants.get(workspace)?.get(arg)
        : undefined;
      sites.push({
        controller: resolved ?? `unresolved:${arg || '(empty)'}`,
        file: relative(SUITE_ROOT, file),
      });
    }
  }
  return sites;
}

// ─── The tools the suite actually advertises ─────────────────────────────────

const SERVERS: Record<string, () => Promise<{ createServer: () => { server: unknown } }>> = {
  activedirectory: () => import('../bconnect-activedirectory-mcp/src/index.js'),
  assets: () => import('../bconnect-assets-mcp/src/index.js'),
  compliance: () => import('../bconnect-compliance-mcp/src/index.js'),
  defensecontrol: () => import('../bconnect-defensecontrol-mcp/src/index.js'),
  endpoints: () => import('../bconnect-endpoints-mcp/src/index.js'),
  groups: () => import('../bconnect-groups-mcp/src/index.js'),
  jobs: () => import('../bconnect-jobs-mcp/src/index.js'),
  operatingsystems: () => import('../bconnect-operatingsystems-mcp/src/index.js'),
  servermanagement: () => import('../bconnect-servermanagement-mcp/src/index.js'),
  software: () => import('../bconnect-software-mcp/src/index.js'),
  universaldynamicgroups: () => import('../bconnect-universaldynamicgroups-mcp/src/index.js'),
  updatemanagement: () => import('../bconnect-updatemanagement-mcp/src/index.js'),
  variables: () => import('../bconnect-variables-mcp/src/index.js'),
};

interface AdvertisedTool { name: string; description?: string }

/**
 * Every advertised tool, with the write gate open and v1.1 as asked.
 *
 * Which tools are visible is a deployment choice, and a candidate named in the
 * audit table is a real answer whether or not the deployment reading it has
 * writes enabled — so the check is against the whole surface, as
 * `suite-tool-names.test.ts` does for the same reason. `v11` is a parameter
 * because toggling it is how the v1.1 tools are identified: they are exactly
 * the ones that appear when it is on.
 */
async function advertisedTools(v11: boolean): Promise<AdvertisedTool[]> {
  const keys = [
    'ALLOW_WRITE_OPERATIONS', 'BCONNECT_ENABLE_V11',
    'BCONNECT_V11_USERNAME', 'BCONNECT_V11_PASSWORD', 'VITEST',
  ] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  process.env.VITEST = '1';
  if (v11) {
    process.env.BCONNECT_ENABLE_V11 = 'true';
    process.env.BCONNECT_V11_USERNAME = 'audit-guard@example.invalid';
    process.env.BCONNECT_V11_PASSWORD = 'audit-guard';
  } else {
    delete process.env.BCONNECT_ENABLE_V11;
  }
  const tools: AdvertisedTool[] = [];
  try {
    for (const load of Object.values(SERVERS)) {
      const mod = await load();
      const { server } = mod.createServer();
      const handler = (
        server as {
          _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: AdvertisedTool[] }>>;
        }
      )._requestHandlers.get('tools/list');
      const result = await handler?.({ method: 'tools/list' });
      for (const tool of result?.tools ?? []) {tools.push(tool);}
    }
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) {delete process.env[k];}
      else {process.env[k] = saved[k] as string;}
    }
  }
  return tools;
}

const advertisedToolNames = async (): Promise<Set<string>> =>
  new Set((await advertisedTools(true)).map((t) => t.name));

/**
 * Tokens in a description that are shaped like a reference to another tool.
 *
 * Every tool in this suite is named `<verb>_<noun…>` in snake_case, so a
 * lowercase snake_case token opening with one of those verbs is a tool
 * reference and nothing else. Deliberately not a general word match: the
 * descriptions also carry env var names (`BCONNECT_ENABLE_V11`), WMI classes
 * (`Win32_BIOS`) and field names, none of which start lowercase with a verb.
 */
const TOOL_REFERENCE = new RegExp(
  '\\b(?:get|list|create|update|delete|assign|start|stop|resume|withdraw|preview|' +
    'diagnose|explain|refresh|patch|link|unlink|trigger|simulate|cancel|restart|add|replace)' +
    '_[a-z0-9]+(?:_[a-z0-9]+)*\\b',
  'g'
);

// ─── The guard ───────────────────────────────────────────────────────────────

/** The row table: one row per v1.1 controller the suite requests. */
function callTable(markdown: string): Table {
  return tableWithColumns(markdown, ['controller', 'v2.0 equivalent', 'verdict', 'checked against']);
}

/** The vocabulary table, whose first column defines the legal verdicts. */
function verdictVocabulary(markdown: string): Set<string> {
  const table = tableWithColumns(markdown, ['verdict', 'means', 'remedy']);
  const column = columnNamed(table, 'verdict');
  const words = table.rows.flatMap((r) => ticked(r[column]));
  expect(
    words.length,
    'The verdict-definition table must define at least two verdicts in backticks. This guard ' +
      'reads the vocabulary out of the document rather than hardcoding it, so that renaming a ' +
      'verdict is one edit — but an empty vocabulary would make the verdict column unenforced.'
  ).toBeGreaterThan(1);
  return new Set(words);
}

describe('V11-AUDIT.md is complete, and still true of the code', () => {
  it('only one file constructs the v1.1 root, so scanning for V11Client cannot miss a call', () => {
    const builders = everySourceFile().filter((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      // The root as it is BUILT — a string concatenation ending in the v1.1
      // segment — not the many places the path is merely described in prose.
      return /["'`]\/?bConnect\/v1\.1["'`]/i.test(code);
    });
    expect(
      builders.map((f) => relative(SUITE_ROOT, f)),
      'Exactly one file may construct the /bConnect/v1.1 root. That is what makes "scan the ' +
        'files naming V11Client" a COMPLETE way to find every v1.1 call site — a second ' +
        'builder is a v1.1 request this audit guard would never see.'
    ).toEqual([join('packages', 'mcp-core', 'src', 'v11-client.ts')]);
  });

  it('resolves every v1.1 controller argument to a literal', () => {
    const unresolved = v11CallSites().filter((s) => s.controller.startsWith('unresolved:'));
    expect(
      unresolved,
      'A v1.1 call names its controller with an expression this guard cannot resolve to a ' +
        'string. It fails rather than skipping: a call site the guard cannot read must not ' +
        'report the same colour as one it read and found a row for. Either use a string ' +
        'literal or a `const NAME = "Controller"` in the same workspace.'
    ).toEqual([]);
  });

  it('has a row for every v1.1 call site in the suite', () => {
    const table = callTable(readAudit());
    const column = columnNamed(table, 'controller');
    const documented = new Set(table.rows.flatMap((r) => ticked(r[column])));
    const called = v11CallSites();
    const undocumented = [...new Set(called.map((s) => s.controller))]
      .filter((c) => !documented.has(c))
      .map((c) => `${c} (called from ${called.find((s) => s.controller === c)?.file})`);
    expect(
      undocumented,
      'A bConnect v1.1 controller is requested by this suite and has no row in V11-AUDIT.md. ' +
        'Every v1.1 call carries a domain account’s own bMS rights, so each one needs its ' +
        'recorded justification: the v2.0 tool that would answer the same question, whether it ' +
        'actually does, and the bMS version that was checked. Establish it with a LIVE CALL, ' +
        'never from the v1.1 PDF — building from that document is how /MobileDeviceRules and ' +
        '/Pin shipped as routes that do not exist. V11-AUDIT.md names the probe that does it ' +
        '(working repository only; scripts/v11 is not published).'
    ).toEqual([]);
  });

  it('has no row for a controller the suite no longer calls', () => {
    const table = callTable(readAudit());
    const column = columnNamed(table, 'controller');
    const called = new Set(v11CallSites().map((s) => s.controller));
    const stale = table.rows
      .flatMap((r) => ticked(r[column]))
      .filter((c) => !called.has(c));
    expect(
      stale,
      'V11-AUDIT.md has a row for a v1.1 controller nothing in the suite requests any more. ' +
        'The rule the document states is that the row is deleted when the call moves — a row ' +
        'kept past its call makes the table look larger, and the next reader re-checks a gap ' +
        'that no longer costs anything.'
    ).toEqual([]);
  });

  it('every row names a v2.0 candidate or says explicitly that there is none', () => {
    const table = callTable(readAudit());
    const controllerColumn = columnNamed(table, 'controller');
    const candidateColumn = columnNamed(table, 'v2.0 equivalent');
    const offenders = table.rows
      .filter((row) => {
        const cell = row[candidateColumn] ?? '';
        const named = ticked(cell).length > 0;
        const explicitlyNone = /no\s+v2\.0\s+candidate/i.test(cell);
        // Exactly one of the two. A cell that both names a tool and declares
        // no candidate says two incompatible things.
        return named === explicitlyNone;
      })
      .map((row) => `${ticked(row[controllerColumn])[0] ?? '(unnamed)'}: "${row[candidateColumn]}"`);
    expect(
      offenders,
      'Each row must either name the v2.0 tool that would answer the same question, in ' +
        'backticks, or state "no v2.0 candidate". An empty cell reads as "not looked at" and ' +
        '"looked at, nothing there" at the same time, and those are the two states this ' +
        'document exists to tell apart.'
    ).toEqual([]);
  });

  // Among the three slowest tests in the suite (~1.6 s over three dedicated
  // full-suite runs) and the one that turned a gate RED at 5,300 ms when the
  // box was busy. It carried a local 30 s pin; the pin is now the GLOBAL
  // default in vitest.shared.ts, because the 3.26x multiplier that broke it is
  // a property of the host and applies to every test equally. Left unpinned
  // here deliberately — two sources for one number is the thing that rots.
  it('every named v2.0 candidate is a tool the suite actually advertises', async () => {
    const table = callTable(readAudit());
    const controllerColumn = columnNamed(table, 'controller');
    const candidateColumn = columnNamed(table, 'v2.0 equivalent');
    const advertised = await advertisedToolNames();
    const missing: string[] = [];
    for (const row of table.rows) {
      for (const name of ticked(row[candidateColumn] ?? '')) {
        if (!advertised.has(name)) {
          missing.push(`${ticked(row[controllerColumn])[0] ?? '(unnamed)'} -> ${name}`);
        }
      }
    }
    expect(
      missing,
      'A v2.0 tool named as the equivalent for a v1.1 call is not advertised by any server in ' +
        'this suite. This is the /MobileDeviceRules failure transposed: a name that exists in ' +
        'a document and not in the API. Either the tool was renamed — update the row — or the ' +
        'candidate was written down without being called.'
    ).toEqual([]);
  });

  // Same cause, next slowest in the file: 3.2 s under load on the run that
  // failed its sibling. Also relies on the global timeout now.
  it('every tool a v1.1 description points at is a tool that exists', async () => {
    // Row 1 of the audit is why this is here. `get_endpoint_registry_inventory`
    // shipped claiming it listed products "the standard software inventory may
    // not list", which measurement refuted — v2.0 covered all of them and more.
    // The corrected description does the honest thing and points the caller at
    // `list_installed_software_by_endpoint` instead. That pointer is now the
    // tool's reason to be narrow, and a pointer at a renamed or deleted tool is
    // worse than none: it sends a model somewhere that does not answer.
    //
    // Scoped to the v1.1 descriptions because this file is the v1.1 audit's
    // guard. The property generalises to all 221 descriptions and is worth
    // applying there, but that is a different change with a different blast
    // radius.
    const withV11 = await advertisedTools(true);
    const withoutV11 = new Set((await advertisedTools(false)).map((t) => t.name));
    const advertised = new Set(withV11.map((t) => t.name));
    const v11Tools = withV11.filter((t) => !withoutV11.has(t.name));

    expect(
      v11Tools.length,
      'No tool appeared when the v1.1 gate was opened, so this check examined nothing. ' +
        'Either the gate stopped working or the v1.1 slice is gone — both need looking at.'
    ).toBeGreaterThan(0);

    const dangling: string[] = [];
    for (const tool of v11Tools) {
      for (const referenced of String(tool.description ?? '').match(TOOL_REFERENCE) ?? []) {
        if (referenced !== tool.name && !advertised.has(referenced)) {
          dangling.push(`${tool.name} -> ${referenced}`);
        }
      }
    }
    expect(
      dangling,
      'A bConnect v1.1 tool description names another tool that this suite does not advertise. ' +
        'These descriptions are how a model chooses between the v1.1 call and its cheaper v2.0 ' +
        'equivalent, so a dangling pointer does not merely fail to help — it routes the caller ' +
        'to a tool that is not there. Update the description, or restore the tool.'
    ).toEqual([]);
  });

  it('every row carries a verdict the document itself defines', () => {
    const audit = readAudit();
    const table = callTable(audit);
    const vocabulary = verdictVocabulary(audit);
    const controllerColumn = columnNamed(table, 'controller');
    const verdictColumn = columnNamed(table, 'verdict');
    const offenders = table.rows
      .filter((row) => {
        const words = ticked(row[verdictColumn] ?? '');
        return words.length !== 1 || !vocabulary.has(words[0]);
      })
      .map((row) => `${ticked(row[controllerColumn])[0] ?? '(unnamed)'}: "${row[verdictColumn]}"`);
    expect(
      offenders,
      `Each row needs exactly one verdict, in backticks, from the vocabulary the document ` +
        `defines (${[...vocabulary].join(', ')}). "No tool exists" and "the tool exists and ` +
        'drops a field" are different remedies — one is a request to the vendor, the other is a ' +
        'call that can be deleted — and a free-text column lets them be flattened into one.'
    ).toEqual([]);
  });

  it('every row records the bMS version it was checked against', () => {
    const table = callTable(readAudit());
    const controllerColumn = columnNamed(table, 'controller');
    const versionColumn = columnNamed(table, 'checked against');
    const offenders = table.rows
      .filter((row) => !/\b\d+\.\d+\.\d+(\.\d+)?\b/.test(row[versionColumn] ?? ''))
      .map((row) => `${ticked(row[controllerColumn])[0] ?? '(unnamed)'}: "${row[versionColumn]}"`);
    expect(
      offenders,
      'Each row must record the bMS version its answer is a fact about — a dotted version, as ' +
        'get_management_server reports it. A gap is a fact about a release, not about the ' +
        'product: without the version, a row cannot be re-checked and cannot be retired when ' +
        'the release that closes it ships.'
    ).toEqual([]);
  });
});
