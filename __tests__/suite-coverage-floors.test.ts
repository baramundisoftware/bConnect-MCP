/**
 * Every workspace that pins a coverage floor is actually run by the jobs that
 * enforce floors.
 *
 * ── The defect class this exists to remove ──────────────────────────────────
 * A coverage floor is two things — a `thresholds` block in a workspace's
 * vitest.config.ts, and a loop somewhere that runs that workspace with
 * `--coverage`. Neither half errors when the other is missing. A config with
 * thresholds nobody executes reports nothing; a loop that skips a workspace
 * skips it silently.
 *
 * Both halves had failed, in the same shape, on the two workspaces where a
 * regression costs the most:
 *
 *   `bconnect-mcp-gateway` — the only component in this repo that listens on a
 *   socket — had no `thresholds` key at all, and both coverage loops iterate
 *   `bconnect-*-mcp`, a glob its name ends wrong for. Nothing anywhere
 *   enforced a floor on it.
 *
 *   `packages/mcp-core` — the kernel every server links against, holding
 *   path-guard, security-routes, parameter-redaction, serialize-outbound-trust,
 *   absent-data and count-only — had no vitest.config.ts whatsoever, and is
 *   not at the repo root, so the same glob could never have reached it either.
 *
 * This is the third time a `bconnect-*` glob has quietly excluded the gateway:
 * it was outside the npm `workspaces` array for the life of the project (see
 * suite-workspace-coverage.test.ts, where the same mechanism hid it from
 * `npm audit`), and then outside both coverage loops. Nobody excluded it
 * either time. A naming convention did, twice, in silence.
 *
 * ── Why this is a test and not a review habit ───────────────────────────────
 * The failure mode is a green build. Adding a sixteenth workspace, or renaming
 * one, cannot fail anything today — it just narrows what the ratchet sees.
 * Asserting the two halves against each other is the only way that shows up.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Restoring `for d in bconnect-*-mcp` in .github/workflows/ci.yml turns the
 * loop-coverage assertion red, naming bconnect-mcp-gateway and
 * packages/mcp-core; deleting the `thresholds` key from
 * packages/mcp-core/vitest.config.ts turns the floor assertion red. Both were
 * run and observed before this file was kept.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Workspace-relative directories holding a package.json, one and two deep. */
function packageDirs(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(REPO, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) { continue; }
    if (existsSync(join(REPO, entry.name, 'package.json'))) { found.push(entry.name); }
    const nested = join(REPO, entry.name);
    for (const sub of readdirSync(nested, { withFileTypes: true })) {
      if (!sub.isDirectory() || sub.name === 'node_modules') { continue; }
      if (existsSync(join(nested, sub.name, 'package.json'))) { found.push(`${entry.name}/${sub.name}`); }
    }
  }
  return found;
}

/**
 * A shell word from a `for d in …` list, as a matcher over workspace paths.
 * `*` stays inside one path segment, the way the shell's own glob does — which
 * is precisely why `bconnect-*-mcp` cannot reach `packages/mcp-core`.
 */
function shellWordToMatcher(word: string): (dir: string) => boolean {
  const rx = new RegExp(
    `^${word.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`
  );
  return (dir) => rx.test(dir);
}

/**
 * Resolve a repository file that may sit at the workspace root or one above it.
 *
 * `.github/workflows/ci.yml` legitimately has two homes, and this is not a
 * workaround. GitHub Actions reads workflows ONLY from the root of the
 * repository it is running in. This workspace IS the root of the published
 * repository, but only a subdirectory of the working one — so the same file is
 * `<workspace>/.github/…` after publication and `<workspace>/../.github/…`
 * here. Resolving one location only is how this guard would go on reporting a
 * clean figure for a file it had stopped opening.
 *
 * Neither location existing is a HARD FAILURE, never a skip.
 */
