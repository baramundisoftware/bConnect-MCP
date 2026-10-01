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
    reason: 'set by the test runner and the gateway preload so main() does not run on import',
    allowedAt: /^if \((?:!process\.env\.VITEST|process\.env\.VITEST === undefined)\) \{$/,
    // The guarded block only starts main() and reports a fatal error.
    allowedBody:
      /^main\(\)\.catch\(\((\w+)\) => \{ (?:console\.error\("Fatal error:", \1\)|process\.stderr\.write\(`Fatal error: \$\{\1\.message\}\\n`\)); process\.exit\(1\); \}\);$/,
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

/** Whether line `at` opens a top-level block matching `allowedAt` whose body matches `allowedBody`. */
function isEntryGuard(lines: string[], at: number, exempt: { allowedAt: RegExp; allowedBody: RegExp }): boolean {
  if (!exempt.allowedAt.test(lines[at] ?? '')) return false;
  const end = lines.findIndex((line, i) => i > at && line === '}');
  // No else: it would run exactly where VITEST is set (tests, and the gateway in production).
  if (end < 0 || /^\s*else\b/.test(lines[end + 1] ?? '')) return false;
  const body = lines.slice(at + 1, end).map((l) => l.trim()).join(' ');
  return exempt.allowedBody.test(body);
}

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
      else if (!(basename(file) === 'index.ts' && isEntryGuard(lines, read.line - 1, exempt))) {
        hidden.push(`${where} (${read.name} is allowed only as the main() entry guard)`);
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

function listedVariables(original: string): string[] | null {
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
  const rows = block.split('\n').filter((line) => /^ {0,3}\|/.test(line));
  const names = rows
    .map((row) => /^\s*\|\s*`([A-Z][A-Z0-9_]*)`/.exec(row)?.[1])
    .filter((name): name is string => name !== undefined);
  return names;
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
      expect(scan({ [name]: text }).hidden).toEqual([expect.stringContaining('main() entry guard')]);
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
  it('documents exactly the environment variables the server reads', () => {
    const path = join(ROOT, pkg, 'README.md');
    const readme = existsSync(path) ? readFileSync(path, 'utf8') : '';
    expect.assertions(1);
    assertPackageClean([join(ROOT, pkg, 'src'), CORE_SRC], readme);
  });
});
