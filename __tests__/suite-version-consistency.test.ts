/**
 * Every package and every server reports the same version.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `bconnect-groups-mcp` sat at `26.1.8` while the other fourteen packages said
 * `26.1.7`. The obvious reading — that groups was bumped by mistake — is the
 * wrong one: **ten READMEs already tell users these surface changes shipped in
 * 26.1.8**, in sentences like "Renamed in 26.1.8 (breaking)" and "Surface
 * change in 26.1.8". The documentation was right about what shipped and the
 * manifests were wrong, so the suite was unified UP, not groups reverted down.
 *
 * That is also what made the drift dangerous rather than untidy: a caller
 * pinning `26.1.7` got a server whose tool surface matched the 26.1.8 README,
 * and `tools/list` reported a version whose migration notes did not apply.
 *
 * ── Deliberate exemption ────────────────────────────────────────────────────
 * `packages/mcp-core` stays at `0.0.0`. It is private, unpublished and consumed
 * only through the workspace, so it has no release identity to keep in step —
 * versioning it would imply a package anyone could install at that version.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Versioned independently on purpose — see the header. */
const EXEMPT = new Set(['packages/mcp-core']);

function packageDirs(): string[] {
  const dirs = ['.', 'bconnect-mcp-gateway', 'bconnect-server-template',
    ...readdirSync(REPO).filter((d) => /^bconnect-[a-z]+-mcp$/.test(d))];
  return dirs.filter((d) => existsSync(join(REPO, d, 'package.json')));
}

function versionOf(dir: string): string {
  return (JSON.parse(readFileSync(join(REPO, dir, 'package.json'), 'utf8')) as { version: string }).version;
}

describe('version consistency', () => {
  const dirs = packageDirs().filter((d) => !EXEMPT.has(d));

  it('finds the packages it is checking', () => {
    // Guards against a directory-walk bug making every assertion vacuous.
    expect(dirs.length).toBeGreaterThanOrEqual(15);
    expect(dirs).toContain('bconnect-groups-mcp');
  });

  it('every package.json declares the same version', () => {
    const byVersion = new Map<string, string[]>();
    for (const d of dirs) {
      const v = versionOf(d);
      if (!byVersion.has(v)) { byVersion.set(v, []); }
      byVersion.get(v)!.push(d);
    }
    expect(
      [...byVersion.keys()],
      `packages disagree on the version: ${JSON.stringify(Object.fromEntries(byVersion), null, 1)}`
    ).toHaveLength(1);
  });

  it('each server reports its own package version to tools/list', () => {
    // A server whose createServer() literal drifts from its manifest tells the
    // client one version while npm says another — which is how this started.
    const mismatched: string[] = [];
    for (const d of dirs) {
      const idx = join(REPO, d, 'src', 'index.ts');
      if (!existsSync(idx)) { continue; }
      const src = readFileSync(idx, 'utf8');
      const m = src.match(/version:\s*"([\d.]+)"/) ?? src.match(/const SERVER_VERSION = "([\d.]+)"/);
      if (!m) { continue; }
      if (m[1] !== versionOf(d)) { mismatched.push(`${d}: manifest ${versionOf(d)} vs server ${m[1]}`); }
    }
    expect(mismatched, mismatched.join(' · ')).toEqual([]);
  });

  it('the READMEs that name a shipped version agree with the manifests', () => {
    // Ten READMEs describe the breaking surface change by version number. If
    // the suite is bumped again these have to move with it, or a user reads
    // migration notes for a version they are not running.
    const suite = versionOf('.');
    const stale: string[] = [];
    for (const d of dirs) {
      const readme = join(REPO, d, 'README.md');
      if (!existsSync(readme)) { continue; }
      const text = readFileSync(readme, 'utf8');
      // "Surface change in X" / "Renamed in X (breaking)" — a claim about what
      // this package currently ships, as opposed to prose about older releases.
      for (const m of text.matchAll(/(?:Surface change in|Renamed in)\s+`?(\d+\.\d+\.\d+)`?/g)) {
        if (m[1] !== suite) { stale.push(`${d}: README says ${m[1]}, suite is ${suite}`); }
      }
    }
    expect(stale, stale.join(' · ')).toEqual([]);
  });
});
