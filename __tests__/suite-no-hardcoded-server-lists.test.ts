/**
 * A hand-written list of servers is a defect waiting for the next server.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `bconnect-insights-mcp` shipped on 2026-08-11/12. On 2026-08-14 an audit found
 * it was absent from SIX guards, each carrying the same thirteen-name literal:
 *
 *   id-producers                     both catalogue ceilings bounded 13 of 14
 *   docs-tool-counts                 FOUR shipped docs advertised 136/216 tools
 *                                    against a true 141/221, unnoticed for days
 *   every-advertised-tool-dispatches insights' five tools never dispatch-checked
 *   suite-path-traversal             never traversal-probed
 *   suite-rejects-unknown-parameters never checked for the 37,571-row defect
 *   suite-schema-vs-types            never loaded at all
 *
 * None of them FAILED. Every one reported a clean result for a server it had
 * never looked at, which is the same shape as ARCH-1's blind scan (51 reads,
 * then 31 more) and ARCH-2's first cut (a whole server). Four occurrences of one
 * defect class is enough to guard the class rather than the instances.
 *
 * ── What this checks ────────────────────────────────────────────────────────
 * Any file that names three or more servers as string literals — but fewer
 * than all of them — must be listed below with a reason. Silence is not an
 * option: absence from the exception list is how a file declares itself fine,
 * and that is precisely the property that failed.
 *
 * "It discovers servers from the filesystem" used to absolve a file, tested
 * as "the file contains readdirSync(". That predicate cannot tell WHAT is
 * being discovered: descriptions-match-routes.test.ts carried a 13-name
 * literal that omitted insights for eleven days while its readdirSync — a
 * spec-FILE lookup, nothing to do with servers — waved it through (found
 * 2026-08-22, during the insights per-tool review this guard exists to make
 * unnecessary). So discovery no longer absolves: a file that truly discovers
 * its servers names none of them as literals and never trips the ≥3 gate; a
 * file that names an incomplete subset explains itself below, discovery or
 * not.
 *
 * ── Why the exception list is not a cheat ───────────────────────────────────
 * Plenty of files name a legitimate SUBSET: a Phase-1 regression script, a
 * probe for the four servers that speak v1.1, a check for the tools that were
 * ungated before one patch. Converting those to discovery would silently change
 * what they measure, which is worse than the enumeration. So they are named,
 * with the reason, and the reason is checkable by a reader.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');

/**
 * `install/lib`, wherever this layout puts it.
 *
 * It sits BESIDE the suite in the working repository and INSIDE it in the
 * publication tree, whose root IS this suite. Looking in both is not defensive
 * padding: hard-coding one layout is exactly what made `rel` below resolve in
 * one checkout and silently in none of the others.
 */
const INSTALL_LIB =
  [join(ROOT, 'install', 'lib'), join(ROOT, '..', 'install', 'lib')].find(existsSync) ??
  join(ROOT, '..', 'install', 'lib');

/**
 * A file's path relative to the SUITE ROOT, POSIX, identical in every layout
 * this tree is checked out as.
 *
 * The previous derivation was relative to `ROOT/..` with a literal
 * `bConnect-MCP-main/` stripped off the front. That is a hand-written path
 * assumption and it holds in exactly one checkout: in the publication tree the
 * suite root IS the repository root, so every path came back as
 * `bconnect-publication/scripts/…`, no DELIBERATE_SUBSETS key matched, and the
 * guard reported every exemption stale AND every exempt file as an offender —
 * the identical failure this file already records from its first Linux run.
 * That one was fixed by hard-coding a different path, which left the class in
 * place.
 *
 * Anchoring to ROOT and dropping any leading `../` normalises both cases:
 * `<suite>/scripts/x` and `<suite>/../install/lib/x` become `scripts/x` and
 * `install/lib/x` in either layout, with no directory name written down.
 */
function suiteRelative(file: string): string {
  return relative(ROOT, file)
    .split(sep)
    .join('/')
    .replace(/^(?:\.\.\/)+/, '');
}

