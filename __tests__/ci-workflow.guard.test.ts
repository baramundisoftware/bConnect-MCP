/**
 * CI workflow guard (REQ-CI-001).
 *
 * `main` requires the `gate` job's checks by NAME (ruleset "main protection").
 * Three properties of ci.yml keep that gate usable, and each broke once:
 *
 * 1. `push` runs on `main` only. With `push` on every branch plus `pull_request`,
 *    each PR commit ran the whole matrix twice.
 * 2. No job-level `continue-on-error`. It lets the run pass while the job's
 *    check stays red, so every PR showed a red mark nobody had to act on.
 *    Reporting jobs turn a failed measurement into a warning instead.
 * 3. The required check names are written down in ci.yml and match the names
 *    the matrix produces. A renamed job or changed matrix otherwise leaves PRs
 *    waiting for a check that never arrives. The ruleset itself can't be read
 *    offline, so this pins the list the ruleset was set from.
 * 4. Every `npm run <script>` names a script that exists, and none uses
 *    `--if-present`. The Lint step ran `npm run lint --if-present` against a root
 *    without a `lint` script, so lint never ran while the step stayed green
 *    (REQ-QA-002 AC 4).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI_PATH = join(ROOT, '.github', 'workflows', 'ci.yml');
const text = readFileSync(CI_PATH, 'utf8');

interface Job {
  name?: string;
  'continue-on-error'?: unknown;
  strategy?: { matrix?: Record<string, unknown[]> };
  steps?: Array<{ run?: string }>;
}
interface Workflow {
  // js-yaml reads the bare key `on` as the string "on" (YAML 1.2 core schema).
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
}
const workflow = yaml.load(text) as Workflow;

const BEGIN = '# required-checks:begin';
const END = '# required-checks:end';

/** The check names listed between the marker comments in ci.yml. */
function documentedRequiredChecks(): string[] {
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex((l) => l.trim() === BEGIN);
  const end = lines.findIndex((l) => l.trim() === END);
  if (begin < 0 || end < begin) return [];
  return lines
    .slice(begin + 1, end)
    .map((l) => l.trim().match(/^#\s*-\s*(.+)$/)?.[1]?.trim())
    .filter((n): n is string => Boolean(n));
}

/** The check names the `gate` job produces: its name template over the matrix. */
function derivedGateChecks(): string[] {
  const gate = workflow.jobs.gate;
  const matrix = gate?.strategy?.matrix ?? {};
  const keys = Object.keys(matrix).filter((k) => Array.isArray(matrix[k]));
  let combos: Record<string, string>[] = [{}];
  for (const key of keys) {
    combos = combos.flatMap((c) => matrix[key].map((v) => ({ ...c, [key]: String(v) })));
  }
  return combos.map((c) =>
    (gate?.name ?? '').replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, k: string) => c[k] ?? `<${k}?>`),
  );
}

interface Manifest { name?: string; scripts?: Record<string, string>; workspaces?: string[] }
const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));

/** Workspace directories, from the root `workspaces` patterns (`*` within one path segment). */
function workspaceDirs(): string[] {
  const expand = (base: string, parts: string[]): string[] => {
    if (!parts.length) return existsSync(join(ROOT, base, 'package.json')) ? [base] : [];
    const [head, ...rest] = parts;
    const re = new RegExp('^' + head.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    const dir = join(ROOT, base);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && re.test(e.name))
      .flatMap((e) => expand(base ? `${base}/${e.name}` : e.name, rest));
  };
  return (readManifest('').workspaces ?? []).flatMap((pattern) => expand('', pattern.split('/')));
}

interface NpmRun { job: string; command: string; script: string; workspace?: string; allWorkspaces: boolean }

/**
 * Every npm script invocation in a `run:` step of any job, wherever it sits in
 * the line (`if npm run x; then`, `npm -w pkg run x`, `--workspace=pkg`, `-ws`).
 */
function npmRuns(): NpmRun[] {
  return Object.entries(workflow.jobs).flatMap(([job, def]) =>
    (def.steps ?? []).flatMap((step) =>
      (step.run ?? '').split(/\r?\n|&&|\|\||;|\|/).flatMap((segment): NpmRun[] => {
        const words = segment.trim().split(/\s+/);
        const npm = words.indexOf('npm');
        if (npm < 0) return [];
        const args = words.slice(npm + 1);
        const run = args.findIndex((w) => w === 'run' || w === 'run-script');
        if (run < 0) return [];
        let workspace: string | undefined;
        args.forEach((w, i) => {
          if (w === '-w' || w === '--workspace') workspace = args[i + 1];
          else if (w.startsWith('--workspace=')) workspace = w.slice('--workspace='.length);
        });
        const script = args.slice(run + 1).find((w) => !w.startsWith('-')) ?? '';
        const allWorkspaces = args.some((w) => w === '-ws' || w === '--workspaces');
        return [{ job, command: segment.trim(), script, workspace, allWorkspaces }];
      }),
    ),
  );
}

/** Where the script is missing: the root, the named workspace, or any workspace for `-ws`. */
function missingScript(r: NpmRun): boolean {
  const has = (m: Manifest): boolean => r.script in (m.scripts ?? {});
  const dirs = workspaceDirs();
  if (r.allWorkspaces) return dirs.some((d) => !has(readManifest(d)));
  if (!r.workspace) return !has(readManifest(''));
  const dir = dirs.find((d) => d === r.workspace || readManifest(d).name === r.workspace);
  return !dir || !has(readManifest(dir));
}

describe('ci.yml — REQ-CI-001', () => {
  it('runs on push to main only, and still on pull_request and workflow_dispatch', () => {
    const push = workflow.on.push as { branches?: unknown } | undefined;
    expect(push?.branches).toEqual(['main']);
    expect(workflow.on).toHaveProperty('pull_request');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('has no job-level continue-on-error (it leaves a red check behind a passing run)', () => {
    const offenders = Object.entries(workflow.jobs)
      .filter(([, job]) => job['continue-on-error'] !== undefined)
      .map(([id]) => id);
    expect(offenders).toEqual([]);
  });

  it('documents the required checks, and they match the gate matrix', () => {
    const derived = derivedGateChecks();
    expect(derived).toHaveLength(4);
    expect(documentedRequiredChecks().sort()).toEqual([...derived].sort());
  });
});

describe('ci.yml — every npm script a step runs exists (REQ-QA-002)', () => {
  const runs = npmRuns();
  const allRunText = Object.values(workflow.jobs).flatMap((j) => (j.steps ?? []).map((st) => st.run ?? '')).join('\n');

  it('finds the npm script steps, including the workspace build (self-check)', () => {
    expect(runs.some((r) => r.script === 'build' && r.workspace === '@bconnect/mcp-core')).toBe(true);
    expect(workspaceDirs()).toContain('packages/mcp-core');
  });

  it('never uses --if-present anywhere (a missing script would pass silently)', () => {
    expect(allRunText).not.toMatch(/--if-present/);
  });

  it('names only scripts that exist in the root or the named workspace(s)', () => {
    expect(runs.filter(missingScript).map((r) => `${r.job}: ${r.command}`)).toEqual([]);
  });

  it('runs lint in the gate job', () => {
    expect(runs.some((r) => r.job === 'gate' && r.script === 'lint' && !r.workspace)).toBe(true);
  });
});
