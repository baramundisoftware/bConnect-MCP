/**
 * Release version guard.
 *
 * The release version lives in many places: the root manifest, every server,
 * the template and the gateway manifest, both lockfiles, the `version` each
 * server reports in its MCP handshake (hard-coded in src/index.ts) and the
 * compose image tag. A release once bumped the manifests and left all 14
 * handshake versions on the old number. Everything must match the root
 * package.json; `packages/mcp-core` is private and stays unversioned.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const VERSION: string = readJson('package.json').version;

const SERVER_DIRS = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^bconnect-.*-mcp$|^bconnect-server-template$/.test(d.name))
  .map((d) => d.name)
  .sort();

describe('release version', () => {
  it('finds the 13 servers and the template', () => {
    expect(SERVER_DIRS).toHaveLength(14);
  });

  it.each([...SERVER_DIRS, 'bconnect-mcp-gateway'])('%s/package.json matches the root', (dir) => {
    expect(readJson(`${dir}/package.json`).version).toBe(VERSION);
  });

  it.each(SERVER_DIRS)('%s reports the root version in its handshake', (dir) => {
    const src = readFileSync(join(ROOT, dir, 'src', 'index.ts'), 'utf8');
    const versions = [...src.matchAll(/^\s*version:\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(versions).toEqual([VERSION]);
  });

  it('root lockfile carries the root version for the root and every workspace', () => {
    const lock = readJson('package-lock.json');
    expect(lock.version).toBe(VERSION);
    for (const key of ['', ...SERVER_DIRS]) {
      expect(lock.packages[key]?.version, `package-lock.json packages["${key}"]`).toBe(VERSION);
    }
  });

  it('gateway lockfile carries the root version', () => {
    const lock = readJson('bconnect-mcp-gateway/package-lock.json');
    expect(lock.version).toBe(VERSION);
    expect(lock.packages[''].version).toBe(VERSION);
  });

  it('docker-compose.gateway.yml tags the image with the root version', () => {
    const compose = readFileSync(join(ROOT, 'docker-compose.gateway.yml'), 'utf8');
    expect(compose).toContain(`image: bconnect-mcp-gateway:${VERSION}`);
  });

  it('CHANGELOG has a section for the root version', () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toMatch(new RegExp(`^## \\[${VERSION.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
  });
});