/**
 * Paths the publication cut removes, read from the declaration the cut and this
 * guard share. An exempt file that is absent AND declared there is "not in this
 * cut"; absent and NOT declared stays a failure, so the ratchet keeps its teeth
 * in both trees.
 */
const PUBLICATION_OMIT: string[] = (() => {
  const declared = join(ROOT, 'publication-omit.json');
  if (!existsSync(declared)) {return [];}
  const parsed: unknown = JSON.parse(readFileSync(declared, 'utf8'));
  const omit = (parsed as { omit?: unknown }).omit;
  if (!Array.isArray(omit) || omit.some((e) => typeof e !== 'string')) {
    throw new Error('publication-omit.json: "omit" must be an array of strings');
  }
  return omit as string[];
})();

/** Is this suite-relative path removed by the publication cut? */
function omittedByPublication(rel: string): boolean {
  return PUBLICATION_OMIT.some((entry) =>
    entry.endsWith('/') ? rel.startsWith(entry) : rel === entry
  );
}

const SERVERS = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => /^bconnect-(.+)-mcp$/.exec(entry.name)?.[1])
  .filter((name): name is string => Boolean(name))
  .sort();

/**
 * Files that name a subset ON PURPOSE. The value is why.
 *
 * A file leaves this list by being converted to discovery or completed — the
 * list can only shrink, and a stale entry fails below rather than lingering.
 */
const DELIBERATE_SUBSETS: Record<string, string> = {
  '__tests__/descriptions-match-routes.test.ts':
    'the server SET is discovered (readdirSync over bconnect-*-mcp, since 2026-08-22); the ' +
    'remaining literals are per-tool fixture keys in rule tables (expected id parameter names, ' +
    'known-defect lists), not an enumeration',
  '__tests__/id-producers.test.ts':
    'three names appear in spot-check assertions (a jobs tool must cite bconnect-endpoints as ' +
    'producer); the producer table itself is discovered and asserted complete, insights included',
  '__tests__/suite-absent-empty-zero.test.ts':
    'the names sit inside the unconverted-route ratchet paths; membership tracks sub-resource ' +
    'conversion state, not the server population',
  'scripts/compare-estate-aggregates-by-scope.mjs':
    'imports only the servers whose modules export scope-noted composites — a property of the ' +
    'TOOL no directory walk supplies — and discovers every CREDENTIAL_SCOPE_NOTE module, ' +
    'refusing to run if one has no case (see the note below this table)',
  'scripts/demo/coverage-audit.mjs':
    'route-coverage audit over servers that OWN routes — insights owns none, the same reason ' +
    'generate-types names thirteen',
  'scripts/measure-response-bytes.mjs':
    'server dirs are discovered; the names appear as parent-id producer references ' +
    '(bconnect-endpoints/list_logical_groups), a property of the tool being measured',
  'scripts/phase2/all-servers-live-check.mjs':
    'thirteen CASES plus groups as an unquoted CANNOT_EXERCISE key with its reason — invisible ' +
    'to this scan\'s quoted-name regex — and the script itself refuses to run when any on-disk ' +
    'server is unaccounted, which is the completeness check this guard wants',
  'scripts/stdio-smoke.mjs': 'the Phase 1 server set, by definition — a historical smoke test',
  'scripts/verify-phase1.mjs': 'the Phase 1 server set, by definition',
  'scripts/phase2/write-gate-runtime-check.mjs':
    'the four tools ungated before the F21 patch, plus one control that was always gated',
  'scripts/phase2/patch-content-type-check.mjs': 'only the servers that declare a PATCH route',
  'scripts/v11/equivalence-probe.mjs': 'only the servers with a v1.1 counterpart',
  'scripts/demo/t2-payload-audit.mjs': 'a representative sample, chosen for payload weight',
  'scripts/demo/t2-lean-projection.mjs': 'the same sample as the payload audit it costs',
  'scripts/demo/t3-tokens.mjs': 'the tools in one demo stream',
  'scripts/demo/patch-loop-baseline.mjs': 'the tools in one demo stream',
  'scripts/demo/d21-serialization-check.mjs': 'a representative sample of response shapes',
  'scripts/demo/fix-tool-metadata-check.mjs': 'the servers touched by that fix',
  'scripts/generate-types.mjs':
    'only servers that OWN routes and therefore have src/generated/ — insights owns none',
  'install/lib/test-host-emitters.mjs': 'the servers the host-config emitters were written against',
  'packages/mcp-core/src/__tests__/server-scoped-credentials.test.ts':
    'server names are example ARGUMENTS to a pure name->scope function, not an enumeration',
  'packages/mcp-core/src/id-producers.ts':
    'a producer table keyed by id parameter, not by server; id-producers.test.ts discovers and ' +
    'asserts every required id resolves, insights included',
};

