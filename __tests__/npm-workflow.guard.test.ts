/**
 * npm workflow guard (#297).
 *
 * The npm workflow (.github/workflows/npm.yml) is the only way the package
 * @baramundi/bconnect-mcp reaches npm, so what keeps a publish safe is pinned:
 *
 * 1. Only a `vX.Y.Z` tag runs it with a push, as for the gateway image; on a tag
 *    the version must equal the package's.
 * 2. Write permissions sit on the publish and registry jobs only (id-token, for
 *    provenance and the MCP Registry login).
 * 3. Every `npm publish` uses the dist-tag `next`. Pull requests and manual runs
 *    only dry-run; the real publish runs on a tag alone, when NPM_PUBLISH_ENABLED
 *    is `true`, in the `npm` environment (its reviewers approve), without a
 *    dependency cache.
 * 4. The package is publishable (not private), public, with provenance, its
 *    prepublishOnly guard refuses a publish outside GitHub Actions or without
 *    `--tag next`, and its mcpName is the MCP Registry name.
 * 5. The package check runs on Node 22, 24 and 26.
 * 6. The MCP Registry entry (#430) is sent only after npm published that version
 *    on a tag, or on a manual run from main that asks for it, in the
 *    `mcp-registry` environment (its reviewers approve), with a pinned and
 *    checksum-verified mcp-publisher, logged in with OIDC and no secret.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

interface Step { run?: string; if?: string; name?: string; uses?: string; with?: Record<string, string>; env?: Record<string, string>; 'working-directory'?: string }
interface Job { if?: string; needs?: string | string[]; env?: Record<string, string>; environment?: { name?: string }; permissions?: Record<string, string>; strategy?: { matrix?: { node?: string[] } }; steps?: Step[] }
interface Workflow { on: { push?: { tags?: string[] } } & Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> }
const workflow = yaml.load(read('.github/workflows/npm.yml')) as Workflow;
const image = yaml.load(read('.github/workflows/image.yml')) as Workflow;
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
const PKG_DIR = 'packages/bconnect-mcp';
const manifest = JSON.parse(read(`${PKG_DIR}/package.json`)) as Record<string, unknown> & { scripts?: Record<string, string>; publishConfig?: Record<string, unknown> };

describe('npm workflow', () => {
  it('a push runs it only for a vX.Y.Z tag, the image workflow\'s pattern', () => {
    expect(Object.keys(workflow.on.push ?? {})).toEqual(['tags']);
    expect(workflow.on.push?.tags).toEqual(image.on.push?.tags);
  });

  it('checks on a tag that it equals the package version, in the dry run and before the publish', () => {
    const checks = (job: string) => (workflow.jobs[job]?.steps ?? []).filter((s) => s.name === 'Tag equals the package version');
    expect(checks('dry-run')).toHaveLength(1);
    expect(checks('dry-run')[0].if).toBe("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
    expect(checks('publish')).toHaveLength(1);
    for (const check of [...checks('dry-run'), ...checks('publish')]) {expect(check.run).toContain(`${PKG_DIR}/package.json`);}
  });

  it('reads only at the top; id-token write on the publish and registry jobs alone', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const writes = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write').map(([scope]) => scope);
      expect(writes, name).toEqual(name === 'publish' || name === 'registry' ? ['id-token'] : []);
    }
  });

  it('every npm publish uses the dist-tag next, from the package folder', () => {
    const publishes = steps.filter((s) => /\bnpm publish\b/.test(s.run ?? ''));
    expect(publishes).toHaveLength(2);
    for (const step of publishes) {
      for (const line of (step.run ?? '').split('\n').filter((l) => /\bnpm publish\b/.test(l))) {expect(line).toMatch(/--tag next\b/);}
      expect(step['working-directory']).toBe(PKG_DIR);
    }
  });

  it('pull requests and manual runs only dry-run', () => {
    const run = (job: string) => (workflow.jobs[job]?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(run('dry-run')).toMatch(/npm publish --dry-run --tag next/);
    expect(run('dry-run')).not.toMatch(/npm publish(?! --dry-run)/);
    expect(run('check')).not.toMatch(/\bnpm publish\b/);
  });

  it('publishes for real only on a tag, when NPM_PUBLISH_ENABLED is true, in the npm environment', () => {
    const job = workflow.jobs.publish;
    expect(job?.needs).toBe('dry-run');
    expect(job?.if?.replace(/\s+/g, ' ').trim()).toBe(
      "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && vars.NPM_PUBLISH_ENABLED == 'true'");
    expect(job?.environment?.name).toBe('npm');
    const publish = job?.steps?.find((s) => /\bnpm publish\b/.test(s.run ?? ''));
    expect(publish?.run).toBe('npm publish --tag next');
    expect(publish?.env).toEqual({ NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' });
  });

  it('the publish job has no dependency cache and checks out without credentials', () => {
    const steps = workflow.jobs.publish?.steps ?? [];
    const setup = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setup?.with?.cache).toBeUndefined();
    expect(steps.find((s) => s.uses?.startsWith('actions/checkout@'))?.with).toMatchObject({ 'persist-credentials': false });
  });

  it('runs the package check on Node 22, 24 and 26', () => {
    expect(workflow.jobs.check?.strategy?.matrix?.node).toEqual(['22.23.4', '24', '26']);
    expect(workflow.jobs.check?.steps?.map((s) => s.run)).toContain('node scripts/check-package.mjs');
  });
});

describe('MCP Registry job', () => {
  const job = workflow.jobs.registry;
  const run = (job?.steps ?? []).map((s) => s.run ?? '').join('\n');
  const dispatch = workflow.on.workflow_dispatch as { inputs?: Record<string, { type?: string; default?: unknown }> } | undefined;

  it('runs after npm published the tag, or on a manual run from main with register_existing', () => {
    expect(job?.needs).toEqual(['dry-run', 'publish']);
    const condition = job?.if?.replace(/\s+/g, ' ').trim();
    expect(condition).toBe("!cancelled() && needs.dry-run.result == 'success' && ( " +
      "(github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && needs.publish.result == 'success') || " +
      "(github.event_name == 'workflow_dispatch' && inputs.register_existing && github.ref == 'refs/heads/main') )");
    expect(dispatch?.inputs?.register_existing).toMatchObject({ type: 'boolean', default: false });
  });

  it('runs in the mcp-registry environment and checks out without credentials', () => {
    expect(job?.environment?.name).toBe('mcp-registry');
    expect(job?.steps?.find((s) => s.uses?.startsWith('actions/checkout@'))?.with).toMatchObject({ 'persist-credentials': false });
  });

  it('uses a pinned mcp-publisher, verified against its sha256 before unpacking', () => {
    expect(job?.env?.MCP_PUBLISHER_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(job?.env?.MCP_PUBLISHER_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(run).not.toMatch(/releases\/latest/);
    const download = job?.steps?.find((s) => s.name?.startsWith('Download mcp-publisher'))?.run ?? '';
    expect(download.indexOf('sha256sum -c')).toBeGreaterThan(-1);
    expect(download.indexOf('sha256sum -c')).toBeLessThan(download.indexOf('tar xzf'));
  });

  it('logs in with OIDC, no secret, and publishes the package\'s server.json after checking npm', () => {
    expect(run).toContain('./mcp-publisher login github-oidc');
    expect(JSON.stringify(job)).not.toMatch(/secrets\./);
    expect(run).toContain(`./mcp-publisher publish ${PKG_DIR}/server.json`);
    expect(run.indexOf('npm view')).toBeLessThan(run.indexOf('./mcp-publisher publish'));
  });

  it('the dry run checks server.json with the registry validation on every run', () => {
    const step = workflow.jobs['dry-run']?.steps?.find((s) => s.name === 'server.json passes the MCP Registry validation');
    expect(step?.if).toBeUndefined();
    expect(step?.run).toContain('https://registry.modelcontextprotocol.io/v0/validate');
    expect(step?.run).toContain(`${PKG_DIR}/server.json`);
  });
});

describe('the package manifest', () => {
  it('is publishable, public, with provenance', () => {
    expect(manifest.private).toBeUndefined();
    expect(manifest.name).toBe('@baramundi/bconnect-mcp');
    expect(manifest.publishConfig).toEqual({ access: 'public', provenance: true });
    expect(manifest.repository).toMatchObject({ url: 'git+https://github.com/baramundisoftware/bConnect-MCP.git', directory: PKG_DIR });
  });

  it('carries the MCP Registry name (namespace io.github.baramundisoftware)', () => {
    expect(manifest.mcpName).toBe('io.github.baramundisoftware/bconnect-mcp');
  });

  it('runs the publish guard before every publish', () => {
    expect(manifest.scripts?.prepublishOnly).toBe('node publish-guard.mjs');
  });
});

describe('publish-guard.mjs', () => {
  const guard = (env: Record<string, string>) => spawnSync(process.execPath, ['publish-guard.mjs'], {
    cwd: join(ROOT, PKG_DIR), env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8',
  });

  it.for([
    ['outside GitHub Actions', { npm_config_tag: 'next' }, /GitHub Actions/],
    ['without a tag (latest)', { GITHUB_ACTIONS: 'true' }, /--tag next/],
    ['with another tag', { GITHUB_ACTIONS: 'true', npm_config_tag: 'latest' }, /--tag next/],
  ] as const)('refuses a publish %s', ([, env, reason]) => {
    const result = guard(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(reason);
  });

  it('lets the workflow publish under next', () => {
    expect(guard({ GITHUB_ACTIONS: 'true', npm_config_tag: 'next' }).status).toBe(0);
  });
});
