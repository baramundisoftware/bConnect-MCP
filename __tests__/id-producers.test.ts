/**
 * Every opaque id a tool requires must say where it comes from.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * 147 of 218 tools require at least one opaque GUID. 127 of them said nothing
 * about where to get it, and **no description anywhere named another server** —
 * while 33 tools across 8 servers consume an id only a different server can
 * produce. `list_logical_groups` appeared in zero descriptions, and it is the
 * sole producer of a GUID that tools in five other servers demand.
 *
 * For a public release that is not cosmetic. Nothing in the catalogue or the
 * deployment guide gives a deployer any reason to think the 13 servers are
 * anything but independent, so a perfectly reasonable subset can be mounted
 * from which some tools are simply uncallable.
 *
 * ── What this guards ────────────────────────────────────────────────────────
 * The annotation is applied centrally in `defineToolCatalogue` from a table in
 * `packages/mcp-core/src/id-producers.ts`. A table is a hand-maintained
 * parallel list, which in this project is a synonym for "drifts" — so this
 * checks it against the live catalogue in both directions:
 *
 *   1. Every producer the table names must EXIST as an advertised tool.
 *   2. Every required id parameter must resolve to a producer or an explicit
 *      no-producer explanation. Silence fails.
 *   3. A producer must never be the tool that consumes the id. Five
 *      descriptions used to be circular — `list_ad_subgroups` said "use
 *      get_ad_group to find the parent group GUID first", and `get_ad_group`
 *      requires that same GUID.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ID_PRODUCERS, resolveProducer } from '@bconnect/mcp-core';

const ROOT = join(__dirname, '..');
/**
 * Every server, DISCOVERED — never a hand-written list.
 *
 * ── What the hand-written list cost (found 2026-08-14) ──────────────────────
 * It named thirteen servers. `bconnect-insights-mcp` shipped on 2026-08-11/12
 * and was never added, so for three days **both catalogue ceilings measured
 * thirteen servers out of fourteen** and 7,586 B of catalogue — five tools —
 * sat entirely outside the ratchet. Both ceilings passed with ~100 B of
 * headroom; with insights included they are 7,488 B and 7,531 B OVER.
 *
 * The ceilings did not drift. They were measuring a smaller catalogue than the
 * one they claimed to bound, and every raise recorded below was itemised
 * against that smaller catalogue. This is the same defect as ARCH-1's blind
 * scan and ARCH-2's first cut — a guard that silently omits a whole server does
 * not fail, it reports a clean figure for a thing it never looked at.
 *
 * Discovery closes it for the fifteenth server as well as the fourteenth.
 * `bconnect-mcp-gateway` and `bconnect-server-template` do not end in `-mcp`
 * and so are correctly outside the pattern.
 */
const SERVERS: readonly string[] = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => /^bconnect-(.+)-mcp$/.exec(e.name)?.[1])
  .filter((name): name is string => Boolean(name))
  .sort();

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
}
interface Entry { server: string; tool: ToolDef }

const entries: Entry[] = [];
const advertised = new Set<string>();
/** Catalogue bytes with and without the annotation, for the token budget. */
let annotatedBytes = 0;
/** The same catalogue with the write gate shut — the default posture. */
let defaultPostureBytes = 0;
let defaultPostureTools = 0;

/**
 * The write-gate-open catalogue ceiling. Named rather than inline because the
 * test reports the remaining headroom, and a ceiling quoted in two places is
 * one that will eventually disagree with itself. The reasoning for its current
 * value, and for every raise, is at the assertion.
 */
/**
 * Raised 186,050 -> 194,000 on 2026-08-14, and this is a CORRECTION, not growth.
 *
 * Nothing was added. The ceiling had been measuring thirteen of fourteen
 * servers (see SERVERS above): the true write-enabled catalogue is
 * **193,581 B / 221 tools**, which is 7,531 B over the old figure — and the
 * 7,586 B difference is `bconnect-insights-mcp`, which the list never named.
 * Confirmed two ways, by this suite once discovery was in place and
 * independently by `node install/lib/measure-tools.mjs --root bConnect-MCP-main
 * --release 26R1` with `ALLOW_WRITE_OPERATIONS=true`, which agree to the byte.
 *
 * Headroom is the same ~400 B as every raise before it, not bought in advance.
 */
