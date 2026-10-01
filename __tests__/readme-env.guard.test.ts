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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVERS } from './lib/exerciser.js';
import { envReads } from './lib/env-reads.js';

const CORE_SRC = join(ROOT, 'packages', 'mcp-core', 'src');

/** Read by the code, but not configuration an operator sets. */
const NOT_CONFIGURATION: Record<string, string> = {
  VITEST: 'set by the test runner; servers skip main() under test',
};

const START = '<!-- env:start -->';
const END = '<!-- env:end -->';

/** An environment variable name as READMEs write it: upper case, at least one underscore. */
const VARIABLE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

const sourceFiles = (dirPath: string): string[] =>
  readdirSync(dirPath, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/[\\/](__tests__|__mocks__|generated)[\\/]/.test(f));

/** Variables read by the given source directories; hidden reads are returned separately. */
function variablesRead(dirs: string[]): { names: Set<string>; hidden: string[] } {
  const names = new Set<string>();
  const hidden: string[] = [];
  for (const file of dirs.flatMap(sourceFiles)) {
    for (const read of envReads(readFileSync(file, 'utf8'), file)) {
      if (read.name === null) hidden.push(`${file.slice(ROOT.length + 1)}:${read.line} ${read.text}`);
      else if (!(read.name in NOT_CONFIGURATION)) names.add(read.name);
    }
  }
  return { names, hidden };
}

/** The variables listed in the README's marked block, or `null` when the block is missing. */
function listedVariables(readme: string): Set<string> | null {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) return null;
  const block = readme.slice(start + START.length, end);
  const rows = block.split('\n').filter((line) => line.trimStart().startsWith('|'));
  const names = rows
    .map((row) => /^\s*\|\s*`([A-Z][A-Z0-9_]*)`/.exec(row)?.[1])
    .filter((name): name is string => name !== undefined);
  return new Set(names);
}

/** Every variable name the README mentions, anywhere. */
const mentionedVariables = (readme: string): Set<string> => new Set(readme.match(VARIABLE) ?? []);

interface Mismatch {
  missingBlock: boolean;
  /** Read by the code but not in the list. */
  undocumented: string[];
  /** In the list but read by nobody. */
  unread: string[];
  /** Mentioned anywhere in the README but read by nobody. */
  mentionedUnread: string[];
}

function compare(readme: string, read: Set<string>): Mismatch {
  const listed = listedVariables(readme);
  const sorted = (xs: Iterable<string>) => [...xs].sort();
  return {
    missingBlock: listed === null,
    undocumented: sorted([...read].filter((v) => !listed?.has(v))),
    unread: sorted([...(listed ?? [])].filter((v) => !read.has(v))),
    mentionedUnread: sorted([...mentionedVariables(readme)].filter((v) => !read.has(v))),
  };
}

const CLEAN: Mismatch = { missingBlock: false, undocumented: [], unread: [], mentionedUnread: [] };

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
    const { names } = variablesRead([join(ROOT, 'bconnect-groups-mcp', 'src')]);
    expect(names).not.toContain('VITEST');
    for (const reason of Object.values(NOT_CONFIGURATION)) expect(reason.length).toBeGreaterThan(10);
  });

  it('finds every server and the template', () => {
    expect(PACKAGES.length).toBeGreaterThanOrEqual(14);
    expect(PACKAGES).toContain('bconnect-server-template');
  });
});

describe.each(PACKAGES)('%s README', (pkg) => {
  it('documents exactly the environment variables the server reads', () => {
    const { names, hidden } = variablesRead([join(ROOT, pkg, 'src'), CORE_SRC]);
    expect(hidden, 'environment reads the guard cannot name').toEqual([]);
    const path = join(ROOT, pkg, 'README.md');
    const readme = existsSync(path) ? readFileSync(path, 'utf8') : '';
    expect(compare(readme, names)).toEqual(CLEAN);
  });
});