function resolveRepoFile(file: string): string {
  const candidates = [join(REPO, file), join(REPO, '..', file)];
  const hit = candidates.find((c) => existsSync(c));
  expect(
    hit,
    `${file} exists at none of: ${candidates.join(', ')} — this guard cannot ` +
      `check a file it cannot find, and passing quietly would be worse than failing`
  ).toBeDefined();
  return hit!;
}

/** The words of the first `for d in …; do` at or after an anchor line. */
function coverageLoopWords(file: string, anchor: string): string[] {
  const text = readFileSync(resolveRepoFile(file), 'utf8');
  const at = text.indexOf(anchor);
  // A missing anchor is a hard failure, not a skip: renaming the step must not
  // be a way to make this guard stop looking.
  expect(at, `${file} no longer contains the anchor "${anchor}" — the coverage ` +
    `loop moved or was renamed, and this guard cannot find what it is checking`).toBeGreaterThan(-1);
  const loop = /for\s+d\s+in\s+([^;\n]+)\s*;\s*do/.exec(text.slice(at));
  expect(loop, `${file} has no \`for d in …; do\` after "${anchor}"`).not.toBeNull();
  return loop![1].trim().split(/\s+/);
}

interface Floor { dir: string; statements: number; lines: number }

const floors: Floor[] = [];
/** Workspaces with a vitest.config.ts that declares no numeric floor. */
const unfloored: string[] = [];

beforeAll(async () => {
  for (const dir of packageDirs()) {
    const config = join(REPO, dir, 'vitest.config.ts');
    if (!existsSync(config)) { continue; }
    // Import rather than grep: `createServerVitestConfig` passes thresholds in
    // from vitest.shared.ts, so the word "thresholds" does not appear in a
    // server's own config file at all. Only the resolved object is the truth.
    const mod = (await import(`${pathToFileURL(config).href}?floors=1`)) as {
      default: { test?: { coverage?: { thresholds?: { statements?: number; lines?: number } } } };
    };
    const t = mod.default?.test?.coverage?.thresholds;
    if (typeof t?.statements !== 'number' || typeof t?.lines !== 'number') {
      unfloored.push(dir);
      continue;
    }
    floors.push({ dir, statements: t.statements, lines: t.lines });
  }
}, 60_000);

describe('coverage floors are declared and executed', () => {
  it('finds the workspaces it is supposed to be checking', () => {
    // A discovery bug that returned nothing would make every assertion below
    // vacuously true. Pin the shape: 13 servers plus the gateway plus the
    // kernel, and name the two the globs kept missing.
    const dirs = [...floors.map((f) => f.dir), ...unfloored];
    expect(dirs.length).toBeGreaterThanOrEqual(15);
    expect(dirs).toContain('bconnect-mcp-gateway');
    expect(dirs).toContain('packages/mcp-core');
  });

  it('every workspace with a vitest config pins a numeric floor', () => {
    expect(
      unfloored,
      `${unfloored.length} workspace(s) ship a vitest.config.ts with no numeric ` +
        `coverage.thresholds, so their coverage is measured and then discarded: ` +
        `${unfloored.join(', ')}`
    ).toEqual([]);
  });

  it('both coverage loops run every workspace that pins a floor', () => {
    const loops: { file: string; words: string[] }[] = [
      { file: '.github/workflows/ci.yml', words: coverageLoopWords('.github/workflows/ci.yml', 'coverage floors') },
      { file: 'scripts/ci-local.sh', words: coverageLoopWords('scripts/ci-local.sh', 'Coverage ratchet') },
    ];

    const missed: string[] = [];
    for (const { file, words } of loops) {
      const matchers = words.map(shellWordToMatcher);
      for (const { dir } of floors) {
        if (!matchers.some((m) => m(dir))) { missed.push(`${file} never reaches ${dir}`); }
      }
    }

    expect(
      missed,
      `${missed.length} workspace(s) pin a coverage floor that no job executes. A floor ` +
        `nothing runs is a comment:\n  ${missed.join('\n  ')}`
    ).toEqual([]);
  });
});
