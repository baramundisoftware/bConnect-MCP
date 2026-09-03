/**
 * Two composites running at once, sharing one module's globals.
 *
 * scan-recency.ts keeps `historyCache` / `historyCacheKey` (tenant-keyed, and
 * guarded by a test) alongside `lastLoadWasCacheHit` / `lastLoadMs`, which are
 * NOT per call. Its own header calls that pair "known, deferred" on a severity
 * judgement it says "should be checked rather than trusted". This checks it.
 *
 * Shape of the race: getScanRecency awaits the history load, then builds
 * `meta.fromCache` / `meta.loadMs` from the module globals. A second call that
 * finishes DURING the first one's await leaves its own values in those globals,
 * and the first call reports them as its own.
 *
 * Needs the in-repo mock: node scripts/bconnect-mock.mjs
 */
import axios from "axios";

const COMPLIANCE = new URL("../bconnect-compliance-mcp/build/modules/", import.meta.url).href;
const { getScanRecency } = await import(COMPLIANCE + "scan-recency.js");

const MOCK = "http://127.0.0.1:13433";
const health = await fetch(`${MOCK}/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.error("start the mock first: node scripts/bconnect-mock.mjs");
  process.exit(2);
}

const setFault = (spec) =>
  fetch(`${MOCK}/api/fault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
const reset = () => fetch(`${MOCK}/api/reset`, { method: "POST" });

/**
 * Two tenants, distinguished by base URL path prefix so the fingerprints (and
 * therefore the cache keys) differ. The pid keeps this run from inheriting a
 * disk cache written by the last one.
 */
const tenant = (name) =>
  axios.create({
    baseURL: `${MOCK}/t-${process.pid}-${name}`,
    timeout: 20000,
    headers: { common: { "X-Api-Key": `key-${name}` } },
  });

const clientX = tenant("X");
const clientY = tenant("Y");

const out = (l, v) => console.log(`  ${String(l).padEnd(52)} ${v}`);

await reset();

// 1. Warm tenant X so a later X call is a genuine cache HIT.
console.log("\n── setup ──");
const warm = await getScanRecency(clientX, []);
out("warm X: fromCache", warm.meta.fromCache);
out("warm X: loadMs", warm.meta.loadMs);

// 2. Slow every HTTP response so tenant Y's walk stays in flight while the
//    tenant X call (which needs no HTTP at all) completes inside its await.
await setFault({ mode: "slow", delayMs: 900 });

console.log("\n── the race: Y walks (miss, slow) while X hits the cache ──");
const started = Date.now();
const yPromise = getScanRecency(clientY, []);        // MISS -> real walk
await new Promise((r) => setTimeout(r, 150));        // let Y get into its await
const xPromise = getScanRecency(clientX, []);        // HIT  -> instant, sets globals
const [xResult, yResult] = await Promise.all([xPromise, yPromise]);
const elapsed = Date.now() - started;

await reset();

out("X (expected a cache HIT): fromCache", xResult.meta.fromCache);
out("X: loadMs", xResult.meta.loadMs);
out("Y (did a REAL walk): fromCache", yResult.meta.fromCache);
out("Y: loadMs", yResult.meta.loadMs);
out("wall clock for the pair (ms)", elapsed);

console.log("\n── verdict ──");
const yLied = yResult.meta.fromCache === true;
out("Y reported a cache hit it never had", yLied ? "YES — crossover reproduced" : "no");
out("Y reported loadMs 0 despite walking", yResult.meta.loadMs === 0 ? "YES" : "no");

// 3. The half that matters more: did either tenant receive the OTHER's data?
//
// This check was VACUOUS until 2026-08-23. The mock returned rows with no
// `steps`, so scan-recency could index nothing, both endpoint sets came back
// EMPTY, and "no crossover" compared nothing to nothing. The mock now emits a
// WindowsComplianceScan step whose date varies by tenant while the endpoint
// NAME collides across tenants — which is the exact shape cache-provenance
// exists for, because scan-recency keys its history by display name.
const scanOf = (result) => {
  const entry = [...result.byEndpoint.values()][0];
  return entry ? entry.lastScan : null;
};
const xScan = scanOf(xResult);
const yScan = scanOf(yResult);

out("X indexed endpoints", xResult.byEndpoint.size);
out("Y indexed endpoints", yResult.byEndpoint.size);
out("X scan date", xScan ?? "(none)");
out("Y scan date", yScan ?? "(none)");

if (xResult.byEndpoint.size === 0 || yResult.byEndpoint.size === 0) {
  out("CROSS-TENANT CHECK", "VACUOUS — an empty index proves nothing");
  process.exitCode = 1;
} else if (xScan === yScan) {
  out("CROSS-TENANT CHECK", "FAILED — both tenants report the same scan date");
  process.exitCode = 1;
} else {
  out("CROSS-TENANT CHECK", "passed — each tenant kept its own scan date");
}
