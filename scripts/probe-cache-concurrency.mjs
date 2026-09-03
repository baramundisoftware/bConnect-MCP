#!/usr/bin/env node
/**
 * What the disk cache does under GENUINELY concurrent access.
 *
 * ── Why a script and not a test ─────────────────────────────────────────────
 * The interesting behaviour needs two OS processes. A first attempt used
 * `setImmediate` inside one process and reported zero torn reads — a result
 * worth nothing, because `writeFileSync` and `readFileSync` are synchronous and
 * a single process serialises them by construction. The race it claimed to test
 * could not occur. That is the shape this project keeps meeting: an instrument
 * that returns a clean answer to a question it cannot see.
 *
 * It also takes tens of seconds and its numbers are platform-dependent, so it
 * is a probe you run, not a test that gates a build. The deterministic residue
 * lives in `secure-disk-cache.test.ts` and `secure-disk-cache-atomicity.test.ts`.
 *
 * ── What it measures ────────────────────────────────────────────────────────
 * Two writer processes hammer one cache path with a ~1 MB payload (the shape of
 * the real 37,571-entry vulnerability library) through the production
 * `writeCacheFileSync`, while the parent reads through the production
 * `readCacheFileSync` and classifies every result:
 *
 *   clean      parsed, and the content is entirely one writer's
 *   TORN       invalid JSON — the caller's try/catch turns this into a refetch
 *   MIXED      valid JSON blended from both writers — the dangerous outcome
 *   null       absent or refused — also a refetch
 *
 * ── Measured on win32, 2026-08-23 ──────────────────────────────────────────
 *   in-place write   reads 2311 · torn 52 · MIXED 0 · null 2256
 *   temp + rename    reads 2388 · torn  0 · MIXED 0 · null 2369
 *
 * MIXED was zero both times, which is the result that matters: the cache has
 * never been able to serve a plausible-looking blend of two estates' data.
 * The fix removes the torn reads.
 *
 * The high null count is a WINDOWS finding and is not fixed by the rename. A
 * separate probe measured why: with a reader holding the file open, 232 of 240
 * renames fail with EPERM, so the cache rarely updates and readers mostly see
 * ENOENT. Without a reader, 234 of 240 land. The consequence is wasted
 * refetching, never a wrong answer. Whether POSIX behaves the same is UNPROVEN
 * — `rename(2)` over an open file does not fail there, so it very likely does
 * not, but this machine cannot answer that and CI has not run since 2026-08-20.
 *
 * Usage:
 *   node scripts/probe-cache-concurrency.mjs [--iterations 120] [--entries 20000]
 */
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE = join(HERE, "..");
const CACHE_MODULE = join(SUITE, "bconnect-compliance-mcp", "build", "modules", "secure-disk-cache.js");

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};

// ── Writer mode: this file forks ITSELF, so the probe is one file ───────────
if (process.env.BCONNECT_PROBE_ROLE === "writer") {
  const { writeCacheFileSync } = await import(`file://${CACHE_MODULE}`);
  const [dir, file, tag, iterations, entries] = process.argv.slice(2);
  const payload = JSON.stringify({
    tag,
    fetchedAt: Date.now(),
    entries: Array.from({ length: Number(entries) }, (_, i) => [`id-${i}`, { tag, cve: `CVE-2026-${i}`, pad: tag.repeat(8) }]),
  });
  for (let i = 0; i < Number(iterations); i++) {
    writeCacheFileSync(dir, file, payload);
  }
  process.send?.({ tag, bytes: payload.length });
  process.exit(0);
}

// ── Parent ─────────────────────────────────────────────────────────────────
const ITERATIONS = argOf("--iterations", 120);
const ENTRIES = argOf("--entries", 20000);

const { readCacheFileSync } = await import(`file://${CACHE_MODULE}`);

const dir = mkdtempSync(join(tmpdir(), "bconnect-cache-concurrency-"));
const file = join(dir, "vulnerability-library.probe.json");

console.log(`two writer processes x ${ITERATIONS} writes, ${ENTRIES} entries each`);
console.log(`path: ${file}\n`);

const writers = ["AAA", "BBB"].map((tag) =>
  fork(process.argv[1], [dir, file, tag, String(ITERATIONS), String(ENTRIES)], {
    env: { ...process.env, BCONNECT_PROBE_ROLE: "writer" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  })
);

let done = 0;
for (const w of writers) { w.on("exit", () => { done += 1; }); }

let reads = 0, nulls = 0, clean = 0, torn = 0, mixed = 0;
while (done < writers.length) {
  reads += 1;
  const text = readCacheFileSync(dir, file);
  if (text === null) { nulls += 1; }
  else {
    try {
      const parsed = JSON.parse(text);
      if (parsed.tag === "AAA" || parsed.tag === "BBB") { clean += 1; } else { mixed += 1; }
    } catch {
      torn += 1;
    }
  }
  await new Promise((r) => setImmediate(r));
}

const row = (l, v) => console.log(`  ${String(l).padEnd(46)} ${v}`);
row("reads attempted", reads);
row("clean (one writer's content, parsed)", clean);
row("null (absent or refused -> refetch)", nulls);
row("TORN (invalid JSON -> refetch)", torn);
row("MIXED (valid JSON, blended) <-- must be 0", mixed);
row("torn rate", reads ? `${((torn / reads) * 100).toFixed(1)}%` : "n/a");

let finalState;
try {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  finalState = `valid, tag=${parsed.tag}, entries=${parsed.entries.length}`;
} catch {
  finalState = "INVALID JSON left on disk";
}
row("final file", finalState);

rmSync(dir, { recursive: true, force: true });

if (mixed > 0) {
  console.error("\nFAILED: the cache served a blend of two writers as valid JSON.");
  process.exit(1);
}
console.log("\nOK — no blended content. Torn reads degrade to a refetch.");
