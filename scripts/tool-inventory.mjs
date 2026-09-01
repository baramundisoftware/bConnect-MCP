// Offline tool inventory + context-weight probe.
//
// Why this exists: the real entrypoint hard-exits when bConnect is unreachable
// (REQ-SRV-013, index.js main()), so `tools/list` over stdio CANNOT be
// smoke-tested without a live bMS. This imports the exported createServer()
// factory and drives it with a real MCP Client over an in-memory transport,
// so the full initialize + tools/list handshake is exercised with no server.
//
// Usage (Git Bash, repo root):  node scripts/tool-inventory.mjs [26R1|25R2] [mode]
//
//   (no mode)     per-server totals — the original report, unchanged
//   --per-tool    every tool ranked by catalogue bytes, split name/description/
//                 schema, plus how concentrated the cost is
//   --duplication which prose is paid for more than once across the catalogue
//   --shaping     which tools project their responses and which are passthroughs
//
// Add --write to measure the ALLOW_WRITE_OPERATIONS posture instead of default.
//
// ── What the modes were built to answer, and what they answered ─────────────
// "125,862 B is guarded but has never been analysed per tool. Nobody has ranked
// the largest schemas or asked whether the biggest twenty are large for a good
// reason." Measured 2026-08-10 at 26R1, default posture:
//
//   * The distribution is FLAT. The largest single tool is 2,689 B of 125,713;
//     the top 20 are 27.0% and the top 50 are 55.7%. There is no small set of
//     monster schemas to fix, which is the answer to "is per-tool surgery worth
//     funding" — it is not.
//   * 61.3% of the catalogue is English prose: 39,530 B of tool descriptions
//     plus 37,489 B of per-parameter descriptions.
//   * 54.8% of that parameter prose is a REPEAT of a string already in the
//     catalogue — 643 occurrences of only 207 distinct strings, 20,543 B. The
//     repeats are already canonical in schema-fragments.ts, so a byte trimmed
//     there is multiplied by up to 82 (`countOnly` alone appears 82 times).
//
// Reconciliation, because two instruments that disagree are worse than one:
// --per-tool sums each tool's own JSON and therefore excludes the array framing
// the per-server report includes. 125,713 + 136 commas + 13 bracket pairs =
// 125,862 B, which is the figure id-producers.test.ts ratchets. They agree.

import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.VITEST = '1'; // suppress main() auto-run on import
const argv = process.argv.slice(2);
const release = argv.find((a) => !a.startsWith('--'));
process.env.BCONNECT_RELEASE = release ?? '26R1';
const mode = argv.find((a) => a.startsWith('--') && a !== '--write');
if (argv.includes('--write')) {
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
}

