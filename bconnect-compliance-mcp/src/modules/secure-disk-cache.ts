/**
 * Hardened primitives for the two composite tools that persist cached state to
 * the shared system temp directory (upstream finding SEC-5).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `exposure.ts` and `scan-recency.ts` both wrote their cache with a bare
 * `mkdirSync(..., {recursive:true})` + `writeFileSync(..., 'utf8')` — no mode
 * argument, so the directory and file landed at the process umask (typically
 * 0755/0644) at a fixed, predictable, unauthenticated path. The read side did a
 * `JSON.parse` plus a single `fetchedAt` freshness check and nothing else, so on
 * a shared host a local unprivileged user could pre-create or overwrite the
 * file and have it served as authoritative for the whole TTL.
 *
 * Why that matters more here than the usual temp-file nit: `exposure.ts:96-112`
 * documents that an empty CVE library makes every detection score as unscored,
 * and the tool then honestly reports `aboveThreshold: 0` — "a clean estate,
 * which is the single most dangerous wrong answer this tool can give". The
 * module already refuses to *write* an empty library for exactly that reason;
 * before this change it would happily *read* one someone else wrote.
 *
 * ── The checks ──────────────────────────────────────────────────────────────
 * Directory 0o700, file 0o600, and before either is read or written it must be:
 *   - not a symlink (an attacker-planted link would redirect the read, or aim
 *     the write at a file we should not be truncating),
 *   - a real directory / regular file,
 *   - owned by the current uid on POSIX, and
 *   - not group- or world-writable.
 * Anything else is refused, and a refused read simply refetches from the API —
 * the same outcome as an absent cache, which is always safe.
 *
 * ── Windows ─────────────────────────────────────────────────────────────────
 * `process.getuid` does not exist and `lstat` reports uid 0 with synthetic mode
 * bits, so the ownership and permission-bit checks are POSIX-only by design.
 * The symlink and file-type checks still apply. This is not a gap: on Windows
 * `os.tmpdir()` resolves to the per-user `%LOCALAPPDATA%\Temp`, which is already
 * ACL'd to that user — the shared-host threat model this hardening addresses is
 * a POSIX one.
 */

import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";

/** Owner-only. Applied on create and re-asserted on every write. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Group- or world-writable — the bits that make a planted file possible. */
const SHARED_WRITE_BITS = 0o022;

/** Distinguishes concurrent temp files written by ONE process. See writeCacheFileSync. */
let writeCounter = 0;

/** POSIX only: on Windows there is no getuid and lstat reports uid 0 for all. */
const isPosix = typeof process.getuid === "function";

/**
 * The platform primitives `inspect()` depends on, factored out as an
 * injection seam (finding B5). On a non-POSIX CI host `process.getuid` does
 * not exist, so the ownership and mode-bit branches below never execute and
 * the four tests that cover them used to skip outright — the hardening had
 * never actually run anywhere this suite could see.
 *
 * `inspectWith()` takes these as a parameter so a test can hand in synthetic
 * POSIX stats (a fake uid, real-looking mode bits) on ANY host, including
 * this Windows one, and exercise the exact same branches production takes.
 * `inspect()` below is unchanged behaviourally — it just closes over the real
 * `lstatSync` / `process.getuid` / `isPosix`, so production is not affected.
 *
 * This makes the ownership/mode-bit *logic* verifiable everywhere. It does
 * NOT substitute for POSIX end-to-end coverage: proving that a real planted
 * file on a real POSIX filesystem gets real uid/mode bits from a real
 * `lstatSync` still requires running the existing (non-injected) tests on a
 * POSIX runner.
 */
export interface PlatformOps {
  lstat: (path: string) => Stats;
  getuid: (() => number) | undefined;
  isPosix: boolean;
}

const realPlatform: PlatformOps = {
  lstat: lstatSync,
  getuid: typeof process.getuid === "function" ? () => process.getuid!() : undefined,
  isPosix,
};

/**
 * A cache path is trustworthy only if nothing but us could have written it.
 * Pure given `platform` — no direct dependency on `node:fs` or `process`, so
 * it can be driven with synthetic stats from any host.
 *
 * @returns null when the path is fine, otherwise the reason it was refused.
 * `"absent"` is distinguished from a real integrity failure so the caller can
 * stay quiet about the ordinary cold-cache case and complain about the rest.
 */
export function inspectWith(platform: PlatformOps, path: string, expect: "file" | "dir"): string | null {
  let stat;
  try {
    stat = platform.lstat(path);
  } catch {
    return "absent";
  }

  if (stat.isSymbolicLink()) {
    return "it is a symlink";
  }
  if (expect === "file" && !stat.isFile()) {
    return "it is not a regular file";
  }
  if (expect === "dir" && !stat.isDirectory()) {
    return "it is not a directory";
  }
  if (platform.isPosix && platform.getuid) {
    if (stat.uid !== platform.getuid()) {
      return `it is owned by uid ${stat.uid}, not this process`;
    }
    if ((stat.mode & SHARED_WRITE_BITS) !== 0) {
      return "it is group- or world-writable";
    }
  }
  return null;
}

