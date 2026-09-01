/**
 * Documented tool counts must match the built catalogue.
 *
 * The published tool counts have now drifted from reality FOUR times: the README
 * said 276 when the suite shipped 284, then 284 after the Class C collapse took it
 * to 154, then 152/247 after this pass took it to 136/216. Each time the number was
 * hand-derived — projected from "baseline minus what we removed" rather than
 * measured from the servers — and each time it was published on the front page of a
 * change whose headline was the tool count itself.
 *
 * Hand-counting is the defect. This test removes the option: it reads the numbers
 * out of the docs and compares them against a real `tools/list` from every built
 * server, in both write postures.
 *
 * If this fails, do NOT edit the expected numbers by hand — run it, take the
 * measured values from the failure message, and paste those.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(__dirname, '..');

/**
 * Every server, DISCOVERED — never a hand-written list.
 *
 * This was a literal list of thirteen names. `bconnect-insights-mcp` shipped on
 * 2026-08-11/12 and was added to none of the five guards that carried one, so
 * for three days its five tools were outside this check entirely. The audit that
 * found it (2026-08-14) started from the catalogue ratchet in
 * `id-producers.test.ts`, which had the same list and was bounding 13 servers
 * out of 14 while reporting a clean figure.
 *
 * A guard that omits a server does not fail — it passes over a thing it never
 * looked at. Discovery is the only version of this that cannot go stale.
 * `bconnect-mcp-gateway` and `bconnect-server-template` do not end in `-mcp`
 * and are correctly outside the pattern.
 */
const SERVERS: readonly string[] = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => /^bconnect-(.+)-mcp$/.exec(entry.name)?.[1])
  .filter((name): name is string => Boolean(name))
  .sort();

// Vacuity: a pattern that matched nothing would make every assertion below pass
// over an empty set, which is the failure this discovery replaced.
if (SERVERS.length < 14 || !SERVERS.includes('insights')) {
  throw new Error(`server discovery found ${SERVERS.length}: ${SERVERS.join(', ')}`);
}

/** Files that quote a suite-wide total, and therefore go stale together. */
const DOCS_WITH_TOTALS = [
  'README.md',
  'docs/MIGRATION-tool-surface.md',
  'docs/INSTALLATION.md',
  'docs/TROUBLESHOOTING.md',
  'docs/N8N.md',
];

/**
 * Per-server tool counts for one posture, keyed by `bconnect-<name>-mcp`.
 *
 * `countTools()` below used to do this same walk and only keep the sum —
 * which is exactly the gap Phase 4's token-consumption audit found (§5):
 * mutation-testing this file by changing README.md's per-server row for
 * `bconnect-endpoints-mcp` from 10 to 99 left all 6 assertions passing,
 * because none of them ever looked at a per-server row, only the suite-wide
 * total and the `**Total**` footer. That stopped being a cosmetic gap once a
 * deployer choosing a SUBSET of the 13 servers started reading the per-server
 * row, not the suite total, to decide what they are paying — the public-
 * release, per-server-cost constraint this phase was scoped under.
 */
async function countToolsPerServer(writesEnabled: boolean): Promise<Map<string, number>> {
  const prevWrite = process.env.ALLOW_WRITE_OPERATIONS;
  const prevTest = process.env.VITEST;
  process.env.ALLOW_WRITE_OPERATIONS = writesEnabled ? 'true' : '';
  process.env.VITEST = '1';
  try {
    const perServer = new Map<string, number>();
    for (const name of SERVERS) {
      const dir = `bconnect-${name}-mcp`;
      const entry = join(ROOT, dir, 'build', 'index.js');
      if (!existsSync(entry)) {throw new Error(`not built: ${entry} — run the build first`);}
      // Cache-bust so the gate is re-read per posture rather than reusing a module instance.
      const mod = await import(`${pathToFileURL(entry).href}?writes=${writesEnabled}`);
      const { server } = mod.createServer();
      const handler = (server as {
        _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: unknown[] }>>;
      })._requestHandlers.get('tools/list');
      const result = await handler?.({ method: 'tools/list' });
      perServer.set(dir, (result?.tools ?? []).length);
    }
    return perServer;
  } finally {
    if (prevWrite === undefined) {delete process.env.ALLOW_WRITE_OPERATIONS;}
    else {process.env.ALLOW_WRITE_OPERATIONS = prevWrite;}
    if (prevTest === undefined) {delete process.env.VITEST;}
    else {process.env.VITEST = prevTest;}
  }
}