const dirs = readdirSync('.')
  .filter((d) => /^bconnect-.*-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')
  .sort();

let totalTools = 0;
let totalBytes = 0;
const rows = [];
/** Every advertised tool, kept for the analysis modes. */
const allTools = [];

for (const dir of dirs) {
  try {
    const mod = await import(pathToFileURL(resolve(dir, 'build/index.js')).href);
    const { server } = mod.createServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'inventory-probe', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    totalTools += tools.length;
    totalBytes += bytes;
    rows.push({ dir, tools: tools.length, kb: bytes / 1024 });
    for (const t of tools) {
      allTools.push({ server: dir.replace(/^bconnect-|-mcp$/g, ''), tool: t });
    }

    await client.close();
    await server.close();
  } catch (err) {
    rows.push({ dir, tools: 'ERROR', kb: 0, err: err.message });
  }
}

console.log(`release: ${process.env.BCONNECT_RELEASE}\n`);
console.log('server'.padEnd(38) + 'tools'.padStart(6) + 'schema'.padStart(10) + 'est.tokens'.padStart(12));
console.log('-'.repeat(66));
for (const r of rows) {
  const t = String(r.tools).padStart(6);
  const kb = r.tools === 'ERROR' ? '' : `${r.kb.toFixed(1)} KB`;
  const tok = r.tools === 'ERROR' ? '' : `~${Math.round((r.kb * 1024) / 4).toLocaleString()}`;
  console.log(r.dir.padEnd(38) + t + kb.padStart(10) + tok.padStart(12));
  if (r.err) console.log(`  ! ${r.err}`);
}
console.log('-'.repeat(66));
console.log(
  'TOTAL'.padEnd(38) +
    String(totalTools).padStart(6) +
    `${(totalBytes / 1024).toFixed(1)} KB`.padStart(10) +
    `~${Math.round(totalBytes / 4).toLocaleString()}`.padStart(12)
);

// ── Analysis modes ──────────────────────────────────────────────────────────

const utf8 = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const props = (t) => t.inputSchema?.properties ?? {};

if (mode === '--per-tool') {
  const ranked = allTools
    .map(({ server, tool }) => ({
      server,
      name: tool.name,
      total: utf8(tool),
      desc: utf8(tool.description ?? ''),
      schema: utf8(tool.inputSchema ?? {}),
      params: Object.keys(props(tool)).length,
      paramDesc: Object.values(props(tool)).reduce((n, p) => n + utf8(p?.description ?? ''), 0),
    }))
    .sort((a, b) => b.total - a.total);

  const sum = (k) => ranked.reduce((n, r) => n + r[k], 0);
  const pct = (n) => `${((n / sum('total')) * 100).toFixed(1)}%`;

  console.log(`\nper-tool — ${ranked.length} tools, ${sum('total')} B (excludes JSON array framing)`);
  console.log(`  tool descriptions:  ${sum('desc')} B (${pct(sum('desc'))})`);
  console.log(`  inputSchema:        ${sum('schema')} B (${pct(sum('schema'))})`);
  console.log(`    parameter prose within it: ${sum('paramDesc')} B (${pct(sum('paramDesc'))})`);
  console.log(`  => prose overall:   ${sum('desc') + sum('paramDesc')} B (${pct(sum('desc') + sum('paramDesc'))})`);

  console.log('\nrank  bytes   desc  schema  par  server            tool');
  ranked.slice(0, 25).forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${String(r.total).padStart(5)}  ${String(r.desc).padStart(5)}` +
        `  ${String(r.schema).padStart(6)}  ${String(r.params).padStart(3)}  ${r.server.padEnd(17)} ${r.name}`
    );
  });

  console.log('\nconcentration — how much of the catalogue the biggest N account for');
  for (const n of [10, 20, 30, 50]) {
    if (n > ranked.length) continue;
    const c = ranked.slice(0, n).reduce((s, r) => s + r.total, 0);
    console.log(`  top ${String(n).padStart(3)}: ${String(c).padStart(6)} B  (${pct(c)})`);
  }
}

if (mode === '--duplication') {
  const paramProse = new Map();
  for (const { tool } of allTools) {
    for (const [key, p] of Object.entries(props(tool))) {
      const text = p?.description;
      if (!text) continue;
      const cur = paramProse.get(text) ?? { count: 0, bytes: utf8(text), where: [] };
      cur.count++;
      if (cur.where.length < 3) cur.where.push(`${tool.name}.${key}`);
      paramProse.set(text, cur);
    }
  }
  const occurrences = [...paramProse.values()].reduce((n, v) => n + v.count, 0);
  const total = [...paramProse.values()].reduce((n, v) => n + v.count * v.bytes, 0);
  const repeated = [...paramProse.values()].reduce((n, v) => n + (v.count - 1) * v.bytes, 0);

  console.log(`\nduplication — parameter descriptions`);
  console.log(`  ${occurrences} occurrences of ${paramProse.size} distinct strings, ${total} B`);
  console.log(`  paid for a repeat of text already in the catalogue: ${repeated} B ` +
    `(${((repeated / total) * 100).toFixed(1)}%)`);
  console.log(`\n  most-repeated (trimming these is multiplied by the repeat count):`);
  [...paramProse.entries()]
    .map(([text, v]) => ({ text, ...v, waste: (v.count - 1) * v.bytes }))
    .sort((a, b) => b.waste - a.waste)
    .slice(0, 12)
    .forEach((v) => {
      const t = v.text.length > 74 ? `${v.text.slice(0, 74)}...` : v.text;
      console.log(`    ${String(v.count).padStart(3)}x ${String(v.bytes).padStart(4)} B  repeat cost ${String(v.waste).padStart(5)} B  "${t}"`);
    });
}

if (mode === '--undocumented') {
  // ── Levers a tool HAS but never tells the model about ──────────────────────
  //
  // Why the tool-level description and not the schema: `list_variable_instances`
  // already declared countOnly, Scope, Name and Category, each with its own
  // canonical parameter description — and a measured session still called it
  // seven times as {PageSize}/{Page,PageSize}, walking 43 pages. Adding one
  // sentence to the TOOL description ("NARROW THIS FIRST — … countOnly:true
  // answers 'how many' without a page") changed it to 11 of 12 calls filtered
  // and 9 using countOnly. So a parameter documented only at the parameter level
  // is, on the evidence, not documented at all for routing purposes.
  //
  // ── READ THIS BEFORE ACTING ON THE OUTPUT: the premise was TESTED AND FAILED
  //
  // This mode was built on the theory that naming a lever in the tool
  // description makes a model use it. Five of the most expensive tools were
  // edited to say so, and then it was tested properly — a single-variable,
  // within-run comparison holding model, question, server set and build
  // constant, so the ONLY difference between the two groups was the sentence:
  //
  //   run 1   arm A (edited)  5/5  100%     arm B (silent)  10/12  83%
  //   run 2   arm A (edited) 11/11 100%     arm B (silent)  10/10 100%
  //
  // Arm B's two misses were re-issued WITH countOnly moments later to confirm a
  // zero was real. So the descriptions made no measurable difference: a model
  // finds countOnly in the SCHEMA on its own once the question is count-shaped.
  //
  // What actually drives it is the question. The same estate cost 483 B and
  // 6,403 B to SIZE (fourteen counts across thirteen servers) against
  // 46,951-73,899 B to ASSESS. A ~150x spread, driven entirely by what was asked
  // and not at all by catalogue wording.
  //
  // The 1.33 MB (~348k token) countOnly saving that motivated this — 70 sweeps
  // of list_group_members returning 1,212 B where full pages would have been
  // 1,391,810 B — was therefore never a documentation win. It is a property of
  // the workload and happens with or without the sentence.
  //
  // The earlier list_variable_instances A/B that seemed to prove the theory
  // bundled two changes: it named the filters AND said "NARROW THIS FIRST".
  // This test isolates the naming half, and the naming half does nothing. If a
  // strategic instruction is what works, that is a different and untested claim.
  //
  // So: this audit reports a real inconsistency, not a real cost. Treat the
  // output as documentation hygiene. Do NOT spend catalogue bytes closing the
  // remaining gaps expecting a token saving — that has been measured at zero.
  //
  // One limit on the null, stated so nobody over-reads it: it was measured with
  // ONE capable model. A smaller or cheaper model may well need the sentence,
  // and this suite ships to deployers who choose their own. The null is about
  // redundancy for a strong model, not about the text being wrong.
  const mentions = (text, re) => re.test(text ?? '');
  const rows = [];

  for (const { server, tool } of allTools) {
    const p = props(tool);
    const keys = Object.keys(p);
    const desc = tool.description ?? '';

    // Only list tools can be narrowed; a get-by-id has nothing to narrow.
    if (!/^list_/.test(tool.name)) continue;

    const gaps = [];
    if (keys.includes('countOnly') && !mentions(desc, /countonly|count only|how many|the count alone/i)) {
      gaps.push('countOnly');
    }
    if (keys.includes('detail') && !mentions(desc, /detail\s*:\s*true/i)) gaps.push('detail');
    if (keys.includes('fields') && !mentions(desc, /fields\s*:/i)) gaps.push('fields');
    // Exact-match and enum filters: a filter the description never names.
    const RESERVED = new Set([
      'Page', 'PageSize', 'OrderBy', 'SearchQuery', 'countOnly', 'detail', 'fields',
    ]);
    for (const key of keys) {
      if (RESERVED.has(key)) continue;
      // Required ids are scope, not a filter the caller chooses to apply.
      if ((tool.inputSchema?.required ?? []).includes(key)) continue;
      if (!mentions(desc, new RegExp(`\\b${key}\\b`, 'i'))) gaps.push(key);
    }

    if (gaps.length > 0) {
      rows.push({ server, tool: tool.name, gaps, bytes: utf8(desc) });
    }
  }

  console.log(`\nundocumented levers — ${rows.length} list tools declare something their own description never names`);
  console.log('(checked against the TOOL description; a parameter-level description does not route)\n');
  console.log('server                  tool                                        undeclared-in-description');
  for (const r of rows.sort((a, b) => b.gaps.length - a.gaps.length)) {
    console.log(`  ${r.server.padEnd(22)} ${r.tool.padEnd(44)} ${r.gaps.join(', ')}`);
  }

  const countOnlyGaps = rows.filter((r) => r.gaps.includes('countOnly'));
  console.log(`\ncountOnly declared but unmentioned: ${countOnlyGaps.length} tools`);
  console.log('  This is the lever with the measured 1.33 MB/session precedent.');
  for (const r of countOnlyGaps) console.log(`    ${r.server}/${r.tool}`);
}

if (mode === '--shaping') {
  const rowsOf = allTools.map(({ server, tool }) => {
    const keys = Object.keys(props(tool));
    return {
      server,
      name: tool.name,
      shaped: keys.includes('detail') || keys.includes('fields'),
      countOnly: keys.includes('countOnly'),
      paged: keys.includes('PageSize') || keys.includes('Page'),
      isList: /^list_/.test(tool.name),
    };
  });
  const lists = rowsOf.filter((r) => r.isList);
  const unshaped = lists.filter((r) => !r.shaped);

  console.log(`\nshaping — the catalogue is paid once per session, responses on every call`);
  console.log(`  tools: ${rowsOf.length}   shaped: ${rowsOf.filter((r) => r.shaped).length}` +
    `   countOnly: ${rowsOf.filter((r) => r.countOnly).length}   paged: ${rowsOf.filter((r) => r.paged).length}`);
  console.log(`  list_* tools: ${lists.length}   shaped: ${lists.length - unshaped.length}   UNSHAPED: ${unshaped.length}`);

  const byServer = new Map();
  for (const r of unshaped) {
    if (!byServer.has(r.server)) byServer.set(r.server, []);
    byServer.get(r.server).push(r);
  }
  console.log('\n  unshaped list tools — every call returns the API payload unchanged:');
  for (const [s, list] of [...byServer.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${s} (${list.length})`);
    for (const r of list) {
      const flags = `${r.paged ? '' : ' [UNPAGED]'}${r.countOnly ? '' : ' [no countOnly]'}`;
      console.log(`        ${r.name}${flags}`);
    }
  }
}
