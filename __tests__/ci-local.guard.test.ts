/**
 * CI hygiene (#337).
 *
 * - Every action in the workflows is pinned to a commit SHA, with the version
 *   in a comment; Dependabot moves both.
 * - scripts/ci-local.sh runs every command the blocking CI jobs run, so a
 *   local green run means what a CI green run means.
 * - No workflow step names a script or folder that doesn't exist (an installer
 *   step ran for months against a folder that wasn't there).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ROOT } from './lib/exerciser.js';

const WORKFLOWS = readdirSync(join(ROOT, '.github', 'workflows')).filter((f) => f.endsWith('.yml'));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const ci = read('.github/workflows/ci.yml');
const local = read('scripts/ci-local.sh');

interface Step { run?: string; uses?: string }
const jobs = (yaml.load(ci) as { jobs: Record<string, { steps?: Step[] }> }).jobs;
const runsOf = (job: string) => (jobs[job]?.steps ?? []).map((s) => s.run ?? '').filter(Boolean);

describe('actions are pinned', () => {
  it.each(WORKFLOWS)('%s: every uses: is a commit SHA with its version', (file) => {
    const uses = [...read(`.github/workflows/${file}`).matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map((m) => m[1].trim());
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((u) => !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(u))).toEqual([]);
  });
});

describe('scripts/ci-local.sh runs what CI runs', () => {
  /** The commands of the blocking jobs and the audit, as ci-local.sh must spell them. */
  const commands = [
    ...runsOf('gate').filter((r) => !/npm config set script-shell|^npm ci$/.test(r.trim())),
    ...runsOf('coverage').filter((r) => r.trim() !== 'npm ci'),
    'node scripts/mock-tier.mjs',
    'npm audit --audit-level=high',
  ].map((r) => r.trim().replace(/ HEAD\^1$/, '').replace(/ \$\{\{ matrix\.release \}\}$/, ''));

  it('found the commands it compares', () => {
    expect(commands).toEqual(expect.arrayContaining(['npm run build', 'npm run lint', 'scripts/check-new-casts.sh', 'npx vitest run', 'npm run test:coverage']));
  });

  it.each(commands)('runs `%s`', (command) => {
    expect(local).toContain(command);
  });

  it('runs the mock tier for both releases against the image CI pins', () => {
    expect(runsOf('mock').join('\n')).toContain('node scripts/mock-tier.mjs');
    expect(local).toMatch(/for release in 26r1 25r2/);
    expect(local).toContain("sed -n 's/^ *BCONNECT_MOCK_IMAGE: *//p' .github/workflows/ci.yml");
  });
});

describe('no step refers to a file that does not exist', () => {
  it.each(WORKFLOWS)('%s', (file) => {
    const text = read(`.github/workflows/${file}`);
    const paths = [...text.matchAll(/(?:^|[\s"'(])((?:scripts|__tests__|bconnect-[\w-]+|packages|install)\/[\w./-]+)/gm)]
      .map((m) => m[1].replace(/[.,:)]+$/, ''))
      .filter((p) => !p.includes('*'));
    expect(paths.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });
});
