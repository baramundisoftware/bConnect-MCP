/**
 * The generated types must be a pure function of the shipped 26R1 specs.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * There was no `npm run generate` until this change — CONTRIBUTING.md said so —
 * so `src/generated/*-types.ts` was refreshed by hand, one `npx openapi-typescript`
 * at a time. The predictable happened:
 *
 *   - Ten of the twenty-two generated files were behind the 26R1 specs the suite
 *     targets. `bconnect-groups-mcp` and `bconnect-jobs-mcp` still declared the
 *     five `IndustrialEndpoints` routes 26R1 deleted, and did not declare the
 *     three `UnmanagedEndpoints` routes 26R1 added.
 *   - Vendored copies of the same module diverged from each other:
 *     `bconnect-jobs-mcp/src/generated/software-types.ts` was 389 lines against
 *     the real 1,679 — a subset nobody had noticed was a subset.
 *   - `bconnect-assets-mcp/src/generated/assets-types.ts` was HAND-WRITTEN in
 *     the emitter's house style. It carried no `paths` and no `operations`, so
 *     every assets tool had no machine-checkable contract at all, and it
 *     declared a schema name (`JsonPatchOperation`) the API does not have.
 *
 * Regenerating once fixes that once. This test is what stops it happening
 * again: it re-runs the generator in-process and compares bytes, so a stale
 * file fails `npm test` instead of surviving to the next release.
 *
 * It is deliberately a byte comparison rather than a structural one. A
 * structural check would let prose drift accumulate — and the prose is what
 * `packages/mcp-core`'s declaration layer reads to decide whether a parameter
 * description can be derived at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderAll,
  manifestTargets,
  RELEASE,
// @ts-expect-error — generate-types.mjs is untyped build tooling, not product
} from '../scripts/generate-types.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `*-types.ts` under any server's `src/generated/`, repo-relative, sorted. */
function generatedTypeFilesOnDisk(): string[] {
  const out: string[] = [];
  for (const server of readdirSync(REPO_ROOT).filter((d) => /^bconnect-/.test(d))) {
    const dir = join(REPO_ROOT, server, 'src', 'generated');
    if (!existsSync(dir)) {continue;}
    for (const f of readdirSync(dir)) {
      // Scoped to `*-types.ts`. Servers may also generate other artefacts into
      // `src/generated/` (bconnect-endpoints-mcp emits an operation index there
      // from its own script); those have their own generator and are not this
      // test's business.
      if (f.endsWith('-types.ts')) {out.push(relative(REPO_ROOT, join(dir, f)).replace(/\\/g, '/'));}
    }
  }
  return out.sort();
}

describe(`generated types are a fresh render of openapi-specs/${RELEASE}`, () => {
  it('regenerates byte-identically from the shipped specs', async () => {
    const rendered = await renderAll({ repoRoot: REPO_ROOT });
    const stale: string[] = [];

    for (const [target, expected] of rendered) {
      const abs = resolve(REPO_ROOT, target);
      const actual = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
      if (actual === expected) {continue;}
      stale.push(
        actual === null
          ? `${target}: missing`
          : `${target}: ${actual.length} B on disk vs ${expected.length} B regenerated`
      );
    }

    expect(
      stale,
      `Stale generated types. Run \`npm run generate\`.\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });

  it('the files on disk are exactly the ones the MANIFEST claims', async () => {
    // Without this, a generated file for a module that was dropped from the
    // MANIFEST would keep compiling against a spec nobody regenerates — the
    // silent-subset failure mode described at the top of this file, one level up.
    expect(generatedTypeFilesOnDisk()).toEqual(manifestTargets());
  });

  it(`ships exactly one spec directory, ${RELEASE}`, () => {
    // 25R2 is no longer supported. Its spec directory was deleted along with
    // the release-gating machinery; a second directory reappearing means the
    // dual-release drift is back.
    const dirs = readdirSync(resolve(REPO_ROOT, 'openapi-specs'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([RELEASE]);
  });

  it('every spec the MANIFEST references is present', async () => {
    // Guards the other direction: a spec deleted from openapi-specs/26R1 would
    // otherwise surface as a confusing emitter error rather than a named file.
    const { MANIFEST } = (await import(
      // @ts-expect-error — untyped build tooling, see the import at the top
      '../scripts/generate-types.mjs'
    )) as { MANIFEST: Array<{ spec: string }> };
    const specDir = resolve(REPO_ROOT, 'openapi-specs', RELEASE);
    const missing = [...new Set(MANIFEST.map((e: { spec: string }) => e.spec))].filter(
      (s) => !existsSync(join(specDir, s))
    );
    expect(missing).toEqual([]);
  });
});
