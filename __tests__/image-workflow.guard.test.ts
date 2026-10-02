/**
 * Gateway image workflow guard (#130).
 *
 * A version tag publishes an image to GHCR, so the properties that keep a
 * publish safe are pinned here:
 *
 * 1. Every workflow uses GitHub-owned actions only. The repository allows no
 *    others; a `docker/*` action (as in the workflow removed in #93) would make
 *    the run fail at the first step, on the tag, when it is too late to notice.
 * 2. Only a `vX.Y.Z` tag publishes. Pull requests and manual runs build only.
 * 3. Nothing outside the tag path logs in or pushes; write permissions sit on
 *    the jobs, never at the top.
 * 4. The tag must equal the root and gateway package.json version.
 * 5. Image name and tags match `scripts/publish-image.sh`, the hand-run fallback.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const text = readFileSync(join(WORKFLOWS, 'image.yml'), 'utf8');

interface Step { uses?: string; run?: string; if?: string; name?: string }
interface Job { if?: string; uses?: string; permissions?: Record<string, string>; steps?: Step[] }
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}
const workflow = yaml.load(text) as Workflow;

const TAG_GUARD = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";

describe('all workflows — GitHub-owned actions only', () => {
  it('uses no action outside actions/* or github/*', () => {
    const offenders = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) => {
        const wf = yaml.load(readFileSync(join(WORKFLOWS, f), 'utf8')) as Workflow;
        // Step actions and job-level reusable workflows alike.
        return Object.values(wf.jobs).flatMap((j) =>
          [j.uses, ...(j.steps ?? []).map((s) => s.uses)].filter((u): u is string => Boolean(u))
            .filter((u) => !/^(actions|github)\//.test(u) && !u.startsWith('./'))
            .map((u) => `${f}: ${u}`),
        );
      });
    expect(offenders).toEqual([]);
  });
});

describe('image.yml — publishing (#130)', () => {
  it('publishes only on a vX.Y.Z tag and builds on pull requests', () => {
    expect(workflow.on.push).toEqual({ tags: ['v[0-9]+.[0-9]+.[0-9]+'] });
    expect(workflow.on).toHaveProperty('pull_request');
    expect(workflow.env?.PUBLISH).toBe(`\${{ ${TAG_GUARD} }}`);
  });

  it('keeps top-level permissions read-only', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('runs the publish job only for a tag push', () => {
    expect(workflow.jobs.publish?.if).toBe(TAG_GUARD);
  });

  it('gives the build job no more than package writes, and no persisted token', () => {
    expect(workflow.jobs.build?.permissions).toEqual({ contents: 'read', packages: 'write' });
    const checkout = workflow.jobs.build?.steps?.find((s) => s.uses?.startsWith('actions/checkout@')) as
      | (Step & { with?: Record<string, unknown> })
      | undefined;
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('logs in and pushes only on the tag path', () => {
    const build = workflow.jobs.build?.steps ?? [];
    const login = build.filter((s) => /docker login/.test(s.run ?? ''));
    expect(login.length).toBeGreaterThan(0);
    for (const s of login) expect(s.if).toBe("env.PUBLISH == 'true'");
    const upload = build.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe("env.PUBLISH == 'true'");
    const buildStep = build.find((s) => /docker buildx build/.test(s.run ?? ''));
    // The only push is the by-digest output chosen inside the PUBLISH branch.
    expect(buildStep?.run).toMatch(/if \[ "\$PUBLISH" = "true" \]; then\s+output="type=image,[^"]*push=true"\s+else\s+output="type=cacheonly"/);
    expect(buildStep?.run).not.toMatch(/--push\b/);
  });

  it('refuses a root/gateway version mismatch on every run, and a tag that differs from it', () => {
    const version = workflow.jobs.build?.steps?.find((s) => s.name === 'Version')?.run ?? '';
    expect(version).toMatch(/jq -r \.version package\.json/);
    expect(version).toMatch(/jq -r \.version bconnect-mcp-gateway\/package\.json/);
    // Unconditional: the first `if` compares the two files, not inside a PUBLISH branch.
    expect(version).toMatch(/^\s*if \[ "\$root" != "\$gateway" \]; then\s+echo "::error::[^\n]*\n\s+exit 1/m);
    expect(version.indexOf('"$root" != "$gateway"')).toBeLessThan(version.indexOf('$PUBLISH'));
    expect(version).toMatch(/if \[ "\$PUBLISH" = "true" \] && \[ "\$\{GITHUB_REF_NAME#v\}" != "\$root" \]; then\s+echo "::error::[^\n]*\n\s+exit 1/);
  });

  it('builds on pull requests that touch any workspace the Dockerfile builds', () => {
    const paths = (workflow.on.pull_request as { paths: string[] }).paths;
    expect(paths).toEqual(expect.arrayContaining(['packages/**', 'bconnect-server-template/**', 'bconnect-*-mcp/**', 'bconnect-mcp-gateway/**']));
    const workspaces = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { workspaces: string[] }).workspaces;
    const covered = (w: string): boolean =>
      paths.some((p) => new RegExp('^' + p.replace(/\*\*$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).test(`${w}/`));
    expect(workspaces.filter((w) => !covered(w))).toEqual([]);
  });

  it('publishes the same image name and tags as scripts/publish-image.sh', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'publish-image.sh'), 'utf8');
    const owner = script.match(/IMAGE_OWNER="\$\{IMAGE_OWNER:-([^}]+)\}"/)?.[1];
    const name = script.match(/IMAGE_NAME="\$\{IMAGE_NAME:-([^}]+)\}"/)?.[1];
    expect(workflow.env?.IMAGE).toBe(`ghcr.io/${owner}/${name}`);
    const tag = workflow.jobs.publish?.steps?.find((s) => /imagetools create/.test(s.run ?? ''))?.run ?? '';
    expect(tag).toMatch(/--tag "\$IMAGE:\$version"/);
    expect(tag).toMatch(/--tag "\$IMAGE:\$\{version%\.\*\}"/);
    expect(tag).toMatch(/--tag "\$IMAGE:latest"/);
  });

  it('attests the published image', () => {
    const attest = workflow.jobs.publish?.steps?.find((s) => s.uses?.startsWith('actions/attest-build-provenance@'));
    expect(attest).toBeDefined();
    expect(workflow.jobs.publish?.permissions).toMatchObject({ 'id-token': 'write', attestations: 'write' });
  });
});
