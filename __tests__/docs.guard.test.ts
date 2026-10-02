/**
 * Docs guard: the published guides name only settings that exist and quote only
 * messages the code prints.
 *
 * An audit of docs/ (2026-10-02) found troubleshooting entries for messages no
 * code printed ("Token expired", "SSL certificate verify failed"), a quoted 401
 * text that had changed, and settings nobody read (`DEBUG`). Users search for
 * the message they see; a doc that quotes another one doesn't help them.
 *
 * 1. Every environment variable a guide names is read by the code (servers,
 *    core, gateway, live tier, mock tier), or is listed below with the reason.
 * 2. Every error message TROUBLESHOOTING.md quotes is printed by the code: the
 *    words between placeholders (`…`, `<name>`, numbers) occur in a string or
 *    template literal of production code, where `${…}` counts as a placeholder.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { ROOT } from './lib/exerciser.js';
import { envReads } from './lib/env-reads.js';

/** The guides published under docs/ (the rest of docs/ is git-ignored). */
const GUIDES = ['AUDIT', 'DOCKER', 'INSTALLATION', 'LIVE_BMS_TESTING', 'MOCK_INTEGRATION_TESTING', 'N8N', 'TROUBLESHOOTING']
  .map((name) => join(ROOT, 'docs', `${name}.md`));

/** Named in the guides, read by something other than this repo's TypeScript. */
const READ_ELSEWHERE: Record<string, string> = {
  NODE_EXTRA_CA_CERTS: 'read by Node.js itself at startup',
  NODE_OPTIONS: 'read by Node.js itself; the live tier refuses it',
  NODE_USE_ENV_PROXY: 'read by Node.js itself; the live tier refuses it',
  SSL_CERT_FILE: 'read by OpenSSL in Node.js; the live tier refuses it',
  SSL_CERT_DIR: 'read by OpenSSL in Node.js; the live tier refuses it',
  BCONNECT_BMS_VERSION: 'a bConnect-Mock setting',
  BCONNECT_LIVE_MDM: "read from the live tier's env file, not the process environment (live/lib/env.ts)",
  BCONNECT_LIVE_ENTRA_ID: "read from the live tier's env file, not the process environment (live/lib/env.ts)",
  NODE_ENV: "set in the mock tier's vitest config, which MOCK_INTEGRATION_TESTING.md shows",
  BCONNECT_USERNAME_FILE: 'read by the gateway through `${key}_FILE` (secrets.ts)',
  BCONNECT_PASSWORD_FILE: 'read by the gateway through `${key}_FILE` (secrets.ts)',
  BCONNECT_API_KEY_FILE: 'read by the gateway through `${key}_FILE` (secrets.ts)',
  MCP_GATEWAY_MEM_LIMIT: 'a docker-compose.gateway.yml setting',
  MCP_GATEWAY_CPU_LIMIT: 'a docker-compose.gateway.yml setting',
};

const NAME = /\b(?:BCONNECT|MCP|ALLOW|NODE|LOG|SSL|DEBUG)_[A-Z0-9_]*[A-Z0-9]\b|\bDEBUG\b(?==)/g;

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(?:ts|mts|mjs)$/.test(e.name) && !/\.d\.mts$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/node_modules|[\\/]build[\\/]/.test(f));
}

/** Production code plus the live and mock tiers, whose settings the guides describe. */
const SOURCES = [
  ...tsFiles(join(ROOT, 'packages', 'mcp-core', 'src')),
  ...tsFiles(join(ROOT, 'bconnect-mcp-gateway', 'src')),
  ...tsFiles(join(ROOT, '__tests__', 'live')),
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d)).flatMap((d) => tsFiles(join(ROOT, d, 'src'))),
];

const readNames = new Set(
  SOURCES.flatMap((file) => envReads(readFileSync(file, 'utf8'), file).map((r) => r.name).filter((n): n is string => Boolean(n))),
);

describe('docs — settings the guides name exist', () => {
  it('finds the reads it compares against (self-check)', () => {
    for (const name of ['BCONNECT_BASE_URL', 'BCONNECT_TIMEOUT_MS', 'LOG_LEVEL', 'MCP_GATEWAY_BIND', 'BCONNECT_MOCK_URL', 'BCONNECT_LIVE_ENV']) {
      expect(readNames, name).toContain(name);
    }
  });

  it('names only variables the code reads, or that are listed with a reason', () => {
    const unknown = GUIDES.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...new Set(text.match(NAME) ?? [])]
        .filter((name) => !readNames.has(name) && !(name in READ_ELSEWHERE))
        .map((name) => `${relative(ROOT, file)}: ${name}`);
    });
    expect(unknown).toEqual([]);
  });

  it('lists no exception that the code reads anyway, or that no guide names', () => {
    const named = new Set(GUIDES.flatMap((file) => readFileSync(file, 'utf8').match(NAME) ?? []));
    const stale = Object.keys(READ_ELSEWHERE).filter((name) => readNames.has(name) || !named.has(name));
    expect(stale).toEqual([]);
  });
});

