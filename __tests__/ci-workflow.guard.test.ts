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
import { existsSync, globSync, readFileSync } from 'node:fs';
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

/** Scripts of the root manifest, or of the workspace named by `-w`/`--workspace`. */
function scriptsOf(workspace: string | undefined): Record<string, string> {
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!workspace) return rootManifest.scripts ?? {};
  for (const pattern of rootManifest.workspaces ?? []) {
    for (const dir of globSync(pattern, { cwd: ROOT })) {
      const manifestPath = join(ROOT, dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name === workspace || dir === workspace) return manifest.scripts ?? {};
    }
  }
  return {};
}

/** Every `npm run …` command in a `run:` step of any job. */
function npmRunCommands(): Array<{ job: string; command: string }> {
  return Object.entries(workflow.jobs).flatMap(([job, def]) =>
    (def.steps ?? []).flatMap((step) =>
      (step.run ?? '').split(/\r?\n|&&|;/).map((c) => c.trim())
        .filter((c) => /^npm run\s/.test(c))
        .map((command) => ({ job, command })),
    ),
  );
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
  const commands = npmRunCommands();

  it('finds the npm run steps (self-check)', () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  it('never uses --if-present (a missing script would pass silently)', () => {
    expect(commands.filter((c) => /--if-present/.test(c.command))).toEqual([]);
  });

  it('names only scripts that exist in the root or the named workspace', () => {
    const missing = commands.filter(({ command }) => {
      const words = command.split(/\s+/);
      const script = words[2];
      const wsFlag = words.findIndex((w) => w === '-w' || w === '--workspace');
      const workspace = wsFlag >= 0 ? words[wsFlag + 1] : undefined;
      return !(script in scriptsOf(workspace));
    });
    expect(missing).toEqual([]);
  });

  it('runs lint in the gate job', () => {
    expect(commands.some((c) => c.job === 'gate' && /^npm run lint\b/.test(c.command))).toBe(true);
  });
});
