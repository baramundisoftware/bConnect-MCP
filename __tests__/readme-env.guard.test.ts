/**
 * README environment guard (REQ-SRV-019 AC 4).
 *
 * Each server's README (and the template's) documents exactly the environment
 * variables that server reads: its own `src/` plus `@bconnect/mcp-core`, found
 * with the TypeScript parser. The list sits between markers:
 *
 *   <!-- env:start --> … a table, one `VARIABLE` per row … <!-- env:end -->
 *
 * The check fails when the list misses a variable that is read or lists one
 * nobody reads, and when the README mentions a variable anywhere (quick start,
 * examples) that the server doesn't read.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SERVERS } from './lib/exerciser.js';
import { envReads } from './lib/env-reads.js';

const CORE_SRC = join(ROOT, 'packages', 'mcp-core', 'src');

/**
 * Read by the code, but not configuration an operator sets, and only in the one place
 * given: the test runner (and the gateway's preload) set VITEST so a server's main()
 * doesn't run on import. Anywhere else the read is reported, because the gateway sets
 * VITEST in production and a VITEST switch would be live there.
 */
const NOT_CONFIGURATION: Record<string, { reason: string; allowedAt: RegExp; allowedBody: RegExp }> = {
  VITEST: {
    reason: 'set by the test runner and the gateway preload so a server does not start on import',
    allowedAt: /^\s*if \((?:!process\.env\.VITEST|process\.env\.VITEST === undefined)\) \{$/,
    // The guarded block only starts the server: the core's runServer() (REQ-SRV-023), or
    // a main() that reports a fatal error.
    allowedBody:
      /^(?:void startServer\(entry\);|main\(\)\.catch\(\((\w+)\) => \{ (?:console\.error\("Fatal error:", \1\)|process\.stderr\.write\(`Fatal error: \$\{\1\.message\}\\n`\)); process\.exit\(1\); \}\);)$/,
  },
};

const START = '<!-- env:start -->';
const END = '<!-- env:end -->';

/** An environment variable name as READMEs write it: upper case, at least one underscore. */
const VARIABLE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

const sourceFiles = (dirPath: string): string[] =>
  readdirSync(dirPath, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.[mc]?ts$/.test(e.name) && !/\.d\.[mc]?ts$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/[\\/](__tests__|__mocks__)[\\/]/.test(f));

/** Whether line `at` opens a block matching `allowedAt` whose body matches `allowedBody`. */
function isEntryGuard(lines: string[], at: number, exempt: { allowedAt: RegExp; allowedBody: RegExp }): boolean {
  if (!exempt.allowedAt.test(lines[at] ?? '')) return false;
  // The block ends at the first `}` indented like the `if`.
  const indent = /^\s*/.exec(lines[at] ?? '')?.[0] ?? '';
  const end = lines.findIndex((line, i) => i > at && line === `${indent}}`);
  // No else: it would run exactly where VITEST is set (tests, and the gateway in production).
  if (end < 0 || /^\s*else\b/.test(lines[end + 1] ?? '')) return false;
  const body = lines.slice(at + 1, end).map((l) => l.trim()).join(' ');
  return exempt.allowedBody.test(body);
}

/** Where the entry guard may live: a server's index.ts, or the core's runServer() (REQ-SRV-023). */
const ENTRY_FILES = (file: string): boolean =>
  basename(file) === 'index.ts' || file === join(CORE_SRC, 'server-runtime.ts');

/** Variables read by the given source directories; hidden reads are returned separately. */
function variablesRead(dirs: string[]): { names: Set<string>; hidden: string[] } {
  const names = new Set<string>();
  const hidden: string[] = [];
  for (const file of dirs.flatMap(sourceFiles)) {
    const source = readFileSync(file, 'utf8');
    const lines = lf(source).split('\n');
    for (const read of envReads(source, file)) {
      const where = `${relative(ROOT, file)}:${read.line} ${read.text}`;
      const exempt = read.name !== null ? NOT_CONFIGURATION[read.name] : undefined;
      if (read.name === null) hidden.push(where);
      else if (!exempt) names.add(read.name);
      else if (!(ENTRY_FILES(file) && isEntryGuard(lines, read.line - 1, exempt))) {
        hidden.push(`${where} (${read.name} is allowed only as the entry guard)`);
      }
    }
  }
  return { names, hidden };
}

/** The variables listed in the README's marked block, or `null` when the block is missing. */
/** Windows checkouts have CRLF line endings; parse everything as LF. */
const lf = (text: string): string => text.replace(/\r\n?/g, '\n');

/**
 * `text` without HTML comments, as a reader of the rendered page sees it: each `<!--`
 * runs to the first `-->` after it, an unclosed one to the end. The output is never
 * scanned again, so text around a removed comment can't form a new one.
 */
function withoutComments(text: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    if (open < 0) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf('-->', open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

/** The table rows of the README's marked block as a reader sees them, or `null` when the block is missing. */
function blockRows(original: string): string[] | null {
  const readme = lf(original);
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) return null;
  // What a reader of the rendered README sees: no HTML comments, no fenced code.
  const block = withoutComments(readme.slice(start + START.length, end))
    // A fence may be indented up to three spaces and closes with the same character,
    // at least as long; an unclosed fence runs to the end.
    .replace(/^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|$(?![\s\S]))/gm, '');
  // A table row starts with | after at most three spaces; four or more make it code.
  return block.split('\n').filter((line) => /^ {0,3}\|/.test(line));
}

function listedVariables(original: string): string[] | null {
  const rows = blockRows(original);
  if (rows === null) return null;
  // `NAME`, or `NAME` linked to the configuration guide (REQ-DOC-001).
  return rows
    .map((row) => /^\s*\|\s*\[?`([A-Z][A-Z0-9_]*)`/.exec(row)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** The block's header row (REQ-DOC-001): the description is in the guide, the README says only what differs here. */
const FORM_HEADER = '| Variable | In this server |';
/** A remark says what is different in this server; the description itself is in the guide. */
const REMARK_MAX = 160;

/**
 * Rows of the block that aren't in the form REQ-DOC-001 sets: the header, the separator, then one
 * row per variable, `| [\`NAME\`](../docs/CONFIGURATION.md#name) | remark |`, the remark short or empty.
 */
function rowFormProblems(original: string): string[] {
  const rows = blockRows(original);
  if (rows === null) return ['no block'];
  const [header, separator, ...data] = rows.map((r) => r.trim());
  const problems: string[] = [];
  if (header !== FORM_HEADER) problems.push(`header: ${header ?? '-'}`);
  if (!/^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/.test(separator ?? '')) problems.push(`separator: ${separator ?? '-'}`);
  for (const row of data) {
    const m = /^\| \[`([A-Z][A-Z0-9_]*)`\]\(\.\.\/docs\/CONFIGURATION\.md#([a-z0-9_]+)\) \|(.*)\|$/.exec(row);
    if (!m) {
      problems.push(`row: ${row}`);
      continue;
    }
    const [, name, anchor, remark] = m;
    if (anchor !== name.toLowerCase()) problems.push(`anchor: ${name} → #${anchor}`);
    if (remark.includes('|')) problems.push(`cells: ${name}`);
    if (remark.trim().length > REMARK_MAX) problems.push(`remark too long: ${name} (${remark.trim().length})`);
  }
  return problems;
}

/** The remark of one variable in the block, '' when it has none, undefined when it isn't listed. */
function remarkOf(original: string, name: string): string | undefined {
  const row = (blockRows(original) ?? []).find((r) => r.includes(`[\`${name}\`]`));
  return row === undefined ? undefined : row.trim().split('|').slice(2, -1).join('|').trim();
}

/** Every variable name the README mentions, anywhere. */
const mentionedVariables = (readme: string): Set<string> => new Set(readme.match(VARIABLE) ?? []);

interface Mismatch {
  missingBlock: boolean;
  /** Listed more than once (e.g. with different defaults). */
  duplicated: string[];
  /** Read by the code but not in the list. */
  undocumented: string[];
  /** In the list but read by nobody. */
  unread: string[];
  /** Mentioned anywhere in the README but read by nobody. */
  mentionedUnread: string[];
}

function compare(readme: string, read: Set<string>): Mismatch {
  const rows = listedVariables(readme);
  const listed = rows === null ? null : new Set(rows);
  const sorted = (xs: Iterable<string>) => [...xs].sort();
  return {
    missingBlock: listed === null,
    duplicated: sorted(new Set((rows ?? []).filter((v, i, all) => all.indexOf(v) !== i))),
    undocumented: sorted([...read].filter((v) => !listed?.has(v))),
    unread: sorted([...(listed ?? [])].filter((v) => !read.has(v))),
    mentionedUnread: sorted([...mentionedVariables(readme)].filter((v) => !read.has(v))),
  };
}

const CLEAN: Mismatch = { missingBlock: false, duplicated: [], undocumented: [], unread: [], mentionedUnread: [] };

/** Everything wrong with one package: README mismatches plus reads the guard can't name. */
function checkPackage(sourceDirs: string[], readme: string): Mismatch & { hidden: string[] } {
  const { names, hidden } = variablesRead(sourceDirs);
  return { ...compare(readme, names), hidden };
}

/** Fails unless the package's README and code agree and no read is hidden. */
function assertPackageClean(sourceDirs: string[], readme: string): void {
  expect(checkPackage(sourceDirs, readme)).toEqual({ ...CLEAN, hidden: [] });
}

const PACKAGES = [...SERVERS, 'bconnect-server-template'].filter((d) => existsSync(join(ROOT, d, 'src')));

describe('row form self-tests (REQ-DOC-001)', () => {
  const block = (rows: string[]) => [START, FORM_HEADER, '|---|---|', ...rows, END].join('\n');
  const row = (name: string, remark = '') => `| [\`${name}\`](../docs/CONFIGURATION.md#${name.toLowerCase()}) | ${remark} |`;

  it('accepts names linked to their guide anchor, with or without a short remark', () => {
    expect(rowFormProblems(block([row('BCONNECT_BASE_URL'), row('ALLOW_SECRET_READ', 'No effect: no tool here returns secrets.')]))).toEqual([]);
    expect(listedVariables(block([row('BCONNECT_BASE_URL')]))).toEqual(['BCONNECT_BASE_URL']);
    expect(remarkOf(block([row('ALLOW_SECRET_READ', 'No effect.')]), 'ALLOW_SECRET_READ')).toBe('No effect.');
    expect(remarkOf(block([row('MCP_PORT')]), 'MCP_PORT')).toBe('');
  });

  it('reports the old four-column table, a wrong anchor, an unlinked name and a long remark', () => {
    const old = [START, '| Variable | Required | Default | Description |', '|---|---|---|---|', '| `MCP_PORT` | No | 3000 | Port |', END].join('\n');
    expect(rowFormProblems(old)).toEqual(expect.arrayContaining([expect.stringContaining('header'), expect.stringContaining('row: | `MCP_PORT`')]));
    expect(rowFormProblems(block(['| [`MCP_PORT`](../docs/CONFIGURATION.md#mcp_bind) |  |']))).toEqual(['anchor: MCP_PORT → #mcp_bind']);
    expect(rowFormProblems(block(['| `MCP_PORT` |  |']))).toEqual(['row: | `MCP_PORT` |  |']);
    expect(rowFormProblems(block([row('MCP_PORT', 'x'.repeat(REMARK_MAX + 1))]))).toEqual([`remark too long: MCP_PORT (${REMARK_MAX + 1})`]);
    expect(rowFormProblems(block([row('MCP_PORT', 'a | b')]))).toEqual(['cells: MCP_PORT']);
  });
});

describe('guard self-tests', () => {
  const read = new Set(['BCONNECT_BASE_URL', 'ALLOW_WRITE_OPERATIONS']);
  const readme = (rows: string[], extra = '') =>
    [
      '# Server',
      extra,
      '## Environment variables',
      START,
      '| Variable | Required | Default | Description |',
      '|---|---|---|---|',
      ...rows,
      END,
    ].join('\n');
  const BASE = '| `BCONNECT_BASE_URL` | Yes | — | URL |';
  const WRITES = '| `ALLOW_WRITE_OPERATIONS` | No | off | writes |';

  it('accepts a README that lists exactly what is read', () => {
    expect(compare(readme([BASE, WRITES]), read)).toEqual(CLEAN);
  });

  it('reports a variable that is read but not listed', () => {
    expect(compare(readme([BASE]), read).undocumented).toEqual(['ALLOW_WRITE_OPERATIONS']);
  });

  it('reports a listed variable nobody reads', () => {
    const result = compare(readme([BASE, WRITES, '| `BCONNECT_REJECT_UNAUTHORIZED` | No | true | TLS |']), read);
    expect(result.unread).toEqual(['BCONNECT_REJECT_UNAUTHORIZED']);
  });

  it('reports a variable mentioned outside the list that nobody reads', () => {
    const result = compare(readme([BASE, WRITES], '```env\nAUDIT_LOG_LEVEL=write\n```'), read);
    expect(result.mentionedUnread).toEqual(['AUDIT_LOG_LEVEL']);
    expect(result.unread).toEqual([]);
  });

  it('reports a missing block, with every read variable undocumented', () => {
    const result = compare('# Server\n| `BCONNECT_BASE_URL` | Yes | — | URL |', read);
    expect(result.missingBlock).toBe(true);
    expect(result.undocumented).toEqual(['ALLOW_WRITE_OPERATIONS', 'BCONNECT_BASE_URL']);
  });

  it.each([
    ['an HTML comment', ['<!--', WRITES, '-->']],
    ['a fenced code block', ['```', WRITES, '```']],
    ['an unclosed code fence', ['```', WRITES]],
    ['an indented code block', [`    ${WRITES}`]],
    ['a fence indented two spaces', ['  ```', WRITES, '  ```']],
    ['an unclosed HTML comment', ['<!--', WRITES]],
    ['a comment that opens inside a broken one', ['<!-<!-- x -->', '<!--', WRITES, '-->']],
    ['a four-backtick fence holding a three-backtick line', ['````', '```', WRITES, '````']],
    ['a tilde fence', ['~~~', WRITES, '~~~']],
  ])('ignores a row hidden in %s inside the block', (_label, hiddenRows) => {
    expect(compare(readme([BASE, ...hiddenRows]), read).undocumented).toEqual(['ALLOW_WRITE_OPERATIONS']);
  });

  it('reads a README with Windows line endings (CRLF) like one with LF', () => {
    const crlf = (text: string) => text.replace(/\n/g, '\r\n');
    expect(compare(crlf(readme([BASE, WRITES])), read)).toEqual(CLEAN);
    expect(compare(crlf(readme([BASE, '```', WRITES, '```'])), read).undocumented).toEqual(['ALLOW_WRITE_OPERATIONS']);
  });

  it('keeps a row after a closed comment, as a reader sees it', () => {
    expect(compare(readme([BASE, '<!-- note -->', WRITES]), read)).toEqual(CLEAN);
  });

  it('reports a variable listed twice', () => {
    const result = compare(readme([BASE, WRITES, '| `ALLOW_WRITE_OPERATIONS` | No | on | writes |']), read);
    expect(result.duplicated).toEqual(['ALLOW_WRITE_OPERATIONS']);
  });

  it('ignores table rows outside the block', () => {
    const result = compare(readme([BASE], `| \`ALLOW_WRITE_OPERATIONS\` | No | off | writes |`), read);
    expect(result.undocumented).toEqual(['ALLOW_WRITE_OPERATIONS']);
  });

  it('derives the variables the core reads', () => {
    const { names, hidden } = variablesRead([CORE_SRC]);
    expect(hidden).toEqual([]);
    for (const name of ['BCONNECT_BASE_URL', 'BCONNECT_CA_CERT_PATH', 'NODE_TLS_REJECT_UNAUTHORIZED', 'ALLOW_SECRET_READ']) {
      expect(names).toContain(name);
    }
    expect(names).not.toContain('BCONNECT_REJECT_UNAUTHORIZED');
  });

  it('leaves out test-only variables, each with a reason', () => {
    const { names, hidden } = variablesRead([join(ROOT, 'bconnect-groups-mcp', 'src')]);
    expect(names).not.toContain('VITEST');
    expect(hidden).toEqual([]);
    for (const { reason } of Object.values(NOT_CONFIGURATION)) expect(reason.length).toBeGreaterThan(10);
  });

  describe('source fixtures', () => {
    const ENTRY = [
      'if (!process.env.VITEST) {',
      '  main().catch((err) => {',
      '    console.error("Fatal error:", err);',
      '    process.exit(1);',
      '  });',
      '}',
      '',
    ].join('\n');
    const scan = (files: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), 'readme-env-'));
      try {
        for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
        return variablesRead([dir]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it('reports a hidden read', () => {
      expect(scan({ 'a.ts': 'const e = process.env; e.BCONNECT_CA_CERT_PATH;' }).hidden).toHaveLength(1);
    });

    it('fails a package whose README matches but whose code hides a read', () => {
      const dir = mkdtempSync(join(tmpdir(), 'readme-env-'));
      try {
        writeFileSync(join(dir, 'a.ts'), 'process.env.MCP_PORT; const e = process.env; e.BCONNECT_CA_CERT_PATH;');
        const readme = `${START}\n| \`MCP_PORT\` | No | 3000 | port |\n${END}`;
        const result = checkPackage([dir], readme);
        expect({ ...result, hidden: [] }).toEqual({ ...CLEAN, hidden: [] });
        expect(result.hidden).toHaveLength(1);
        expect(() => assertPackageClean([dir], readme)).toThrow();
        writeFileSync(join(dir, 'a.ts'), 'process.env.MCP_PORT;');
        expect(() => assertPackageClean([dir], readme)).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('accepts VITEST as the main() entry guard of index.ts', () => {
      const result = scan({ 'index.ts': ENTRY });
      expect(result).toEqual({ names: new Set(), hidden: [] });
    });

    it('accepts the entry guard with Windows line endings (CRLF)', () => {
      const result = scan({ 'index.ts': ENTRY.replace(/\n/g, '\r\n') });
      expect(result).toEqual({ names: new Set(), hidden: [] });
    });

    it.each([
      ['as a switch in other code', 'index.ts', 'const gate = process.env.VITEST ? "off" : "on";'],
      ['outside index.ts', 'helper.ts', ENTRY],
      ['in a file whose name only ends in index.ts', 'xindex.ts', ENTRY],
      ['as an entry guard whose body does more', 'index.ts', ENTRY.replace('process.exit(1);', 'process.exit(1);\n    disableGates();')],
      ['as an entry guard with an else', 'index.ts', `${ENTRY.trimEnd()}\nelse {\n  disableGates();\n}\n`],
    ])('reports VITEST used %s', (_label, name, text) => {
      expect(scan({ [name]: text }).hidden).toEqual([expect.stringContaining('allowed only as the entry guard')]);
    });

    it('scans generated code, which is compiled into the build', () => {
      const dir = mkdtempSync(join(tmpdir(), 'readme-env-'));
      try {
        mkdirSync(join(dir, 'generated'));
        writeFileSync(join(dir, 'generated', 'g.ts'), 'process.env.MCP_PORT;');
        expect(variablesRead([dir]).names).toEqual(new Set(['MCP_PORT']));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('scans .mts and .cts files', () => {
      expect(scan({ 'a.mts': 'process.env.MCP_PORT;', 'b.cts': 'process.env.MCP_BIND;' }).names).toEqual(
        new Set(['MCP_PORT', 'MCP_BIND']),
      );
    });
  });

  it('finds every server and the template', () => {
    expect(PACKAGES.length).toBeGreaterThanOrEqual(14);
    expect(PACKAGES).toContain('bconnect-server-template');
  });
});

describe.each(PACKAGES)('%s README', (pkg) => {
  const path = join(ROOT, pkg, 'README.md');
  const readme = (): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

  it('documents exactly the environment variables the server reads', () => {
    expect.assertions(1);
    assertPackageClean([join(ROOT, pkg, 'src'), CORE_SRC], readme());
  });

  it('links each one to the configuration guide and adds only what differs here (REQ-DOC-001)', () => {
    expect(rowFormProblems(readme())).toEqual([]);
  });
});

/**
 * The remarks that state a real per-server fact, derived from the code rather than written by hand
 * (REQ-DOC-001): where ALLOW_SECRET_READ does nothing, and what the release changes for the server.
 */
describe.each(SERVERS)('%s README remarks', (server) => {
  const readme = (): string => readFileSync(join(ROOT, server, 'README.md'), 'utf8');
  const domain = server.replace(/^bconnect-|-mcp$/g, '');

  it('says ALLOW_SECRET_READ has no effect exactly where no tool returns secrets', async () => {
    const { SECRET_ROUTES } = await import('../packages/mcp-core/src/secret-routes.js');
    const hasSecrets = SECRET_ROUTES.some((r: { domain: string }) => r.domain === domain);
    const remark = remarkOf(readme(), 'ALLOW_SECRET_READ') ?? '';
    expect(remark.startsWith('No effect'), remark).toBe(!hasSecrets);
    // Where secrets can be read, the remark says what the setting enables there.
    if (hasSecrets) expect(remark.length).toBeGreaterThan(20);
  });

  it('says what the release changes: marked tools, or that the server stops on 25R2', async () => {
    const { TOOL_RELEASES } = await import(pathToFileURL(join(ROOT, server, 'src', 'tool-releases.ts')).href);
    const rows: string[][] = Object.values(TOOL_RELEASES);
    const remark = remarkOf(readme(), 'BCONNECT_RELEASE') ?? '';
    const text = readme().slice(0, readme().indexOf(START));
    if (!rows.some((r) => r.includes('25R2'))) {
      expect(remark).toContain('stops at startup');
      return;
    }
    expect(remark.includes('**(26R1)**'), remark).toBe(text.includes('**(26R1)**'));
    expect(remark.includes('**(25R2)**'), remark).toBe(text.includes('**(25R2)**'));
  });
});
