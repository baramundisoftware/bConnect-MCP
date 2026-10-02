/**
 * Gateway settings reach the container (REQ-GW-003, #98).
 *
 * In gateway mode one process runs the gateway, `@bconnect/mcp-core` and all
 * domain servers, so it reads the union of their environment variables. Each one
 * must be:
 * - forwarded: an `environment:` entry in docker-compose.gateway.yml taking it
 *   from `${VAR…}`, so an operator can set it in .env.gateway, or
 * - fixed: an `environment:` entry with a literal value, or
 * - deliberately not forwarded: listed below with the reason.
 * Every variable an operator can set (forwarded, or interpolated by Compose
 * itself, e.g. for ports and limits) is documented in .env.gateway.example, and
 * everything documented there has an effect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { envReads } from './lib/env-reads.js';
import { SECRET_ENV_KEYS } from '../bconnect-mcp-gateway/src/secrets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(ROOT, 'docker-compose.gateway.yml');
const EXAMPLE = join(ROOT, '.env.gateway.example');

/** Read in gateway mode, but not forwarded on purpose. */
const NOT_FORWARDED: Record<string, string> = {
  ALLOW_WRITE_OPERATIONS: 'write gate stays off in gateway mode until gateway auth is decided (D11, REQ-SRV-017 D3)',
  ALLOW_SECRET_READ: 'secret gate stays off in gateway mode until gateway auth is decided (D11, REQ-SRV-017 D3)',
  MCP_PORT: "a standalone server's own HTTP transport; the gateway serves all domains itself",
  MCP_BIND: "a standalone server's own HTTP transport; the gateway serves all domains itself",
  MCP_TRANSPORT: "a standalone server's own transport switch; not used when the gateway hosts the servers",
  VITEST: 'set by the test runner and the gateway preload so a server main() does not run on import',
  ...Object.fromEntries(SECRET_ENV_KEYS.map((key) => [`${key}_FILE`,
    'Docker-secret file for the credential; needs a secrets mount in the compose file (follow-up), so not offered yet'])),
};

/** secrets.ts reads `<KEY>_FILE` for each credential key through a computed name; this is that name. */
const SECRETS_SOURCE = join('bconnect-mcp-gateway', 'src', 'secrets.ts');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'generated' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(test|spec|d)\.ts$/.test(name) ? [path] : [];
  });

const GATEWAY_SOURCES = [
  join(ROOT, 'bconnect-mcp-gateway', 'src'),
  join(ROOT, 'packages', 'mcp-core', 'src'),
  ...readdirSync(ROOT)
    .filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')
    .map((d) => join(ROOT, d, 'src')),
];

const read = new Map<string, string>();
const hidden: string[] = [];
for (const file of GATEWAY_SOURCES.flatMap(sourceFiles)) {
  for (const r of envReads(readFileSync(file, 'utf8'), file)) {
    if (r.name === null && file.endsWith(SECRETS_SOURCE)) continue; // expanded below from SECRET_ENV_KEYS
    if (r.name === null) hidden.push(`${file.slice(ROOT.length + 1)}:${r.line} ${r.text}`);
    else if (!read.has(r.name)) read.set(r.name, `${file.slice(ROOT.length + 1)}:${r.line}`);
  }
}

for (const key of SECRET_ENV_KEYS) read.set(`${key}_FILE`, `${SECRETS_SOURCE} (from SECRET_ENV_KEYS)`);

const composeText = readFileSync(COMPOSE, 'utf8');
const compose = yaml.load(composeText) as { services: Record<string, { environment?: Record<string, unknown> }> };
const services = Object.values(compose.services);
const environment: Record<string, unknown> = Object.assign({}, ...services.map((s) => s.environment ?? {}));

const interpolated = (text: string): string[] => [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
const forwarded = new Map<string, string>(); // container variable -> source variable
const fixed = new Set<string>();
for (const [key, value] of Object.entries(environment)) {
  const sources = interpolated(String(value));
  if (sources.length) forwarded.set(key, sources[0]);
  else fixed.add(key);
}
const operatorSettable = new Set(interpolated(composeText));

const documented = new Set(
  readFileSync(EXAMPLE, 'utf8').split(/\r?\n/)
    .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((name): name is string => !!name),
);

describe('gateway environment', () => {
  it('finds the variables the gateway process reads', () => {
    expect(read.size).toBeGreaterThan(15);
    expect(hidden).toEqual([]);
  });

  it('forwards, fixes or deliberately leaves out every variable it reads', () => {
    const unhandled = [...read.keys()]
      .filter((name) => !forwarded.has(name) && !fixed.has(name) && !(name in NOT_FORWARDED))
      .map((name) => `${name} (read at ${read.get(name)})`)
      .sort();
    expect(unhandled).toEqual([]);
  });

  it('forwards each variable under its own name', () => {
    const renamed = [...forwarded].filter(([key, source]) => key !== source).map(([k, s]) => `${k} <- \${${s}}`);
    expect(renamed).toEqual([]);
  });

  it('documents every variable an operator can set in .env.gateway', () => {
    expect([...operatorSettable].filter((name) => !documented.has(name)).sort()).toEqual([]);
  });

  it('documents nothing that has no effect', () => {
    expect([...documented].filter((name) => !operatorSettable.has(name)).sort()).toEqual([]);
  });

  it('keeps the not-forwarded list current', () => {
    const stale = Object.keys(NOT_FORWARDED).filter((name) => !read.has(name) || forwarded.has(name) || fixed.has(name));
    expect(stale).toEqual([]);
  });
});