describe('documented tool counts match the built catalogue', () => {
  let shut = 0;
  let open = 0;
  let shutPerServer = new Map<string, number>();
  let openPerServer = new Map<string, number>();

  beforeAll(async () => {
    shutPerServer = await countToolsPerServer(false);
    openPerServer = await countToolsPerServer(true);
    shut = [...shutPerServer.values()].reduce((a, b) => a + b, 0);
    open = [...openPerServer.values()].reduce((a, b) => a + b, 0);
  }, 120_000);

  it('measures a non-trivial catalogue in both postures', () => {
    expect(shut).toBeGreaterThan(0);
    expect(open).toBeGreaterThanOrEqual(shut);
  });

  it.each(DOCS_WITH_TOTALS)('%s quotes no tool count that contradicts the catalogue', (rel) => {
    const path = join(ROOT, rel);
    if (!existsSync(path)) {return;} // a doc may legitimately not exist yet
    const text = readFileSync(path, 'utf8');

    // Match only phrasings that are genuinely a claim about how many tools exist.
    // An earlier, looser pattern ("any 3-digit number near the word tool") flagged
    // the date 2026-08-02 and the MCP error code -32601, and a guard that cries wolf
    // is a guard someone deletes. These three shapes cover every real claim in the
    // docs today:
    //   "136 tools" / "136 tool definitions"      -> number immediately before "tool"
    //   "136 by default, 216 with ..."            -> the re-baseline sentence
    //   "| **Total** | **136** | **216** |"       -> the per-server table footer
    // Only SUITE-WIDE totals are checked. Per-server counts ("28 tools" for one
    // domain) are legitimate and varied, and flagging them would make this guard
    // noisy enough to be deleted — which is how the drift survived four times.
    // A line is a suite-total claim when it pairs a number with an explicitly
    // suite-wide qualifier: "across 13 servers/domains", "by default",
    // "with ALLOW_WRITE_OPERATIONS", or a table "Total" row.
    // Check ONLY the two canonical suite-total shapes. Broader matching cannot
    // distinguish a stale total from a legitimate sub-total on the same line — a
    // per-server count, the number of write tools, a port — and every widening
    // attempt produced false positives. Narrow and correct beats broad and noisy:
    // a guard that reports things that are fine is a guard someone switches off,
    // and that is precisely how this drifted four times.
    //
    //   A: "**136 tools** advertised by default ... (**216** with ALLOW_WRITE...)"
    //   B: "| **Total** | **136** | **216** |"
    //   C: "136 tools by default, 216 with ALLOW_WRITE_OPERATIONS" (doc footers)
    const claims: number[] = [];

    for (const m of text.matchAll(
      /\*{0,2}(\d{2,4})\s+tools?\*{0,2}\s+advertised by default[^\n]*?\(\*{0,2}(\d{2,4})\*{0,2}\s+with/gi
    )) {claims.push(Number(m[1]), Number(m[2]));}

    for (const line of text.split('\n')) {
      if (!/\|\s*\*{0,2}Total\*{0,2}\s*\|/i.test(line)) {continue;}
      for (const m of line.matchAll(/\*\*(\d{2,4})\*\*/g)) {claims.push(Number(m[1]));}
    }

    for (const m of text.matchAll(
      /(\d{2,4})\s+tools?\s+by default[^\n]{0,20}?(\d{2,4})\s+with\s+`?ALLOW_WRITE_OPERATIONS/gi
    )) {claims.push(Number(m[1]), Number(m[2]));}

    const bad = [...new Set(claims)].filter((n) => n !== shut && n !== open);

    expect(
      bad,
      `${rel} quotes tool count(s) ${bad.join(', ')} that match neither posture. ` +
        `Measured now: ${shut} default, ${open} with ALLOW_WRITE_OPERATIONS=true. ` +
        `Update the doc to the measured values — do not adjust this test.`
    ).toEqual([]);
  });

  // Phase 4 token-consumption §5. Mutation-tested BEFORE this rule existed:
  // changing README.md:236 from "| `bconnect-endpoints-mcp` | 10 | 31 |" to
  // "| `bconnect-endpoints-mcp` | 99 | 31 |" left every assertion above
  // green — none of them ever reads a per-server row, only the suite-wide
  // total and the "**Total**" footer. A deployer choosing a subset of the 13
  // servers reads exactly this row, not the suite total, to decide what
  // they're paying — the new constraint that makes this load-bearing.
  it.each(DOCS_WITH_TOTALS)('%s quotes no per-server tool count that contradicts the built catalogue', (rel) => {
    const path = join(ROOT, rel);
    if (!existsSync(path)) {return;} // a doc may legitimately not exist yet
    const text = readFileSync(path, 'utf8');

    // The one shape this catalogue's docs use for a per-server claim:
    //   | `bconnect-endpoints-mcp` | 10 | 31 | ... |
    // Two numeric columns immediately after a backtick-quoted server name.
    // Narrow on purpose, same reasoning as the suite-total patterns above: a
    // per-server row is the only thing this test can attribute to ONE
    // server, so it does not try to guess at prose mentioning a count.
    const rowPattern = /\|\s*`(bconnect-[a-z0-9-]+-mcp)`\s*\|\s*(\d{1,4})\s*\|\s*(\d{1,4})\s*\|/g;

    const bad: string[] = [];
    let rowsSeen = 0;
    for (const m of text.matchAll(rowPattern)) {
      const [, server, defaultStr, writesStr] = m;
      if (!SERVERS.includes(server.replace(/^bconnect-/, '').replace(/-mcp$/, '') as (typeof SERVERS)[number])) {
        continue; // not one of the 13 servers this suite measures (e.g. a route-mapping table row)
      }
      rowsSeen++;
      const claimedDefault = Number(defaultStr);
      const claimedWrites = Number(writesStr);
      const measuredDefault = shutPerServer.get(server);
      const measuredWrites = openPerServer.get(server);
      if (measuredDefault === undefined) {continue;} // server not built in this run
      if (claimedDefault !== measuredDefault || claimedWrites !== measuredWrites) {
        bad.push(
          `${server}: doc says ${claimedDefault}/${claimedWrites}, measured ${measuredDefault}/${measuredWrites}`
        );
      }
    }

    // Only README.md today carries this table; the other docs in
    // DOCS_WITH_TOTALS legitimately have zero per-server rows, and that must
    // not read as a pass-by-vacuity on the one doc that does.
    if (rel === 'README.md') {
      expect(rowsSeen, 'no per-server rows found; the row pattern is probably stale').toBe(SERVERS.length);
    }

    expect(
      bad,
      `${rel} has ${bad.length} per-server tool-count row(s) that contradict the built ` +
        `catalogue:\n  ${bad.join('\n  ')}\nUpdate the doc to the measured values — do not adjust this test.`
    ).toEqual([]);
  });
});