const CATALOGUE_CEILING = 194_000;

/**
 * The DEFAULT-posture ceiling — the same catalogue with the write gate shut.
 *
 * This one is new on 2026-08-07 and it is the half of the problem that was
 * missing. The write-enabled ceiling above is the pessimistic bound; the
 * default posture is what most deployers actually load and what this project's
 * own summary tables quote. Nothing measured it, so it drifted 118,929 ->
 * 123,393 -> 125,599 -> 125,862 B across three sessions, each time discovered
 * by someone re-measuring by hand rather than by a failing test.
 *
 * Same headroom rule as the ceiling above: ~400 B, not bought in advance.
 *
 * Raised 128,900 -> 129,650 on 2026-08-13 alongside the write-posture ceiling,
 * for the same single change: the `list_os_windows_endpoints` compact
 * projection, +438 B measured (128,792 -> 129,230). Headroom here had eroded to
 * 108 B — the thinnest it has ever been — so this raise also restores the ~400 B
 * the rule asks for rather than leaving the next author with no room to measure
 * in. The response saving that buys it is at the write-posture assertion below.
 *
 * Raised again 129,650 -> 131,850 the same day for the AD row projection across
 * nine tools: +2,187 B measured (129,230 -> 131,417), buying -12,944 B (-23.3%)
 * over the whole AD population. Itemised at the write-posture assertion below.
 * Two raises in one day is worth a note: both are response-shaping trades, both
 * repay inside one call of the tool they touch, and the second is the larger
 * bet — nine tools rather than one — which is why it was measured across every
 * page of the population rather than the first.
 */
/**
 * Raised 131,850 -> 139,750 on 2026-08-14. Same correction as the ceiling
 * above, same cause: the true default-posture catalogue is **139,338 B across
 * 141 tools**, 7,488 B over the old figure, because `bconnect-insights-mcp`'s
 * five tools were never in the measured set. Also confirmed independently by
 * `measure-tools.mjs`, to the byte.
 *
 * This row is the one the project's summary tables quote, and it had gone stale
 * a fourth time as a result — HANDOFF.md §1 was corrected the same day.
 */
const DEFAULT_POSTURE_CEILING = 139_750;

/** "440 B under the 179,700 B ceiling" / "120 B OVER …" — readable either way. */
function slack(actual: number, ceiling: number): string {
  const remaining = ceiling - actual;
  const side = remaining >= 0 ? 'under' : 'OVER';
  return `(${Math.abs(remaining).toLocaleString()} B ${side} the ${ceiling.toLocaleString()} B ceiling)`;
}

beforeAll(async () => {
  process.env.VITEST = 'true';
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  for (const name of SERVERS) {
    const entry = join(ROOT, `bconnect-${name}-mcp`, 'build', 'index.js');
    if (!existsSync(entry)) {continue;}
    const mod = await import(`${pathToFileURL(entry).href}?idprod=1`);
    const { server } = mod.createServer();
    const handlers = (server as {
      _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>>;
    })._requestHandlers;
    const list = await handlers.get('tools/list')?.({ method: 'tools/list' });
    for (const tool of list?.tools ?? []) {
      entries.push({ server: name, tool });
      advertised.add(tool.name);
    }
    annotatedBytes += Buffer.byteLength(JSON.stringify(list?.tools ?? []), 'utf8');
  }

  // Second pass, write gate SHUT — the posture a deployer gets by default.
  // A fresh import per pass (the query string busts the module cache) because
  // the write gate is read when the catalogue is built, not per request, so
  // reusing the instance above would measure the same 216 tools twice.
  process.env.ALLOW_WRITE_OPERATIONS = '';
  for (const name of SERVERS) {
    const entry = join(ROOT, `bconnect-${name}-mcp`, 'build', 'index.js');
    if (!existsSync(entry)) {continue;}
    const mod = await import(`${pathToFileURL(entry).href}?idprod=default`);
    const { server } = mod.createServer();
    const handlers = (server as {
      _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>>;
    })._requestHandlers;
    const list = await handlers.get('tools/list')?.({ method: 'tools/list' });
    defaultPostureTools += (list?.tools ?? []).length;
    defaultPostureBytes += Buffer.byteLength(JSON.stringify(list?.tools ?? []), 'utf8');
  }
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  process.env.ALLOW_WRITE_OPERATIONS = '';
}, 120_000);

