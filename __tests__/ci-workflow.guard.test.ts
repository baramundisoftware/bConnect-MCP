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
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
