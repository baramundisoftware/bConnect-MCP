/**
 * Package metadata guard (REQ-DEP-003, #339).
 *
 * - No package can be published to npm by mistake: every manifest is
 *   `"private": true` unless it is named `@baramundi/…`, the scope #297 will
 *   publish under.
 * - Every manifest declares the same Node.js floor, and it is a patched release
 *   on each supported line: the Node.js security release of 2026-10-21 fixed
 *   22.23.4, 24.22.1 and 26.12.1, and Node.js 20 is end-of-life without a fix.
 * - `.nvmrc` and every Node.js version CI sets up are on that floor, so CI tests
 *   the oldest version the manifests allow.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The engines range every manifest declares. */
const NODE_RANGE = '^22.23.4 || ^24.22.1 || >=26.12.1';
/** The floor: what `.nvmrc` names and CI pins. */
const NODE_FLOOR = '22.23.4';

type Manifest = { name?: string; private?: boolean; engines?: { node?: string } };
const read = (dir: string): Manifest => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));

const MANIFEST_DIRS = [
  '.',
  'bconnect-mcp-gateway',
  'bconnect-server-template',
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway'),
  ...readdirSync(join(ROOT, 'packages')).map((d) => join('packages', d)),
].sort();

type Step = { uses?: string; with?: { 'node-version'?: string } };
type Job = { strategy?: { matrix?: { node?: unknown[] } }; steps?: Step[] };
const ci = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as { jobs: Record<string, Job> };

/** Every Node.js version a setup-node step in ci.yml installs, matrix entries expanded. */
function ciNodeVersions(): string[] {
  return Object.values(ci.jobs).flatMap((job) =>
    (job.steps ?? [])
      .filter((s) => (s.uses ?? '').startsWith('actions/setup-node@'))
      .flatMap((s) => {
        const v = String(s.with?.['node-version'] ?? '');
        return /\$\{\{\s*matrix\.node\s*\}\}/.test(v) ? (job.strategy?.matrix?.node ?? []).map(String) : [v];
      }),
  );
}

describe('package metadata — REQ-DEP-003', () => {
  it('covers the root, core, gateway, template and all 13 servers (self-check)', () => {
    expect(MANIFEST_DIRS).toContain('bconnect-mcp-gateway');
    expect(MANIFEST_DIRS).toContain(join('packages', 'mcp-core'));
    expect(MANIFEST_DIRS.filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')).toHaveLength(13);
  });

  it.each(MANIFEST_DIRS)('%s is private unless it is named @baramundi/…', (dir) => {
    const m = read(dir);
    expect(m.private === true || (m.name ?? '').startsWith('@baramundi/'), `${dir}: name ${m.name}`).toBe(true);
  });

  it.each(MANIFEST_DIRS)(`%s declares engines.node "${NODE_RANGE}"`, (dir) => {
    expect(read(dir).engines?.node).toBe(NODE_RANGE);
  });

  it('.nvmrc names the floor', () => {
    expect(readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()).toBe(NODE_FLOOR);
  });

  it('CI tests the floor, and every Node.js version it sets up is in the range', () => {
    const versions = ciNodeVersions();
    expect(versions).toContain(NODE_FLOOR);
    // A bare major ("24") installs that line's latest release, which is past its fix.
    const allowed = (v: string) => v === NODE_FLOOR || v === '24' || v === '26';
    expect(versions.filter((v) => !allowed(v))).toEqual([]);
  });
});