describe('the id-producer table matches the catalogue', () => {
  it('every producer it names is a tool that exists', () => {
    const ghosts = Object.entries(ID_PRODUCERS)
      .filter(([, producer]) => !advertised.has(producer.split('/')[1]!))
      .map(([key, producer]) => `${key} -> ${producer}`);
    expect(
      ghosts,
      `the table names ${ghosts.length} producer(s) that no server advertises. A pointer to a ` +
        `tool that does not exist is worse than no pointer:\n  ${ghosts.join('\n  ')}`
    ).toEqual([]);
  });

  it('no id points at the tool that consumes it', () => {
    // The circular-reference class. `#id` keys carry their own tool name.
    const circular = Object.entries(ID_PRODUCERS)
      .filter(([key, producer]) => key.endsWith('#id') && key.slice(0, -4) === producer.split('/')[1])
      .map(([key]) => key);
    expect(circular, `${circular.length} id(s) name their own consumer as their producer`).toEqual([]);
  });

  it('every required id parameter resolves, or explains why it cannot', () => {
    const silent: string[] = [];
    let required = 0;

    for (const { server, tool } of entries) {
      const props = tool.inputSchema?.properties ?? {};
      for (const name of tool.inputSchema?.required ?? []) {
        if (!/id$/i.test(name)) {continue;}
        required++;
        const { producer, note } = resolveProducer(tool.name, name);
        if (producer || note) {continue;}
        // A description that already names a producer by hand also counts.
        if (/\b(list_|get_)[a-z_]+/.test(String(props[name]?.description ?? ''))) {continue;}
        silent.push(`${server}/${tool.name}.${name}`);
      }
    }

    expect(required, 'no required id parameters found; the catalogue probably failed to load').toBeGreaterThan(50);
    expect(
      silent,
      `${silent.length} required id parameter(s) say nothing about where the id comes from. ` +
        `Add the producer to ID_PRODUCERS, or an explanation to NO_PRODUCER if nothing in the ` +
        `API can produce it:\n  ${silent.join('\n  ')}`
    ).toEqual([]);
  });
});

