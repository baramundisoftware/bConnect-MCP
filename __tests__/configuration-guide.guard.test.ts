/**
 * One configuration guide (REQ-DOC-001, #293).
 *
 * docs/CONFIGURATION.md describes every environment variable the shipped code
 * reads (the 13 servers, @bconnect/mcp-core and the gateway, found with the
 * TypeScript parser), each under its own heading `### \`NAME\``, so other
 * documents can link to `docs/CONFIGURATION.md#name`. It describes nothing the
 * code doesn't read. The README, docs/DOCKER.md and docs/INSTALLATION.md link to
 * the guide instead of repeating a table of the settings; the server READMEs
 * keep their own list (readme-env guard).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';
import { envReads } from './lib/env-reads.js';
import { SECRET_ENV_KEYS } from '../bconnect-mcp-gateway/src/secrets.js';

const GUIDE = join(ROOT, 'docs', 'CONFIGURATION.md');

/** Read by the code but not configuration (see readme-env.guard.test.ts). */
const NOT_CONFIGURATION = new Set(['VITEST']);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'generated' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(test|spec|d)\.ts$/.test(name) ? [path] : [];
  });

const SHIPPED = [
  join(ROOT, 'bconnect-mcp-gateway', 'src'),
  join(ROOT, 'packages', 'mcp-core', 'src'),
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway').map((d) => join(ROOT, d, 'src')),
];

/**
 * Every setting an operator can set: the names the code reads, plus the gateway's `<KEY>_FILE`
 * secrets (read through a computed name). A read whose name can't be known is left out here;
 * readme-env.guard and gateway-env.guard fail on such reads.
 */
const SETTINGS = [...new Set([
  ...SHIPPED.flatMap(sourceFiles).flatMap((file) => envReads(readFileSync(file, 'utf8'), file).map((r) => r.name)),
  ...SECRET_ENV_KEYS.map((key) => `${key}_FILE`),
])].filter((name): name is string => typeof name === 'string' && !NOT_CONFIGURATION.has(name)).sort();

const read = (file: string): string => readFileSync(file, 'utf8');
/**
 * The lines of a Markdown text outside fenced code and HTML comments, so a heading there doesn't
 * count. One pass over the lines, no pattern removal: a comment runs from its `<!--` line to the
 * line with `-->`, a fence from a ```` ``` ```` line to the next.
 */
function visible(text: string): string {
  const out: string[] = [];
  let fence = false;
  let comment = false;
  for (const line of text.split('\n')) {
    if (!comment && line.trimStart().startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (comment || line.includes('<!--')) {
      comment = !line.includes('-->') || line.lastIndexOf('<!--') > line.lastIndexOf('-->');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
const guide = (): string => visible(read(GUIDE));
/** The variables the guide gives a heading of their own. */
const headings = (text: string): string[] => [...text.matchAll(/^### `([A-Z][A-Z0-9_]*)`$/gm)].map((m) => m[1]);

/**
 * A table row with a setting in any cell, written as `NAME` or as an abbreviation of the setting
 * before it (`_MAX_REQUESTS`): a second description of the settings.
 */
const settingRows = (text: string): string[] => text.split('\n').filter((line) => {
  if (!line.startsWith('|')) return false;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  return cells.some((cell) => [...cell.matchAll(/`(_?[A-Z][A-Z0-9_]*)`/g)].some(([, name]) =>
    SETTINGS.includes(name) || (name.startsWith('_') && SETTINGS.some((s) => s.endsWith(name)))) && /^`[^`]+`(\s*(\/|\+|,|or|and)\s*`[^`]+`)*$/.test(cell));
});

describe('docs/CONFIGURATION.md', () => {
  it('finds the settings it compares against (self-check)', () => {
    for (const name of ['BCONNECT_BASE_URL', 'ALLOW_WRITE_OPERATIONS', 'MCP_GATEWAY_BIND', 'LOG_FORMAT', 'BCONNECT_API_KEY_FILE']) {
      expect(SETTINGS, name).toContain(name);
    }
    expect(SETTINGS).not.toContain('VITEST');
  });

  it('describes every setting the code reads, each once, and none it doesn\'t read', () => {
    const listed = headings(guide());
    expect([...listed].sort()).toEqual(SETTINGS);
    expect(listed.length).toBe(new Set(listed).size);
  });

  it('gives each setting a description under its heading', () => {
    // A section ends at the next heading of any level, so a group's intro doesn't count for the setting before it.
    const sections = guide().split(/^### /m).slice(1).map((s) => s.split(/^#{1,3} /m)[0]);
    const empty = sections.filter((s) => s.split('\n').slice(1).join('\n').trim().length < 20).map((s) => s.split('\n')[0]);
    expect(empty).toEqual([]);
  });

  it('keeps "how to find the server URL", "how to generate an API key" and the TLS section', () => {
    expect(guide()).toMatch(/^## How to find your bMS server URL$/m);
    expect(guide()).toMatch(/^## How to generate an API key$/m);
    expect(guide()).toMatch(/^## TLS and CA certificates$/m);
  });
});

describe('the other documents link to the guide instead of repeating the settings', () => {
  it.each(['README.md', 'docs/DOCKER.md', 'docs/INSTALLATION.md'])('%s has no table of the settings and links to the guide', (file) => {
    const text = read(join(ROOT, file));
    expect(settingRows(text)).toEqual([]);
    expect(text).toMatch(file === 'README.md' ? /\(docs\/CONFIGURATION\.md(#[a-z0-9_-]+)?\)/ : /\(CONFIGURATION\.md(#[a-z0-9_-]+)?\)/);
  });

  it('self-check: a settings table is recognised, in any column and abbreviated; other tables are not', () => {
    expect(settingRows('| `BCONNECT_BASE_URL` | Yes | — | URL |\n| `BCONNECT_USERNAME` / `BCONNECT_PASSWORD` | x |')).toHaveLength(2);
    expect(settingRows('| `BCONNECT_RATE_LIMIT_ENABLED` / `_MAX_REQUESTS` / `_WINDOW_MS` | Outbound limit |')).toHaveLength(1);
    expect(settingRows('| Gateway | `MCP_GATEWAY_PORT` | 3001 |')).toHaveLength(1);
    expect(settingRows('| `BCONNECT_CA_CERT_PATH can\'t be read: <path>` | x |\n| Tool | Description |\n| `list_endpoints` | x |\n| `26R1` | All 13 servers |')).toEqual([]);
  });

  it('self-check: a heading inside fenced code or a comment doesn\'t count, and an empty setting is caught despite the next group\'s intro', () => {
    expect(headings(visible('```\n### `BCONNECT_BASE_URL`\n```'))).toEqual([]);
    expect(headings(visible('<!--\n### `BCONNECT_BASE_URL`\n-->\n### `MCP_PORT`'))).toEqual(['MCP_PORT']);
    expect(headings(visible('<!-- one line --> \n### `MCP_BIND`'))).toEqual(['MCP_BIND']);
    const text = '### `A`\n\n## Next group\n\nLong introduction text of the next group, well over twenty characters.\n';
    const section = text.split(/^### /m).slice(1).map((s) => s.split(/^#{1,3} /m)[0])[0];
    expect(section.split('\n').slice(1).join('\n').trim().length).toBeLessThan(20);
  });
});
