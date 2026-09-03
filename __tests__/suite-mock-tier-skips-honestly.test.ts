/**
 * A mock-integration test may not report success for a run it never made.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The tier skips when no mock answers. Doing that with a bare `return` makes
 * vitest count the test as a PASS, so a run against an absent mock reports
 * success having asserted nothing. That is upstream finding QA-57, and it was
 * fixed — in two servers of thirteen, in two different spellings, and never
 * propagated. Measured 2026-08-22 with the mock unreachable:
 *
 *     assets-mcp       Tests  4 passed (4)      <- asserted nothing
 *     endpoints-mcp    Tests  4 skipped (4)     <- the one honest server
 *
 * Eleven servers shipped a `helpers.ts` whose own header says "They now call
 * ctx.skip(), so the report says skipped" while their tests did the opposite.
 * The instance was fixed; the class never was — the same shape as the PATCH
 * media type, where the one method with a documented history set the header and
 * the twenty-one beside it did not.
 *
 * ── Why it strips comments before judging ───────────────────────────────────
 * Two of these files DESCRIBE the old pattern in their headers, quoting the
 * very line they no longer contain. A guard that greps raw source flags them
 * and is then "fixed" by deleting the explanation — the worst outcome. Earlier
 * the same day, `gateway-launchers-preload` matched `process.env.VITEST` inside
 * a comment and a mutation survived because of it. Comments are prose about the
 * mechanism; only code is the mechanism.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** Source with comments removed. See the header. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Source with the lifecycle hooks removed.
 *
 * A bare `return` inside `beforeAll` is CORRECT — it abandons setup when there
 * is no mock to set anything up against, and every server does it. Only a
 * return inside an `it()` is the defect, because only there does vitest turn it
 * into a reported pass.
 *
 * The first draft of this guard did not make that distinction and flagged the
 * one file whose `beforeAll` returns on the line after the `if` (the others
 * happen to log first, which hid the difference). Deleting that legitimate
 * return to satisfy the guard would have been the wrong repair, so the guard
 * learned the distinction instead. Braces are counted rather than matched with
 * a regex: hook bodies contain both braces and strings, and a regex that tries
 * to span them is the kind of instrument that answers a question it cannot see.
 */
function withoutHooks(source: string): string {
  const HOOKS = /\b(?:beforeAll|beforeEach|afterAll|afterEach)\s*\(/g;
  let out = source;
  for (;;) {
    HOOKS.lastIndex = 0;
    const match = HOOKS.exec(out);
    if (!match) {return out;}
    let depth = 0;
    let i = match.index + match[0].length - 1; // at the '('
    for (; i < out.length; i++) {
      if (out[i] === '(') {depth++;}
      else if (out[i] === ')') {
        depth--;
        if (depth === 0) {break;}
      }
    }
    if (i >= out.length) {return out;} // unbalanced; leave it alone
    out = out.slice(0, match.index) + out.slice(i + 1);
  }
}

interface TierFile {
  workspace: string;
  file: string;
  body: string;
  declaredTests: number;
}

/** Every workspace carrying a mock tier, discovered — never listed. */
function tierFiles(): TierFile[] {
  const found: TierFile[] = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^bconnect-.*-mcp$/.test(entry.name)) {continue;}
    const dir = join(ROOT, entry.name, 'src', '__tests__', 'mock-integration');
    if (!existsSync(dir)) {continue;}
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.mock.test.ts')) {continue;}
      const raw = readFileSync(join(dir, file), 'utf8');
      found.push({
        workspace: entry.name,
        file: `${entry.name}/src/__tests__/mock-integration/${file}`,
        body: code(raw),
        declaredTests: (code(raw).match(/^\s*it\(/gm) ?? []).length,
      });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

describe('the mock tier cannot report a pass it did not earn', () => {
  const files = tierFiles();

  it('finds the tier at all — the canary', () => {
    // Counted a second way and required to agree: a scan that silently stopped
    // finding files would make every assertion below pass over nothing.
    expect(
      files.length,
      'no mock-integration test files were found — the scan is broken'
    ).toBeGreaterThanOrEqual(14);

    const declared = files.reduce((n, f) => n + f.declaredTests, 0);
    expect(
      declared,
      'the tier declares almost no tests — either the files are empty or `it(` ' +
        'is no longer how they are written'
    ).toBeGreaterThanOrEqual(60);
  });

  it('has no test that skips with a bare return', () => {
    const offenders: string[] = [];
    for (const f of files) {
      // `if (!available) {return;}` in any spacing — but only OUTSIDE the
      // lifecycle hooks, where a bare return is legitimate. See withoutHooks.
      if (/if \(\s*![^)]*\)\s*\{?\s*return;/.test(withoutHooks(f.body))) {
        offenders.push(f.file);
      }
    }
    expect(
      offenders,
      'vitest counts a returning test as PASSED, so these files would report ' +
        'success against an absent mock having asserted nothing. Use ' +
        'ctx.skip() — see docs/MOCK_INTEGRATION_TESTING.md.'
    ).toEqual([]);
  });

  it('every tier file actually calls ctx.skip()', () => {
    // The other half. Removing the bare returns without adding a skip would
    // satisfy the assertion above and run the tests against no mock, which
    // fails confusingly instead of reporting honestly.
    const silent = files.filter((f) => !/ctx\.skip\(/.test(f.body)).map((f) => f.file);
    expect(
      silent,
      'these tier files never call ctx.skip(), so they cannot report a skip'
    ).toEqual([]);
  });

  it('every workspace with a tier can actually run it', () => {
    const broken: string[] = [];
    for (const ws of new Set(files.map((f) => f.workspace))) {
      if (!existsSync(join(ROOT, ws, 'vitest.mock.config.ts'))) {
        broken.push(`${ws}: no vitest.mock.config.ts`);
        continue;
      }
      const pkg = JSON.parse(readFileSync(join(ROOT, ws, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      if (!pkg.scripts?.['test:mock']) {
        broken.push(`${ws}: no test:mock script`);
      }
    }
    expect(
      broken,
      'a tier nobody can invoke is not a tier'
    ).toEqual([]);
  });

  it('the required-mock gate still exists for CI to use', () => {
    // Without this, "the mock never started" and "the tier passed" exit alike.
    const setup = join(ROOT, 'vitest.mock.globalsetup.ts');
    expect(existsSync(setup), 'vitest.mock.globalsetup.ts is gone').toBe(true);

    const body = code(readFileSync(setup, 'utf8'));
    expect(
      /BCONNECT_MOCK_REQUIRED/.test(body),
      'the global setup no longer reads BCONNECT_MOCK_REQUIRED'
    ).toBe(true);
    expect(
      /throw new Error/.test(body),
      'the global setup no longer refuses to run when the mock is absent'
    ).toBe(true);

    // And that the shared config still wires it in — a gate nothing loads is
    // a gate that does not exist.
    const shared = code(readFileSync(join(ROOT, 'vitest.mock.shared.ts'), 'utf8'));
    expect(
      /globalSetup/.test(shared),
      'vitest.mock.shared.ts no longer registers the global setup'
    ).toBe(true);
  });
});