describe('the annotation reaches the advertised surface', () => {
  it('a cross-server producer is named WITH its server, a local one without', () => {
    const byName = new Map(entries.map((e) => [e.tool.name, e]));

    // logicalGroupId in bconnect-jobs is produced by bconnect-endpoints.
    const foreign = [...byName.values()].find(
      (e) => e.server === 'jobs' && e.tool.inputSchema?.properties?.logicalGroupId
    );
    expect(foreign, 'expected a jobs tool taking logicalGroupId').toBeDefined();
    const foreignText = String(foreign!.tool.inputSchema!.properties!.logicalGroupId!.description);
    expect(foreignText).toContain('list_logical_groups');
    expect(foreignText).toContain('bconnect-endpoints');

    // The same id inside bconnect-endpoints names the tool without a server.
    const local = byName.get('list_endpoints_by_logical_group');
    expect(local, 'expected list_endpoints_by_logical_group').toBeDefined();
    const localText = String(local!.tool.inputSchema!.properties!.logicalGroupId!.description);
    expect(localText).toContain('list_logical_groups');
    expect(localText).not.toContain('bconnect-endpoints');
  });

  it('an id nothing can produce says so instead of staying silent', () => {
    const byName = new Map(entries.map((e) => [e.tool.name, e]));
    const mw = byName.get('get_maintenance_window_for_endpoint');
    expect(mw).toBeDefined();
    const text = String(mw!.tool.inputSchema!.properties!.id!.description);
    // The tool name says "maintenance window"; the route wants an ENDPOINT id,
    // and nothing lists maintenance windows. Both halves have to be said.
    expect(text).toContain('ENDPOINT GUID');
    expect(text).toContain('No tool lists maintenance windows');

    const assign = byName.get('assign_job_to_static_group');
    expect(assign).toBeDefined();
    const staticText = String(assign!.tool.inputSchema!.properties!.staticGroupId!.description);
    expect(staticText).toContain('bMC console');
  });

  it('costs a proportionate number of bytes, and reports them', () => {
    // Measured rather than assumed, and asserted as a SHARE of the catalogue
    // rather than an absolute — an absolute ceiling would drift with every
    // tool added and would eventually be raised without anyone re-deciding
    // whether the annotation still earns its bytes.
    //
    //   default posture   114,553 B -> 118,913 B   +4,360 B  (+3.8%,  96 sites)
    //   write gate open   159,547 B -> 167,528 B   +7,981 B  (+5.0%, 174 sites)
    //
    // ~1,090 tokens in the posture most deployers run, against a wasted turn
    // per id lookup across 147 tools. A turn costs far more than that.
    let added = 0;
    for (const { tool } of entries) {
      for (const [name, spec] of Object.entries(tool.inputSchema?.properties ?? {})) {
        if (!/id$/i.test(name)) {continue;}
        const { producer, note } = resolveProducer(tool.name, name);
        if (!producer && !note) {continue;}
        const desc = String(spec?.description ?? '');
        // The annotation is the tail of the description.
        const tail = producer ? desc.slice(desc.lastIndexOf('From ')) : (note ?? '');
        added += tail.length;
      }
    }
    const share = added / annotatedBytes;
    console.log(
      `[id-producers] annotation costs ${added.toLocaleString()} B of ` +
        `${annotatedBytes.toLocaleString()} B (${(share * 100).toFixed(1)}% of the ` +
        `write-gate-open catalogue)`
    );
    expect(share).toBeLessThan(0.08);
  });

  it('stays within the catalogue byte budget', () => {
    // Token budget: this buys a turn saved per id lookup, and it must not cost
    // more than that is worth. Reported so the number is visible rather than
    // assumed — the suite-wide catalogue was 112,214 B before this work.
    // Headroom is reported, not just the total. A ceiling absorbs growth
    // silently by design: the 2026-08-07 raise below happened because 263 B
    // landed under an unchanged ceiling and nobody saw the slack go from 403 B
    // to 140 B. The number that erodes is the one worth printing.
    console.log(
      `[id-producers] annotated catalogue (write gate open, ${SERVERS.length} servers): ` +
        `${annotatedBytes.toLocaleString()} B ${slack(annotatedBytes, CATALOGUE_CEILING)}`
    );
    // The write-gate-open catalogue across all discovered servers. A deployer runs a
    // subset of these; the whole-suite figure is the pessimistic bound.
    //
    // Raised 175,000 -> 176,000 on 2026-08-04, with the measurement rather than
    // an estimate: 174,590 B before, 175,577 B after — **+987 B**, all of it
    // `preview_assignment` gaining three group ids and the prose that explains
    // them. What it buys is not cosmetic: three of the four `assign_job_to_*`
    // tools had NO preview at all, and a parameter absent from the schema is
    // not merely undocumented, it is unreachable — the unknown-parameter
    // validator refuses it. So this is the byte cost of making a safety tool
    // cover the writes it guards.
    //
    // Raised 176,000 -> 179,400 on 2026-08-04 (final eval). 175,577 B before,
    // 178,997 B after — **+3,420 B**, measured per server by rebuilding each
    // changed workspace at both revisions, not estimated:
    //   servermanagement +1,214   activedirectory +1,026
    //   compliance         +602   assets            +578
    // servermanagement is a correctness fix (ARCH-7): four write tools named a
    // `description` field and a member list that `SecurityGroupForCreation` and
    // `SecurityProfileForCreation` do not declare, and both bodies are
    // `additionalProperties: false`. The other three are the OPT-3 / OPT-4 /
    // AUD-optimization-1 shapers, and they are a TRADE, not a cost: the
    // catalogue is paid once per session, the response on every call. Measured
    // savings are 3,360 B per 20-row `list_assets` page and 3,846 B per full AD
    // pull, so each repays its own catalogue bytes inside the first call and is
    // pure saving thereafter. That asymmetry is the only reason this ratchet
    // moves for a token change.
    //
    // Raised 179,400 -> 179,700 on 2026-08-07, and this one is a CORRECTION as
    // much as a raise: the growth had already landed, under the old ceiling,
    // without anyone re-deciding it. Measured by the method above — revert the
    // changed servers' src to 09d97bb, rebuild, measure per server — and the
    // whole delta is one server and one string:
    //   compliance  11,006 -> 11,269 B   +263 B
    //   every other server byte-identical; 178,997 B reproduced exactly
    // It is `get_unpatched_endpoints`'s `reachableWithinDays` description, which
    // went from naming the default to explaining how to choose it. That tool is
    // the one that served a false all-clear over 1,522 critical vulnerabilities,
    // and the mechanism was a reachability window too short for the estate — so
    // the added prose is the fix's other half, and it is worth 263 B by the same
    // argument the ARCH-7 raise above was.
    //
    // Raised 179,700 -> 180,150 on 2026-08-11 for the `list_asset_types`
    // shaper, the first commit off the response-shaping backlog. Attributed to
    // the byte rather than estimated — one tool, two components:
    //   description  206 -> 441 B   +235 B  (says it is compact and names the
    //                                        three escape hatches)
    //   detail+fields schema         +233 B  (111 B + 120 B + separators)
    //                                =+468 B, and the observed delta was 468 B
    //
    // It is a TRADE by the same argument as the three shapers above, and this
    // one was measured against the live estate rather than simulated:
    // 6,564 -> 4,843 B per call, 1,721 B saved (-26.2%) on a 15-row page. So it
    // repays its 468 catalogue bytes on the FIRST call and is 1,253 B ahead by
    // the end of it. It was also chosen because it is strictly lossless -
    // `dropConstantColumns` alone, every value still recoverable from
    // meta.constant - so there is no information trade sitting underneath the
    // byte trade.
    //
    // Raised 180,150 -> 180,650 on 2026-08-11 for the `list_group_members`
    // shaper. Attributed to the byte, same method:
    //   description  +270 B   (says the endpoint rows are compact, that
    //                          childGroups rows are NOT, and names the hatches)
    //   detail+fields schema  +233 B
    //                        = +503 B, and the observed delta was 503 B
    //
    // The best trade in the suite so far, and measured live rather than
    // simulated: 19,864 -> 9,468 B, saving 10,396 B (-52.3%) on one 20-row page.
    // That is ~20x its own catalogue cost recovered on the FIRST call. It is the
    // largest single response in the suite and it reuses the projection already
    // shipped for list_endpoints, so it adds no new field-selection judgement.
    //
    // Raised 180,650 -> 181,200 on 2026-08-11 for the
    // `list_update_management_endpoints` shaper. Attributed to the byte:
    //   description  +332 B   (names the dropped provenance columns and the
    //                          three escape hatches)
    //   detail+fields schema  +233 B
    //                        = +565 B, and the observed delta was 565 B
    //
    // Measured live: 11,999 -> 8,049 B, -3,950 B (-32.9%) on a 20-row page. The
    // reason this one is worth its bytes on SOMEBODY ELSE'S estate too is that
    // the saving is structural rather than data-dependent: `dropConstantColumns`
    // alone would have saved 1,671 B here and **-32 B (a net LOSS)** on an
    // estate with three update profiles, because the profile columns are
    // constant only on this one. The projection therefore leads with dropping
    // three provenance columns, which measures -2,196 B (-18.4%) on a
    // three-profile page. See the shaper's header in that server.
    //
    // Raised 181,200 -> 181,700 on 2026-08-11 for the `list_org_units` shaper:
    //   description +255 B, detail+fields schema +233 B = +488 B, observed 488 B
    // Measured live 6,576 -> 3,296 B (-49.9%) on a page, and -50.2% across all
    // 133 org units — the whole population was walked because the review warned
    // page 1 might be skewed by CN=System containers. It is not: `comment` is
    // 50.9-52.4% of every one of the seven pages, and 52.8% pooled.
    //
    // Raised 181,700 -> 182,300 on 2026-08-11 for `list_variable_instances`,
    // and this one buys NO response bytes at all — it is +450 B of description
    // and no projection. Recorded because it is the first raise in this series
    // justified by ROUTING rather than by payload size.
    //
    // Measured: the tool is 859 instances over 43 pages on a 26-endpoint estate,
    // and it already declared Scope / Name / Category / countOnly filters that
    // its description never mentioned. In nine instrumented sessions a model
    // called it seven times as {PageSize} and {Page,PageSize} — walking pages,
    // never filtering — and it was the single largest observed byte consumer at
    // 67,964 B. There is nothing to project away: the three fattest columns are
    // variableDefinitionId (20.2%), ownerId (16.0%) and id (14.4%), all ids
    // other tools consume, and `value` is only 5.2%. Naming the filters is the
    // fix; a projection is not.
    //
    // Raised 182,300 -> 183,000 on 2026-08-11 for the write-tool schema
    // repairs (TOOL-REVIEW-MATRIX.md H1-H5 + software F1/F2): six tools,
    // itemized against the pre-fix catalogue dump —
    //   create_kiosk_release   +301 B  (assignmentTargetId rename + required +
    //                                   the polymorphic producer note)
    //   msw_cleanup            +90 B   (wasSuccessful disclosure)
    //   create_os_folder       +26 B   (lowercase body-key prose)
    //   create_software_bundle +21 B   (parentId rename)
    //   add_application_to_bundle -22 B (order removed)
    //   create_job_instance    -8 B    (scheduledStartTime removed, endpointId
    //                                   required, immediacy sentence)
    //                         = +408 B, and the observed delta was 408 B
    //                           (182,190 -> 182,598).
    // These buy correctness, not bytes: four of the six advertised parameters
    // their operations reject, and two asserted success they could not know.
    //
    // Raised 183,000 -> 183,300 on 2026-08-11 (same day) for the
    // link/unlink_entra_id_data mobile-only disclosures: +301 B observed
    // (182,598 -> 182,899). The route's own 404 means "no endpoint with the
    // specified ID" for any non-mobile id while the API's generic title reads
    // as a rights problem — measured live: a Windows endpoint id earned that
    // 404 with every profile permission open, and the first diagnosis blamed
    // credentials. The sentence exists so no model (or reviewer) re-derives
    // that dead end.
    //
    // Raised 183,300 -> 183,750 on 2026-08-13 for the
    // `list_os_windows_endpoints` compact projection: **+438 B measured**
    // (182,899 -> 183,337), being +233 B of schema (`detail` and `fields` join
    // `countOnly`, so the escape hatch exists at all) and +205 B of prose
    // stating that the response is projected and where the removals are named.
    //
    // This is the first raise bought by a RESPONSE saving rather than by a
    // capability, and the arithmetic is the whole justification: the catalogue
    // is paid once per session, the response on every call. Measured live the
    // same day, that one tool went 8,298 B -> 6,404 B, so **+438 B once buys
    // -1,894 B per call and repays itself on the first call**. See
    // BYTE-RANKING-2026-08-13.md for how the tool was chosen: its nested
    // `operatingSystem` block was 46% of the response and stated the version
    // twice.
    //
    // Raised 183,750 -> 185,950 on 2026-08-13 (same day) for the AD row
    // projection across NINE tools: **+2,187 B measured** (183,337 -> 185,524).
    // Per tool that is +213 B of schema (`detail`/`fields`) and ~+7 B of prose,
    // the prose being near-free because the sentence it replaces had become
    // WRONG: "comment restates ldapPath … replaced with '{ldapPath}'" describes
    // the detail path only, and on the default path comment is now gone
    // entirely, so a model reading it would hunt for an absent field.
    //
    // What it buys, measured over the WHOLE population rather than one page
    // (60 objects, 52 groups, 8 users): 55,571 -> 42,627 B, **-12,944 B
    // (-23.3%)**, or ~2,000 B on a single default 20-row call. Break-even is
    // one AD call — and the cost is only paid by a deployment that connects the
    // activedirectory domain, which is precisely the one that makes those calls.
    //
    // Headroom is deliberately left at ~400 B, matching the 403 B, 410 B and
    // 423 B that existed before, so the ceiling stays a ratchet and the next
    // addition has to justify itself the same way. Do not raise this to buy room
    // in advance.
    //
    // What this ceiling does NOT guard: the DEFAULT-posture figure, which is
    // what most deployers actually load and what the project's own summary
    // tables quote. It moved 125,599 -> 125,862 B on the same change and no test
    // noticed, which is why that row has now gone stale three times.
    expect(annotatedBytes).toBeLessThan(CATALOGUE_CEILING);
  });

  it('measures every server that exists, so a ceiling cannot pass by omission', () => {
    // The other half of the 2026-08-14 finding. Discovery fixes the hand-written
    // list; this fixes the SILENT SKIP beside it — `if (!existsSync(entry))
    // continue` drops a server whose build is missing, which lowers both totals
    // and lets both ceilings pass for the same reason the missing insights entry
    // did. An unbuilt server must fail loudly, not quietly shrink the catalogue.
    const missing = SERVERS.filter(
      (name) => !existsSync(join(ROOT, `bconnect-${name}-mcp`, 'build', 'index.js'))
    );
    expect(
      missing,
      'these servers have no build, so the byte figures below do not cover them — run npm run build'
    ).toEqual([]);

    // Vacuity: discovery really did find the servers. A regex that matched
    // nothing would make every assertion here pass over an empty catalogue.
    expect(SERVERS.length).toBeGreaterThanOrEqual(14);
    expect(SERVERS).toContain('insights');
    const measured = new Set(entries.map((e) => e.server));
    expect([...SERVERS].filter((s) => !measured.has(s))).toEqual([]);
  });

  it('stays within the DEFAULT-posture byte budget too', () => {
    console.log(
      `[id-producers] default posture (write gate shut, ${SERVERS.length} servers): ` +
        `${defaultPostureBytes.toLocaleString()} B across ${defaultPostureTools} tools ` +
        `${slack(defaultPostureBytes, DEFAULT_POSTURE_CEILING)}`
    );

    // The gate must actually be shut, or this measures the ceiling above a
    // second time and passes for the wrong reason. 221 write-enabled, 141 here.
    expect(
      defaultPostureTools,
      'the default posture advertised as many tools as the write-enabled one, so the write ' +
        'gate did not shut for this pass and the byte figure below is not the default posture'
    ).toBeLessThan(entries.length);

    // Set 2026-08-07 at the first measurement anyone made of this figure:
    // 125,862 B / 136 tools, with the same ~400 B headroom as the ceiling above.
    //
    // Why it needs its own ratchet rather than riding on that one: the two move
    // together only when a change touches a read tool. A write tool's
    // description can grow by a kilobyte without this figure moving at all, and
    // — the case that actually happened — a READ tool's description grew 263 B
    // and BOTH moved, while only the write-enabled one was being watched, and it
    // had enough slack to absorb it silently. This figure is the one quoted in
    // the project's summary tables and the one a default deployment pays.
    expect(defaultPostureBytes).toBeLessThan(DEFAULT_POSTURE_CEILING);
  });
});
