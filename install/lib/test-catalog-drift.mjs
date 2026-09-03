// The installer's catalog must describe the tool surface the servers actually
// have.
//
// WHY THIS EXISTS
// ---------------
// `catalog.json` is a hand-maintained parallel list of tool names — read
// probes, write probes, write tools, v1.1 tools — and every hand-maintained
// parallel list in this project has drifted. This one had, and the way it was
// found is the point:
//
//   The round-3 family collapse replaced `list_windows_endpoints` with
//   `list_endpoints` and `delete_windows_endpoint` with `delete_endpoint`.
//   `catalog.json` was not updated. So the installer's read probe for
//   bconnect-endpoints — a DEFAULT server — called a tool that no longer
//   existed, on every single install, and got back the removal notice.
//
//   Nobody saw it, because `verify-install` exited 0 on that failure (Phase 4
//   finding F2). The two defects concealed each other exactly: the probe was
//   broken, and the thing that would have reported it said PASS.
//
// Twenty stale write-tool names and one in bconnect-assets came with it.
//
// So this is mechanical, and it runs against the BUILT servers rather than
// against the source, because what the installer talks to is the build.
//
// Usage: node lib/test-catalog-drift.mjs [--suite-root <path>]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--suite-root');
// `install/` sits BESIDE the suite in the working repository and INSIDE it in a
// publication cut, whose root IS the suite. Resolving only the first layout left
// SUITE_ROOT pointing at a directory that does not exist in the cut, so all
// fourteen servers read as "not built", every check was skipped, and the run
// exited 0. The suite root is identified by what it CONTAINS rather than by a
// directory name, so neither layout is written down.
const SUITE_CANDIDATES = [
  resolve(HERE, '..', '..', 'bConnect-MCP-main'),
  resolve(HERE, '..', '..'),
];
const looksLikeSuite = (d) =>
  existsSync(d) && readdirSync(d).some((e) => /^bconnect-.*-mcp$/.test(e));
const SUITE_ROOT = rootFlag >= 0
  ? argv[rootFlag + 1]
  : (SUITE_CANDIDATES.find(looksLikeSuite) ?? SUITE_CANDIDATES[0]);

const catalog = JSON.parse(readFileSync(join(HERE, 'catalog.json'), 'utf8'));

let pass = 0;
let fail = 0;
const failures = [];
const check = (ok, label, detail) => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` -- ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
};

/** Advertised tool names for one server in one posture. */
async function advertised(dir, { writes, v11 }, tag) {
  process.env.VITEST = 'true'; // servers skip their startup connectivity probe
  process.env.ALLOW_WRITE_OPERATIONS = writes ? 'true' : '';
  process.env.BCONNECT_ENABLE_V11 = v11 ? 'true' : '';
  process.env.BCONNECT_V11_USERNAME = v11 ? 'probe@example.test' : '';
  process.env.BCONNECT_V11_PASSWORD = v11 ? 'probe' : '';
  const entry = join(SUITE_ROOT, dir, 'build', 'index.js');
  const mod = await import(`${pathToFileURL(entry).href}?catalogdrift=${tag}`);
  const { server } = mod.createServer();
  const list = await server._requestHandlers.get('tools/list')({ method: 'tools/list' });
  return list.tools.map((t) => t.name);
}

console.log('\n-- catalog.json vs the built tool surface\n');

let skipped = 0;
for (const s of catalog.servers) {
  if (!existsSync(join(SUITE_ROOT, s.dir, 'build', 'index.js'))) {
    skipped++;
    console.log(`  SKIP  ${s.name} is not built`);
    continue;
  }

  const reads = await advertised(s.dir, { writes: false, v11: false }, `r${s.name}`);
  const withWrites = await advertised(s.dir, { writes: true, v11: false }, `w${s.name}`);
  const withV11 = await advertised(s.dir, { writes: true, v11: true }, `v${s.name}`);
  const writes = withWrites.filter((n) => !reads.includes(n));
  const v11 = withV11.filter((n) => !withWrites.includes(n));

  // The read probe is called on every verification run, with no arguments.
  if (s.readProbe) {
    check(reads.includes(s.readProbe), `${s.name}: readProbe '${s.readProbe}' is an advertised read tool`,
      reads.includes(s.readProbe) ? '' : `not advertised; reads include ${reads.slice(0, 3).join(', ')}`);
  }

  // The write probe must be a WRITE tool: the gate check proves the gate by
  // watching it refuse, so a read tool here would prove nothing and pass.
  if (s.writeProbe?.tool) {
    check(writes.includes(s.writeProbe.tool), `${s.name}: writeProbe '${s.writeProbe.tool}' is an advertised write tool`,
      writes.includes(s.writeProbe.tool) ? '' : `not a write tool; writes include ${writes.slice(0, 3).join(', ')}`);
  }

  if (s.writeTools) {
    const stale = s.writeTools.filter((t) => !writes.includes(t));
    const missing = writes.filter((t) => !s.writeTools.includes(t));
    check(stale.length === 0, `${s.name}: no stale writeTools`,
      stale.length ? `${stale.length} named but not advertised: ${stale.slice(0, 4).join(', ')}` : '');
    // Both directions: a write tool missing from the catalogue is a tool the
    // installer never offers to gate, and never warns about.
    check(missing.length === 0, `${s.name}: writeTools covers every advertised write tool`,
      missing.length ? `${missing.length} advertised but not named: ${missing.slice(0, 4).join(', ')}` : '');
  }

  if (s.allowlistDefault) {
    const bogus = s.allowlistDefault.filter((t) => !writes.includes(t));
    check(bogus.length === 0, `${s.name}: allowlistDefault names only real write tools`, bogus.join(', '));
  }

  if (s.v11Tools) {
    const stale = s.v11Tools.filter((t) => !v11.includes(t));
    const missing = v11.filter((t) => !s.v11Tools.includes(t));
    check(stale.length === 0, `${s.name}: no stale v11Tools`, stale.join(', '));
    check(missing.length === 0, `${s.name}: v11Tools covers every gated v1.1 tool`, missing.join(', '));
  } else {
    // A server that grows v1.1 tools without a catalogue entry gets no gate
    // written for it, which is finding F1 all over again.
    check(v11.length === 0, `${s.name}: has no v1.1 tools, and claims none`,
      v11.length ? `advertises ${v11.join(', ')} behind BCONNECT_ENABLE_V11 but catalog.json has no v11Tools` : '');
  }
}

console.log('');
console.log(`  ${pass} passed, ${fail} failed, ${skipped} server(s) skipped (not built)`);
if (fail) {
  console.log('');
  for (const f of failures) console.log(`    FAILED: ${f}`);
  console.log('');
  console.log('  catalog.json is a hand-maintained list of tool names and it has drifted from');
  console.log('  the servers. Re-derive the affected entries from the built tool surface.');
}
// A run that checked NOTHING is not a pass. `0 passed, 0 failed` exited 0, which
// is how this guard reported success in the publication tree while every server
// was skipped for a path that never resolved. Skipping is legitimate when a
// server genuinely is not built; skipping ALL of them means the tree was not
// built or SUITE_ROOT is wrong, and either way nothing was verified.
if (!fail && pass === 0) {
  console.log('');
  console.log('  NOTHING WAS CHECKED — every server was skipped, so this run proves nothing.');
  console.log(`  SUITE_ROOT resolved to: ${SUITE_ROOT}`);
  console.log('  Build the suite first (npm run build), or pass --suite-root <path>.');
  process.exit(1);
}

process.exit(fail ? 1 : 0);