/**
 * The text of every string and template literal in production code (no tests, no
 * comments), in file order, with each `${…}` as a gap. Adjacent literals of a
 * concatenation (`"a " + "b"`) end up next to each other.
 */
function literalText(file: string): string {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const parts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      parts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      parts.push(node.head.text, ...node.templateSpans.flatMap((span) => ['\u0000', span.literal.text]));
      node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return parts.join(' ');
}

const PRODUCTION = SOURCES.filter((f) => !/[\\/]__tests__[\\/]|\.test\.ts$/.test(f));

/** Words, without quotes, brackets and separators, so literal and doc text compare alike. */
const words = (s: string): string[] =>
  s.replace(/["`,;()[\]{}]/g, ' ').split(/\s+/).map((w) => w.replace(/[.:!?]+$/, '')).filter((w) => /[\w\u0000]/.test(w));

const SOURCE_WORDS = ` ${PRODUCTION.flatMap((f) => words(literalText(f))).join(' ')} `;

/**
 * What to look up for a message: between placeholders, every run of four words, or
 * the whole part when it has two or three. Placeholders are `…`, `<name>`, numbers, a
 * plural `(s)`, and values the code fills in: an HTTP method or a status name like
 * `(Unauthorized)`.
 */
function runs(message: string): string[] {
  return message
    .split(/…|<[^>]+>|\b\d+\b|\(s\)|\b(?:GET|POST|PUT|PATCH|DELETE)\b|\([A-Z][a-z]+(?: [A-Z][a-z]+)*\)/)
    .flatMap((part) => {
      const w = words(part);
      if (w.length < 2) return [];
      if (w.length < 4) return [w.join(' ')];
      return w.slice(0, w.length - 3).map((_, k) => w.slice(k, k + 4).join(' '));
    });
}

const found = (message: string): boolean => {
  const r = runs(message);
  return r.length > 0 && r.every((run) => SOURCE_WORDS.includes(` ${run} `));
};

/** Quoted with a list the code builds at runtime, so the words aren't in the source as written. */
const BUILT_AT_RUNTIME: Record<string, string> = {
  'BCONNECT_AUDIT_LEVEL "…" isn\'t valid. Use one of: none, security, write, all.':
    'client-config.ts joins AUDIT_LEVELS into the message',
};

/** Messages TROUBLESHOOTING.md quotes: `Error: "…"` headings and backticked sentences. */
function quotedMessages(): string[] {
  const text = readFileSync(join(ROOT, 'docs', 'TROUBLESHOOTING.md'), 'utf8').replace(/```[\s\S]*?```/g, '');
  const headings = [...text.matchAll(/^#+ Error: "([^"]+)"/gm)].map((m) => m[1]);
  const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\s*\n\s*/g, ' '))
    .filter((s) => /^(?:[A-Z]|bConnect|<)/.test(s) && words(s).length >= 3 && !/^TS\d+:/.test(s));
  return [...headings, ...spans];
}

describe('docs — TROUBLESHOOTING.md quotes messages the code prints', () => {
  it('finds quoted messages and catches invented ones (self-check)', () => {
    expect(quotedMessages().length).toBeGreaterThan(15);
    expect(found('Cannot connect to the bConnect API.')).toBe(true);
    for (const invented of ['Token expired', 'SSL certificate verify failed',
      'Authentication failed. Check your username and password.', 'Cannot connect to bConnect API.']) {
      expect(found(invented), invented).toBe(false);
    }
    // A comment or a test file doesn't count as printed.
    expect(PRODUCTION.some((f) => f.includes('__tests__'))).toBe(false);
  });

  it('every quoted message occurs in the source', () => {
    const missing = quotedMessages().filter((m) => !(m in BUILT_AT_RUNTIME) && !found(m));
    expect(missing).toEqual([]);
  });

  it('lists no runtime-built message the guide doesn\'t quote', () => {
    const quoted = new Set(quotedMessages());
    expect(Object.keys(BUILT_AT_RUNTIME).filter((m) => !quoted.has(m))).toEqual([]);
  });
});
