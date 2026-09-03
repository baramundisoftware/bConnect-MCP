/**
 * The cache write must go somewhere else first, and be MOVED into place.
 *
 * ── Why this file exists, and why it mocks `node:fs` ────────────────────────
 * Atomicity is not observable from one process. `writeCacheFileSync` writing
 * in place and `writeCacheFileSync` writing a temp and renaming produce
 * byte-identical results to any single-threaded observer — same final content,
 * same mode, same absence of leftovers. Four consequence-level tests were
 * written first and **all four passed with the fix reverted**, which is the
 * vacuity trap this project keeps finding: assertions that hold equally in the
 * broken and fixed worlds.
 *
 * What is genuinely different is the MECHANISM, so that is what is asserted
 * here: the payload is written to a temporary path and renamed onto the target,
 * and the target itself is never handed to `writeFileSync`. A rename is atomic
 * on both platforms this ships to, which is the property that matters.
 *
 * ── The measurement behind it ───────────────────────────────────────────────
 * Two real processes writing a ~1 MB payload (the shape of the 37,571-entry
 * vulnerability library) while a third read in a tight loop:
 *
 *     before   reads 2311 · torn (invalid JSON) 52 · size-0 reads 9 · empty 44
 *     after    reads 2388 · torn            0 · size-0 reads 0 · empty  0
 *
 * Re-runnable as `node scripts/probe-cache-concurrency.mjs`. The safety half
 * was already sound and did not change: a torn read is invalid JSON, every
 * caller parses inside a try/catch, and the result is a refetch. Not once in
 * ~4,600 reads did two writers blend into something that parsed as valid JSON.
 * What the fix removes is the wasted refetching, not a wrong answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Recorded through the mock below. `vi.hoisted` because `vi.mock` is hoisted. */
const seen = vi.hoisted(() => ({ writes: [] as string[], renames: [] as Array<[string, string]> }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (path: unknown, data: unknown, opts: unknown) => {
      seen.writes.push(String(path));
      return (actual.writeFileSync as (...a: unknown[]) => unknown)(path, data, opts);
    },
    renameSync: (from: unknown, to: unknown) => {
      seen.renames.push([String(from), String(to)]);
      return (actual.renameSync as (...a: unknown[]) => unknown)(from, to);
    },
  };
});

const { writeCacheFileSync, readCacheFileSync } = await import('../modules/secure-disk-cache.js');

let root: string;
let dir: string;
let file: string;

beforeEach(() => {
  seen.writes.length = 0;
  seen.renames.length = 0;
  root = mkdtempSync(join(tmpdir(), 'bconnect-atomic-test-'));
  dir = join(root, 'bconnect-mcp');
  file = join(dir, 'vulnerability-library.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the cache write is atomic by construction', () => {
  it('writes a temporary file and renames it onto the target', () => {
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');

    expect(
      seen.renames.length,
      'no rename happened, so the payload was written straight onto the ' +
        'target — a reader can then observe a prefix of it'
    ).toBe(1);

    const [from, to] = seen.renames[0];
    expect(to).toBe(file);
    expect(from.startsWith(file)).toBe(true);
    expect(from.endsWith('.tmp')).toBe(true);
  });

  it('never writes directly to the target path', () => {
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');

    expect(
      seen.writes,
      'the target path was passed to writeFileSync, which truncates before it ' +
        'fills — the window this fix exists to remove'
    ).not.toContain(file);
    expect(seen.writes).toHaveLength(1);
    expect(seen.writes[0].endsWith('.tmp')).toBe(true);
  });

  it('still produces a readable cache — the mechanism did not break the result', () => {
    // The other half. A write that renames correctly but corrupts the payload
    // would satisfy both assertions above.
    const payload = JSON.stringify({ fetchedAt: 1, entries: Array.from({ length: 5_000 }, (_, i) => i) });
    writeCacheFileSync(dir, file, payload);

    const read = readCacheFileSync(dir, file);
    expect(read).toBe(payload);
    expect(JSON.parse(read!).entries).toHaveLength(5_000);
  });

  it('gives concurrent writers distinct temporary paths', () => {
    // Two writes from ONE process must not collide on the temp name either;
    // the counter in the module is what prevents it.
    writeCacheFileSync(dir, file, '{"fetchedAt":1}');
    writeCacheFileSync(dir, file, '{"fetchedAt":2}');

    expect(seen.renames).toHaveLength(2);
    expect(seen.renames[0][0]).not.toBe(seen.renames[1][0]);
  });
});
