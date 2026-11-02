/**
 * A stale bconnect-mcp-gateway/node_modules is refused (#365): the gateway runs
 * on the root install, and a leftover folder there would load old packages
 * first (Express 4 instead of 5 in the v26.1.11 Windows run).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staleGatewayModules } from '../bconnect-mcp-gateway/check-install.mjs';

const ROOT = join(import.meta.dirname, '..');
const GATEWAY = join(ROOT, 'bconnect-mcp-gateway');
const dir = mkdtempSync(join(tmpdir(), 'gateway-install-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A gateway folder with the given entries in node_modules (undefined: no node_modules). */
function gateway(name: string, entries: string[] | undefined): string {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  cpSync(join(GATEWAY, 'check-install.mjs'), join(root, 'check-install.mjs'));
  for (const entry of entries ?? []) mkdirSync(join(root, 'node_modules', entry), { recursive: true });
  if (entries?.length === 0) mkdirSync(join(root, 'node_modules'));
  return root;
}

describe('staleGatewayModules', () => {
  it('accepts a gateway without node_modules, an empty one, and one with only tool caches', () => {
    expect(staleGatewayModules(gateway('none', undefined))).toBeUndefined();
    expect(staleGatewayModules(gateway('empty', []))).toBeUndefined();
    expect(staleGatewayModules(gateway('caches', ['.vite', '.vitest']))).toBeUndefined();
  });

  it('refuses installed packages with one line naming the folder and the command to remove it', () => {
    const root = gateway('stale', ['express', '@types/express', '.vite']);
    const message = staleGatewayModules(root) ?? '';
    expect(message).toContain(join(root, 'node_modules'));
    expect(message).toContain('rm -rf bconnect-mcp-gateway/node_modules');
    expect(message).not.toContain('\n');
  });
});

describe('check-install.mjs as a script', () => {
  it('exits 0 silently without a stale folder', () => {
    const out = execFileSync(process.execPath, [join(gateway('ok', ['.vite']), 'check-install.mjs')], { encoding: 'utf8' });
    expect(out).toBe('');
  });

  it('exits 1 with the message on stderr with one', () => {
    const run = spawnSync(process.execPath, [join(gateway('bad', ['express']), 'check-install.mjs')], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim().split('\n')).toHaveLength(1);
    expect(run.stderr).toContain('rm -rf bconnect-mcp-gateway/node_modules');
  });
});

describe('where it runs', () => {
  it('before the gateway build and its tests', () => {
    const { scripts } = JSON.parse(readFileSync(join(GATEWAY, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(scripts.prebuild).toBe('node check-install.mjs');
    expect(scripts.pretest).toBe('node check-install.mjs');
  });

  it('before the root test run', () => {
    expect(readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')).toContain("globalSetup: ['./__tests__/gateway-install.setup.ts']");
  });
});
