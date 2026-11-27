/**
 * The MCP Registry entry, packages/bconnect-mcp/server.json (#430).
 *
 * The registry accepts a version once and never lets its entry change, so a
 * wrong entry stays until the next release. This guard keeps server.json in
 * step with what it describes:
 * - name = the package's `mcpName` (the registry's ownership check on npm),
 *   identifier and version = the npm package's;
 * - the `domains` argument lists exactly the domains of `bconnect-mcp`;
 * - every environment variable is one docs/CONFIGURATION.md describes; the
 *   credentials are marked secret, as the gateway treats them, and nothing else
 *   is; the release choices and default are core's;
 * - the registry's limits that its validate API checks too (description length,
 *   npm base URL), so a pull request fails here first.
 * The registry's own validation runs in the npm workflow (`dry-run` job); the
 * version is also in the release-version guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';
import { DOMAINS } from '../packages/bconnect-mcp/src/domains.js';
import { DEFAULT_RELEASE, RELEASES } from '../packages/mcp-core/src/client-config.js';
import { SECRET_ENV_KEYS } from '../bconnect-mcp-gateway/src/secrets.js';

interface Input { name?: string; type?: string; valueHint?: string; description?: string; isRequired?: boolean; isSecret?: boolean; default?: string; choices?: string[] }
interface ServerJson {
  $schema: string; name: string; title: string; description: string; version: string;
  repository: { url: string; source: string; subfolder?: string };
  packages: { registryType: string; registryBaseUrl: string; identifier: string; version: string; transport: { type: string }; packageArguments: Input[]; environmentVariables: Input[] }[];
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;
const PKG = readJson<{ name: string; version: string; mcpName: string; files: string[] }>('packages/bconnect-mcp/package.json');
const SERVER = readJson<ServerJson>('packages/bconnect-mcp/server.json');
const CONFIGURATION = readFileSync(join(ROOT, 'docs', 'CONFIGURATION.md'), 'utf8');

describe('server.json', () => {
  it('names the package: mcpName, identifier and version', () => {
    expect(SERVER.name).toBe(PKG.mcpName);
    expect(SERVER.version).toBe(PKG.version);
    expect(SERVER.packages).toHaveLength(1);
    const [pkg] = SERVER.packages;
    expect(pkg).toMatchObject({ registryType: 'npm', registryBaseUrl: 'https://registry.npmjs.org', identifier: PKG.name, version: PKG.version, transport: { type: 'stdio' } });
  });

  it('points to this repository and the package folder', () => {
    expect(SERVER.repository).toMatchObject({ url: 'https://github.com/baramundisoftware/bConnect-MCP', source: 'github', subfolder: 'packages/bconnect-mcp' });
  });

  it('keeps the registry limits: description up to 100 characters, a dated schema', () => {
    expect(SERVER.description.length).toBeGreaterThan(0);
    expect(SERVER.description.length).toBeLessThanOrEqual(100);
    expect(SERVER.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  });

  it('has one argument, the domains, listing exactly the domains of bconnect-mcp', () => {
    const args = SERVER.packages[0].packageArguments;
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({ type: 'positional', valueHint: 'domains', isRequired: true, default: 'all' });
    const listed = /domain names separated by commas: (.+)$/.exec(args[0].description ?? '')?.[1].split(', ');
    expect(listed).toEqual([...DOMAINS].sort());
  });

  it('lists only variables CONFIGURATION.md describes, BCONNECT_BASE_URL required', () => {
    const vars = SERVER.packages[0].environmentVariables;
    for (const v of vars) {
      expect(CONFIGURATION, `### \`${v.name}\` in docs/CONFIGURATION.md`).toContain(`### \`${v.name}\``);
    }
    expect(vars.filter((v) => v.isRequired).map((v) => v.name)).toEqual(['BCONNECT_BASE_URL']);
    expect(new Set(vars.map((v) => v.name)).size).toBe(vars.length);
  });

  it('marks the credentials secret, as the gateway does, and nothing else', () => {
    const vars = SERVER.packages[0].environmentVariables;
    expect(vars.filter((v) => v.isSecret).map((v) => v.name).sort()).toEqual([...SECRET_ENV_KEYS].sort());
  });

  it("offers core's releases, with core's default", () => {
    const release = SERVER.packages[0].environmentVariables.find((v) => v.name === 'BCONNECT_RELEASE');
    expect(release?.default).toBe(DEFAULT_RELEASE);
    expect([...(release?.choices ?? [])].sort()).toEqual([...RELEASES].sort());
  });

  it('is not packed into the npm tarball (the registry reads it from the workflow)', () => {
    expect(PKG.files).not.toContain('server.json');
  });
});