// `scripts/compare-estate-aggregates-by-scope.mjs` was added here on 2026-08-16
// and REMOVED the same hour, by this file's own ratchet. It names four servers
// in its imports — which module and which builder a composite needs are
// properties of the TOOL that no directory walk supplies — but it also
// discovers every module carrying CREDENTIAL_SCOPE_NOTE and REFUSES to run if
// one has no case. Discovery is what makes the four names safe, so the
// exemption was spent as soon as it was written. Recorded because the sequence
// is the point: the guard demanded an exception, the fix made it unnecessary,
// and the guard then said so.

/** Strip comments, so a server named in PROSE is not mistaken for a list. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Absolute paths of every file GIT TRACKS.
 *
 * The walk below reads the WORKING TREE, which made this guard report a
 * different answer per machine. `scripts/demo/spec-*` is gitignored on purpose
 * — .gitignore records why: those probes carry hostnames and their captured
 * output carries real endpoint GUIDs and estate topology, and the Phase 4 audit
 * closed that early. So the file is present on the box it was written on and
 * absent from every clone. It held a DELIBERATE_SUBSETS entry, which therefore
 * resolved locally and went stale on CI, red on all four legs of the first run.
 *
 * A guard whose verdict depends on untracked files answers a question about
 * somebody's disk, not about this repository. git is the authority on which
 * one it is.
 */
function tracked(): Set<string> {
  let top: string;
  let list: string;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    list = execFileSync('git', ['ls-files', '-z'], {
      cwd: top, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // Never a silent skip. Without git this guard cannot tell a repository
    // file from a local scratch file, and guessing is the defect it exists
    // to catch.
    throw new Error(
      'suite-no-hardcoded-server-lists needs git to tell tracked files from ' +
        'untracked ones, and git is unavailable here: ' + String(err)
    );
  }
  const files = list.split(String.fromCharCode(0)).filter(Boolean);
  if (files.length === 0) {
    throw new Error('git ls-files returned nothing — refusing to scan an empty set');
  }
  return new Set(files.map((rel) => join(top, rel)));
}
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) {return;}
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'build', 'coverage', 'out', 'generated'].includes(entry.name)) {continue;}
        walk(full);
      } else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        found.push(full);
      }
    }
  };
  walk(join(ROOT, '__tests__'));
  walk(join(ROOT, 'scripts'));
  walk(join(ROOT, 'packages'));
  walk(INSTALL_LIB);
  const inRepo = tracked();
  return found.filter((f) => inRepo.has(f)).sort();
}

