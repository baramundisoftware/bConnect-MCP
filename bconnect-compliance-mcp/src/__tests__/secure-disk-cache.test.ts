/**
 * secure-disk-cache — regression tests for finding SEC-5.
 *
 * The two composite tools persist cached state to a fixed path under the shared
 * system temp directory. Before this hardening the read path was a bare
 * JSON.parse plus a freshness check, so a file another user planted was served
 * as authoritative for the whole TTL — and for the vulnerability library that
 * means "aboveThreshold: 0", which reads as a clean estate.
 *
 * The ownership and permission-bit assertions are POSIX-only by construction:
 * Windows has no process.getuid and lstat reports synthetic mode bits there.
 * The file-type and round-trip assertions run everywhere.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Stats } from 'node:fs';
import { prepareCacheDir, readCacheFileSync, writeCacheFileSync, inspectWith, type PlatformOps } from '../modules/secure-disk-cache.js';

const isPosix = typeof process.getuid === 'function';

let root: string;
let dir: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bconnect-cache-test-'));
  dir = join(root, 'bconnect-mcp');
  file = join(dir, 'vulnerability-library.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('secure-disk-cache', () => {
  it('round-trips a cache file it wrote itself', () => {
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');
    expect(readCacheFileSync(dir, file)).toBe('{"fetchedAt":1}');
  });

  it('returns null for an absent cache without warning (the ordinary cold path)', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(readCacheFileSync(dir, file)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses to read a cache path that is not a regular file', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(file, { recursive: true }); // a directory where the file should be
    expect(readCacheFileSync(dir, file)).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toMatch(/not a regular file/);
  });

  it('prepareCacheDir refuses a cache directory that is not a directory', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(dir, 'not a directory', 'utf8');
    expect(prepareCacheDir(dir)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it.skipIf(!isPosix)('creates the directory 0700 and the file 0600', () => {
    writeCacheFileSync(dir, file, '{}');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it.skipIf(!isPosix)('refuses to read a group- or world-writable cache file', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');
    chmodSync(file, 0o666); // as a planted file would be
    expect(readCacheFileSync(dir, file)).toBeNull();
    expect(String(warn.mock.calls[0][0])).toMatch(/group- or world-writable/);
  });

  it.skipIf(!isPosix)('re-asserts 0600 when writing over a loosened file', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');
    chmodSync(file, 0o666);
    writeCacheFileSync(dir, file, '{"fetchedAt":2}');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readCacheFileSync(dir, file)).toBe('{"fetchedAt":2}');
  });

  it.skipIf(!isPosix)('refuses to read through a world-writable cache directory', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');
    chmodSync(dir, 0o777);
    expect(readCacheFileSync(dir, file)).toBeNull();
    expect(String(warn.mock.calls[0][0])).toMatch(/group- or world-writable/);
  });

  // ── Finding B5 ──────────────────────────────────────────────────────────
  // The four tests above are the real POSIX end-to-end coverage, and they
  // only run on a POSIX host (they are it.skipIf(!isPosix) — on this Windows
  // host they never execute, and the ownership/mode-bit hardening they cover
  // has never actually run in this suite). inspectWith() is the injection
  // seam that lets the SAME branch logic — the ownership comparison and the
  // SHARED_WRITE_BITS mask — be driven with synthetic POSIX stats on ANY
  // host, including this one. These tests fail without the seam (inspectWith
  // did not exist) and pass with it, on Windows, proving the decision logic
  // itself is correct even though a Linux runner is still required to prove
  // that real lstatSync() output feeds it correctly end-to-end.
  describe('ownership/mode-bit decision logic (platform-injected, runs on any host)', () => {
    function fakeStat(overrides: Partial<Stats> & { uid: number; mode: number }): Stats {
      return {
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false,
        ...overrides,
      } as Stats;
    }

    function platformWith(stat: Stats, uid = 1000): PlatformOps {
      return {
        lstat: () => stat,
        getuid: () => uid,
        isPosix: true,
      };
    }

    it('accepts a file owned by us with owner-only mode bits', () => {
      const stat = fakeStat({ uid: 1000, mode: 0o600 });
      expect(inspectWith(platformWith(stat, 1000), '/fake/path', 'file')).toBeNull();
    });

    it('refuses a file owned by a different uid', () => {
      const stat = fakeStat({ uid: 999, mode: 0o600 });
      expect(inspectWith(platformWith(stat, 1000), '/fake/path', 'file')).toMatch(/owned by uid 999/);
    });

    it('refuses a file that is group- or world-writable, even when we own it', () => {
      const stat = fakeStat({ uid: 1000, mode: 0o666 });
      expect(inspectWith(platformWith(stat, 1000), '/fake/path', 'file')).toMatch(/group- or world-writable/);
    });

    it('refuses a symlink before any ownership/mode check runs', () => {
      const stat = fakeStat({ uid: 1000, mode: 0o600, isSymbolicLink: () => true });
      expect(inspectWith(platformWith(stat, 1000), '/fake/path', 'file')).toMatch(/symlink/);
    });

    it('skips ownership/mode checks entirely when platform.isPosix is false', () => {
      const stat = fakeStat({ uid: 999, mode: 0o666 });
      const platform: PlatformOps = { lstat: () => stat, getuid: () => 1000, isPosix: false };
      // Would fail both the uid and the shared-write-bits check if POSIX
      // branches ran; must pass through untouched, matching this repo's
      // documented Windows behaviour.
      expect(inspectWith(platform, '/fake/path', 'file')).toBeNull();
    });

    it('reports "absent" when lstat throws, regardless of platform', () => {
      const platform: PlatformOps = {
        lstat: () => {
          throw new Error('ENOENT');
        },
        getuid: () => 1000,
        isPosix: true,
      };
      expect(inspectWith(platform, '/fake/path', 'file')).toBe('absent');
    });
  });
});

describe('the write lands whole, or not at all (concurrency, 2026-08-23)', () => {
  /**
   * The write used to be `writeFileSync` straight onto the target, which
   * truncates first and fills afterwards. Measured with two real processes
   * writing ~1 MB while a third read in a loop:
   *
   *     before   reads 2311 · torn (invalid JSON) 52 · size-0 reads 9 · empty reads 44
   *     after    reads 2388 · torn            0 · size-0 reads 0 · empty reads 0
   *
   * `scripts/probe-cache-concurrency.mjs` is that measurement, kept runnable.
   *
   * BE CLEAR ABOUT WHAT THESE FOUR PROVE, because it is less than it looks:
   * all four passed with the fix REVERTED. Atomicity is not observable from a
   * single process — an in-place write and a temp+rename leave an identical
   * final file. They are regression cover for the RESULT (exact content, no
   * residue, correct mode). The mechanism that actually provides atomicity is
   * asserted in `secure-disk-cache-atomicity.test.ts`, where reverting the fix
   * kills three of four tests.
   */

  it('leaves no temporary file behind after a successful write', () => {
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');

    const leftovers = readdirSync(dir).filter((n) => n.endsWith('.tmp'));
    expect(
      leftovers,
      'a temp file that survives the write accumulates one per write, in a ' +
        'directory the cache also scans'
    ).toEqual([]);
  });

  it('replaces a larger cache with a smaller one exactly, leaving no tail', () => {
    const big = JSON.stringify({ fetchedAt: 1, pad: 'x'.repeat(50_000) });
    const small = '{"fetchedAt":2}';

    writeCacheFileSync(dir, file, big);
    writeCacheFileSync(dir, file, small);

    const read = readCacheFileSync(dir, file);
    expect(read).toBe(small);
    // The tail of the previous, longer payload must not survive the rename.
    expect(read?.length).toBe(small.length);
    expect(JSON.parse(read!)).toEqual({ fetchedAt: 2 });
  });

  it('round-trips a payload the size of the real vulnerability library', () => {
    // The library is 37,571 entries; a partial write of something this size is
    // what produced the torn reads, so the round-trip is asserted at scale
    // rather than on a 15-byte fixture.
    const entries = Array.from({ length: 20_000 }, (_, i) => [`id-${i}`, { cve: `CVE-2026-${i}` }]);
    const payload = JSON.stringify({ fetchedAt: Date.now(), entries });

    writeCacheFileSync(dir, file, payload);
    const read = readCacheFileSync(dir, file);

    expect(read).not.toBeNull();
    expect(read!.length).toBe(payload.length);
    expect(JSON.parse(read!).entries).toHaveLength(20_000);
  });

  it('a half-written file is refused by the caller rather than believed', () => {
    // What a torn read looked like before the fix. The cache layer hands the
    // bytes back — it is not a JSON parser — and every caller parses inside a
    // try/catch, so the outcome is a refetch. This pins that the truncated
    // form is genuinely unparseable, which is why the safe path is taken.
    const payload = JSON.stringify({ fetchedAt: 1, entries: Array.from({ length: 500 }, (_, i) => i) });
    writeCacheFileSync(dir, file, payload);
    writeFileSync(file, payload.slice(0, Math.floor(payload.length / 2)), 'utf8');

    const read = readCacheFileSync(dir, file);
    expect(read).not.toBeNull();
    expect(() => JSON.parse(read!)).toThrow();
  });

  it.skipIf(!isPosix)('the file still lands owner-only through the rename', () => {
    // The mode is set on the TEMP and must survive the move; a rename that
    // reset it would widen the file this hardening exists to narrow.
    //
    // OBSERVED 2026-08-25, and worth recording because it was an open gap for
    // two days. This is the fifth POSIX-only skip in this file and the only one
    // the atomic-write change added, so the security-relevant half of that
    // change — the file landing 0600 after a rename rather than before a write
    // — could not be exercised on the Windows host it was written on.
    //
    // The Linux CI runners settled it: 2,717 passed and NOTHING skipped, where
    // the same commit on Windows reports 2,712 passed and 5 skipped. The mode
    // does survive the rename. Until that run it was only expected to.
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