/** Real-platform entry point used by every production code path below. */
function inspect(path: string, expect: "file" | "dir"): string | null {
  return inspectWith(realPlatform, path, expect);
}

/**
 * Refusing a cache is never fatal — it costs a refetch — but it must not be
 * silent, because the silent case is indistinguishable from an active attempt
 * to plant one. A plain preformatted string, never an object: an error object
 * handed to console.error is how a credential leaks into a host log.
 */
function warn(path: string, reason: string): void {
  console.error(`[bconnect-compliance] refusing cache file ${path}: ${reason}; refetching from the API`);
}

/**
 * Create the cache directory owner-only, and verify it is ours.
 *
 * @returns true when the directory exists and is trustworthy.
 */
export function prepareCacheDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  } catch {
    // Deliberately not an early return: the interesting failure is a
    // non-directory sitting at the cache path, and inspect() below names it
    // precisely where the mkdir errno would not.
  }

  const reason = inspect(dir, "dir");
  if (reason !== null) {
    warn(dir, reason === "absent" ? "it could not be created" : reason);
    return false;
  }

  if (isPosix) {
    // `mode` on mkdirSync only applies at creation and is masked by the umask,
    // so a directory left over from an older build still carries 0755.
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      /* best effort — inspect() above already established it is ours */
    }
  }
  return true;
}

/**
 * Read a cache file, refusing anything an attacker could have planted.
 *
 * @returns the file contents, or null when the cache is absent or untrusted.
 * Both mean the same thing to a caller: refetch.
 */
export function readCacheFileSync(dir: string, path: string): string | null {
  const dirReason = inspect(dir, "dir");
  if (dirReason !== null) {
    if (dirReason !== "absent") {warn(dir, dirReason);}
    return null;
  }

  const fileReason = inspect(path, "file");
  if (fileReason !== null) {
    if (fileReason !== "absent") {warn(path, fileReason);}
    return null;
  }

  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Write a cache file owner-only. A pre-existing entry that is not a regular
 * file we own is removed rather than written through — `writeFileSync`'s mode
 * argument applies only when the file is created, so writing over a planted
 * 0666 file would leave it 0666.
 *
 * A cache write failure must never fail the query, so every failure path here
 * is a no-op return.
 */
export function writeCacheFileSync(dir: string, path: string, contents: string): void {
  if (!prepareCacheDir(dir)) {return;}

  const fileReason = inspect(path, "file");
  if (fileReason !== null && fileReason !== "absent") {
    warn(path, `${fileReason}; replacing it`);
    try {
      unlinkSync(path);
    } catch {
      return;
    }
  }

  // ── Write somewhere else, then MOVE it into place ──────────────────────────
  //
  // This used to `writeFileSync` straight onto `path`, which is not atomic: the
  // file is truncated first and filled afterwards, so anything reading it in
  // between sees a prefix. Measured 2026-08-23 with two real processes writing
  // a ~1 MB payload (the shape of the 37,571-entry vulnerability library) while
  // a third read in a loop:
  //
  //     reads 2311 · torn (invalid JSON) 52 · file absent to lstat 2256
  //     valid-but-blended 0
  //
  // The safety half was already sound and is not what changed: a torn read is
  // invalid JSON, every caller parses inside a try/catch, and the result is a
  // refetch. Not once in ~4,600 reads did a blend of two writers parse as valid
  // JSON, which is the outcome that would have been dangerous.
  //
  // What was bad was the OTHER direction: for 97% of that window the cache was
  // simply unusable, so two same-tenant processes — a stdio server and a
  // gateway-mounted copy, say — each refetch the whole library instead of
  // sharing it. A cache that misses under exactly the conditions it exists for
  // is a thundering herd pointed at bMS.
  //
  // A rename is atomic on both platforms this ships to, so a reader now sees
  // either the old file or the new one and never a half of either. The temp
  // name carries the pid because two writers must not collide on the temp
  // itself, and it is created in the SAME directory so the rename cannot cross
  // a filesystem boundary.
  const temp = `${path}.${process.pid}.${(writeCounter += 1)}.tmp`;
  try {
    writeFileSync(temp, contents, { encoding: "utf8", mode: FILE_MODE });
    if (isPosix) {
      // Re-assert: the mode above is masked by the umask. Done BEFORE the
      // rename, so the file is never briefly readable at a wider mode under
      // its real name.
      chmodSync(temp, FILE_MODE);
    }
    renameSync(temp, path);
  } catch {
    /* a cache write failure must never fail the query */
    try {
      unlinkSync(temp);
    } catch {
      /* the temp may not exist; nothing to clean up */
    }
  }
}