describe('no guard enumerates servers by hand without saying so', () => {
  const scanned = sourceFiles().map((file) => {
    const source = readFileSync(file, 'utf8');
    const body = code(source);
    const named = SERVERS.filter((server) =>
      new RegExp(`['"\`](?:bconnect-)?${server}(?:-mcp)?['"\`/]`).test(body)
    );
    return {
      // Suite-root-relative, POSIX, layout-independent — see `suiteRelative`.
      // Twice now this one expression has been the entire defect while the scan
      // around it worked perfectly.
      rel: suiteRelative(file),
      named,
    };
  });

  it('finds the files that enumerate servers at all — the canary', () => {
    // If this collapses the scan broke, and every assertion below passes for
    // the wrong reason.
    expect(SERVERS.length).toBeGreaterThanOrEqual(14);
    expect(scanned.filter((f) => f.named.length >= 3).length).toBeGreaterThan(5);

    // And that `rel` is actually repo-relative. The scan itself was never the
    // thing that broke: on Linux it found every file correctly and only the
    // path NORMALISATION failed, so the two assertions above stayed green while
    // every exemption silently stopped resolving. This names that directly
    // rather than letting it resurface as 31 unexplained entries.
    const notRelative = scanned
      .map((f) => f.rel)
      .filter((r) => r.startsWith('/') || /^[A-Za-z]:/.test(r) || r.includes(String.fromCharCode(92)));
    expect(
      notRelative,
      `${notRelative.length} scanned path(s) are not repo-relative POSIX paths, so no ` +
        `DELIBERATE_SUBSETS key can match them and every exemption silently stops ` +
        `applying: ${notRelative.slice(0, 3).join(', ')}`
    ).toEqual([]);

    // And now the INVARIANT, rather than the two shapes that happened to break
    // it. `bconnect-publication/scripts/x` is relative, POSIX, and carries no
    // backslash or drive letter — it satisfies every assertion above and still
    // matches no exemption key. A canary calibrated against the previous
    // failure cannot see the next one; that is how this project's last canary
    // (`CALLS.length >= 9`, a floor copied from what the broken parser had
    // found) moved in lockstep with its own blind spot.
    //
    // So account for every key exactly: each either resolves to a scanned file
    // or is declared omitted by the publication cut. Nothing unexplained.
    const keys = Object.keys(DELIBERATE_SUBSETS);
    const resolved = new Set(scanned.map((f) => f.rel));
    const unexplained = keys.filter((k) => !resolved.has(k) && !omittedByPublication(k));
    expect(
      unexplained,
      `${unexplained.length} of ${keys.length} DELIBERATE_SUBSETS key(s) neither resolve to a ` +
        `scanned file nor are declared in publication-omit.json. Either the path derivation ` +
        `stopped matching this layout, or these files were removed without declaring it: ` +
        `${unexplained.slice(0, 5).join(', ')}`
    ).toEqual([]);

    // Count the population a SECOND way and require agreement. `unexplained`
    // above is empty both when every key resolves and when every key is
    // declared omitted; this forbids the second reading.
    const resolving = keys.filter((k) => resolved.has(k));
    expect(
      resolving.length,
      'no DELIBERATE_SUBSETS key resolves to a scanned file — the path derivation is broken'
    ).toBeGreaterThanOrEqual(3);
  });

  it('has no hand-written server list that is incomplete and unexplained', () => {
    const offenders = scanned
      .filter((f) => f.named.length >= 3 && f.named.length < SERVERS.length)
      .filter((f) => !(f.rel in DELIBERATE_SUBSETS))
      .map((f) => `${f.rel} names ${f.named.length}/${SERVERS.length}, missing: ${
        SERVERS.filter((s) => !f.named.includes(s)).join(', ')
      }`);

    expect(
      offenders,
      'a hand-written server list that omits a server does not fail — it reports a clean result ' +
        'for something it never looked at. Discover the servers, complete the list, or add the ' +
        'file to DELIBERATE_SUBSETS with the reason.'
    ).toEqual([]);
  });

  it('has no DELIBERATE_SUBSETS entry that has gone stale', () => {
    // The ratchet's other direction: a file that now names every server, or no
    // longer names three, must leave the list — otherwise the list accumulates
    // permissions nobody re-examines. ("Now discovers" used to count here too;
    // with discovery no longer absolving, it no longer retires an entry.)
    const byRel = new Map(scanned.map((f) => [f.rel, f]));
    const stale = Object.keys(DELIBERATE_SUBSETS).filter((rel) => {
      const f = byRel.get(rel);
      // Absent is legal ONLY when the publication cut declares it removed.
      // Absent-and-undeclared is still stale: that is the ratchet.
      if (!f) {return !omittedByPublication(rel);}
      return f.named.length < 3 || f.named.length >= SERVERS.length;
    });
    expect(stale, 'these no longer need an exception — delete their line').toEqual([]);
  });
});
