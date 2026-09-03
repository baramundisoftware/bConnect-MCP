/**
 * A tool description must be true of the route it calls.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Nothing in 1,455 tests asserted it. The suite has guards for whether a tool
 * DISPATCHES (`every-advertised-tool-dispatches`), whether its schema matches
 * the generated types (`suite-schema-vs-types`), and whether its name collides
 * (`suite-tool-names`) — and none of them reads the prose, which is the only
 * part of a tool an LLM actually uses to decide whether to call it.
 *
 * The Phase 4 ergonomics audit found eleven top-tier defects living in a fully
 * green build because of that gap. Two shapes recur:
 *
 *   A promise the route cannot keep. Nine tools name fields in their
 *   description that do not appear anywhere in their 200 response schema. A
 *   model asks for them, gets nothing back, and reports the absence as a fact
 *   about the estate — "no PXE relay has an IP address configured" when the
 *   route simply never returned one.
 *
 *   A success that is not a success. The four `assign_job_to_*` tools are the
 *   only operations in all of 26R1 that declare HTTP 207, whose own summary
 *   reads "Group assignment fully or partially succeeded. Failed assignments
 *   may be listed in the response body." None of the four descriptions
 *   mentions it. This repo's own DEMO-RUN-OF-SHOW.md records a run where 1 of
 *   11 endpoints was accepted and 10 were refused by name — and the model sees
 *   a 2xx and reports the whole group as assigned.
 *
 * Both are set differences against artefacts the build already parses, which
 * is the point: they cannot be satisfied by writing vaguer prose.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Per the project rule. Each rule below records the mutation that proves it,
 * and `npm test` was run with that mutation applied before the rule was kept.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readToolDispatch, readModuleRoutes, type Dispatch } from './lib/tool-routes.js';

const ROOT = join(__dirname, '..');
const RELEASE = '26R1';

/**
 * Discovered, never hand-written. This was a 13-name literal that silently
 * omitted the 14th server (insights) for eleven days — and the anti-hand-list
 * guard could not see it, because an unrelated `readdirSync` (the spec-file
 * lookup below) satisfied its "discovers" heuristic. Found 2026-08-22 during
 * the insights per-tool review; the guard's heuristic was tightened the same
 * day so discovery no longer absolves an incomplete literal.
 *
 * Insights' five composites map to no single operation and land in
 * `unmapped`, which the coverage floor at the bottom accounts for. Discovery
 * makes the next server appear here without anyone remembering to add it.
 */
const SERVERS = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => /^bconnect-(.+)-mcp$/.exec(e.name)?.[1])
  .filter((n): n is string => Boolean(n))
  .sort();

// ─── Spec loading: 200-response property names, and declared statuses ────────

interface SpecSchema {
  $ref?: string;
  type?: string;
  properties?: Record<string, SpecSchema>;
  items?: SpecSchema;
  allOf?: SpecSchema[];
}
interface SpecOperation {
  responses?: Record<string, { content?: Record<string, { schema?: SpecSchema }> }>;
  requestBody?: { content?: Record<string, { schema?: SpecSchema }> };
  parameters?: { name?: string; in?: string }[];
}
interface SpecDoc {
  paths?: Record<string, Record<string, SpecOperation>>;
  components?: { schemas?: Record<string, SpecSchema> };
}

/** module segment -> parsed spec. */
const specs = new Map<string, SpecDoc>();

function loadSpec(moduleSegment: string): SpecDoc | undefined {
  if (specs.has(moduleSegment)) {return specs.get(moduleSegment);}
  const dir = resolve(ROOT, 'openapi-specs', RELEASE);
  if (!existsSync(dir)) {return undefined;}
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const file = readdirSync(dir).find(
    (f) => norm(f.replace('bConnect_', '').replace('.json', '')) === norm(moduleSegment)
  );
  if (!file) {return undefined;}
  const doc = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SpecDoc;
  specs.set(moduleSegment, doc);
  return doc;
}

/** The operation at a wildcarded path template + verb, if the spec has one. */
function operationAt(doc: SpecDoc, specPath: string, verb: string): SpecOperation | undefined {
  const wild = (p: string) => p.replace(/\{[^}]*\}/g, '{}');
  const want = wild(specPath);
  for (const [p, verbs] of Object.entries(doc.paths ?? {})) {
    if (wild(p) !== want) {continue;}
    return verbs[verb.toLowerCase()];
  }
  return undefined;
}

/**
 * Every property name reachable in a schema, following `$ref`, `items` and
 * `allOf`. Depth-bounded and cycle-guarded — bConnect schemas self-reference
 * (a folder contains folders), and an unbounded walk does not return.
 */
function propertyNames(
  schema: SpecSchema | undefined,
  doc: SpecDoc,
  seen = new Set<string>(),
  depth = 0
): Set<string> {
  const out = new Set<string>();
  if (!schema || depth > 6) {return out;}
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()!;
    if (seen.has(name)) {return out;}
    seen.add(name);
    return propertyNames(doc.components?.schemas?.[name], doc, seen, depth + 1);
  }
  for (const part of schema.allOf ?? []) {
    for (const n of propertyNames(part, doc, seen, depth + 1)) {out.add(n);}
  }
  if (schema.items) {
    for (const n of propertyNames(schema.items, doc, seen, depth + 1)) {out.add(n);}
  }
  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    out.add(name);
    for (const n of propertyNames(sub, doc, seen, depth + 1)) {out.add(n);}
  }
  return out;
}

// ─── The built catalogue ─────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

interface Mapped {
  server: string;
  tool: ToolDef;
  specPath: string;
  verb: string;
  moduleSegment: string;
}

const mapped: Mapped[] = [];
/** Tools with no single API operation behind them — composites, v1.1, removed. */
const unmapped: { server: string; tool: string }[] = [];
/**
 * EVERY advertised tool with whatever its dispatch case holds — mapped or not.
 * Rule I judges dispatch arms, and a composite's arm can misread `args` just
 * as easily as a mapped tool's, so it must not inherit `mapped`'s filter.
 */
const advertised: { server: string; tool: ToolDef; dispatch?: Dispatch }[] = [];

async function collect(): Promise<void> {
  const saved = process.env.ALLOW_WRITE_OPERATIONS;
  process.env.VITEST = 'true';
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  try {
    for (const name of SERVERS) {
      const dir = `bconnect-${name}-mcp`;
      const entry = join(ROOT, dir, 'build', 'index.js');
      if (!existsSync(entry)) {continue;}

      const mod = await import(`${pathToFileURL(entry).href}?descmatch=1`);
      const { server } = mod.createServer();
      const handlers = (server as {
        _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>>;
      })._requestHandlers;
      const list = await handlers.get('tools/list')?.({ method: 'tools/list' });

      const dispatch = readToolDispatch(ROOT, dir);
      const routes = readModuleRoutes(ROOT, dir);

      for (const tool of list?.tools ?? []) {
        const d = dispatch.get(tool.name);
        advertised.push({ server: name, tool, dispatch: d });
        const route = d?.method ? routes.get(d.method) : undefined;
        if (!route?.specPath || !route.moduleSegment) {
          unmapped.push({ server: name, tool: tool.name });
          continue;
        }
        mapped.push({
          server: name,
          tool,
          specPath: route.specPath,
          verb: route.httpVerb,
          moduleSegment: route.moduleSegment,
        });
      }
    }
  } finally {
    process.env.ALLOW_WRITE_OPERATIONS = saved ?? '';
  }
}

beforeAll(collect, 120_000);

// ─── Rule A — a partial success must be described as one ─────────────────────

describe('a tool whose route can partially succeed says so', () => {
  it('every operation declaring HTTP 207 names it in the tool description', () => {
    const silent: string[] = [];
    let declaring = 0;

    for (const m of mapped) {
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, m.verb);
      if (!op?.responses || !('207' in op.responses)) {continue;}
      declaring++;
      const text = (m.tool.description ?? '').toLowerCase();
      // Either the status code or the concept — the wording is the author's
      // choice, the disclosure is not.
      if (!/\b207\b/.test(text) && !/partial/.test(text)) {
        silent.push(`${m.server}/${m.tool.name} (${m.verb.toUpperCase()} ${m.specPath})`);
      }
    }

    // If this hits zero the rule has stopped testing anything — most likely
    // because the dispatch/route mapping broke, not because the API changed.
    expect(declaring, 'no operation declares 207; the route mapping is probably broken').toBeGreaterThan(0);
    expect(
      silent,
      `${silent.length} tool(s) call a route that can answer HTTP 207 "fully or partially ` +
        `succeeded" without saying so. A model reads 2xx as success and reports the whole ` +
        `group as assigned; DEMO-RUN-OF-SHOW.md records a real run where 1 of 11 was accepted ` +
        `and 10 were refused by name:\n  ${silent.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule B — a described field must exist in the response ───────────────────

/**
 * camelCase tokens in prose are field names in this catalogue's house style,
 * and nothing else is: ordinary English does not produce them. These are the
 * exceptions, all product or protocol nouns rather than response fields.
 */
const NOT_FIELD_NAMES = new Set([
  'bConnect', 'baramundi', 'bMS', 'bMC', 'macOS', 'iOS', 'iPadOS', 'tvOS',
  'jsonPatch', 'oAuth', 'openAPI', 'wSUS', 'bitLocker', 'entraID', 'intune',
  'remoteDesk', 'kiosk', 'vPP', 'sNMP', 'sSH', 'aD', 'oU', 'uPN',

  // ── This suite's OWN response vocabulary, which is not API fields ─────────
  //
  // A false positive found the hard way: wiring `createListShaper` into a
  // server means its description should say so — "columns null or identical on
  // the whole page are reported once under meta.projectedAway" — and this rule
  // then flagged `projectedAway` as a field the route's 200 schema does not
  // contain. Which is true, and entirely the point: it is a field WE add.
  //
  // Left unfixed, the rule pushes an author to delete accurate documentation
  // of our own contract in order to go green. A guard that rewards removing
  // true statements is worse than no guard.
  //
  // These are the names from shape-response.ts, count-only.ts and
  // result-trust.ts — the projection and trust contract — plus the paging
  // envelope, which bConnect returns around the data rather than inside a row.
  //
  // `omittedWhenEqual` joins them for the same reason: it is
  // job-instance-projection.ts's disclosure that a display-name column was
  // omitted only on the rows where it duplicated the name beside it. Naming it
  // in a description is the accurate thing to do, and it is ours, not bConnect's.
  'omittedWhenEqual',
  'projectedAway', 'nullColumns', 'fullModeHint', 'countOnly', 'resultTrustworthy',
  'resultTrustworthyReasons', 'totalItems', 'totalPages', 'currentPage', 'pageSize',
  'hasNextPage', 'hasPreviousPage', 'pagesFetched', 'instancesInEstate',
  'endpointsInEstate', 'endpointsExamined', 'endpointWalkTruncated',
]);

describe('a tool does not promise a field its route cannot return', () => {
  it('every field-shaped name in a description exists in the 200 response schema', () => {
    const broken: string[] = [];
    let checked = 0;
    // Reported, not swallowed. This rule can only check a tool whose route
    // declares a 200 body with properties, and a good many writes answer 204
    // or an empty 200 — a mutation test on one of those passes for the wrong
    // reason. Naming the blind spot is the difference between a guard and a
    // guard someone trusts more than it deserves.
    const unverifiable: string[] = [];

    for (const m of mapped) {
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, m.verb);
      const ok = op?.responses?.['200'] ?? op?.responses?.['201'];
      const schema = ok ? Object.values(ok.content ?? {})[0]?.schema : undefined;
      const fields = propertyNames(schema, doc);
      if (fields.size === 0) {
        unverifiable.push(`${m.server}/${m.tool.name}`);
        continue;
      }
      checked++;

      const lower = new Set([...fields].map((f) => f.toLowerCase()));
      // Also accept the input schema's own parameter names: a description that
      // says "filter by endpointName" is talking about an argument, not a
      // returned field, and that is legitimate.
      for (const p of Object.keys(m.tool.inputSchema?.properties ?? {})) {lower.add(p.toLowerCase());}

      const promised = (m.tool.description ?? '').match(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g) ?? [];
      const missing = [...new Set(promised)]
        .filter((t) => !NOT_FIELD_NAMES.has(t))
        .filter((t) => !lower.has(t.toLowerCase()));
      if (missing.length) {
        broken.push(`${m.server}/${m.tool.name}: ${missing.join(', ')}  (${m.verb.toUpperCase()} ${m.specPath})`);
      }
    }

    expect(checked, 'no route contributed a 200 schema; the spec loader is probably broken').toBeGreaterThan(0);
    console.log(
      `[descriptions] field promises checked on ${checked} tool(s); ${unverifiable.length} ` +
        `could not be checked (route declares no 200 body with properties)`
    );
    expect(
      broken,
      `${broken.length} tool description(s) name a field the route's 200 schema does not ` +
        `contain. A model asks for it, gets nothing, and reports the absence as a fact about ` +
        `the estate:\n  ${broken.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule D — a route with no response body cannot return anything ──────────

describe('a tool does not claim to return data from a route that returns none', () => {
  it('no description promises a body where the operation declares none', () => {
    // WHY THIS RULE AND NOT A PROSE RULE.
    //
    // The prose case — "returns the bundle and associated applications" where
    // no `applications` field exists — is real (nine tools had it) and is NOT
    // mechanically decidable. Descriptions paraphrase on purpose: `manufacturer`
    // is correctly described as "vendor", and any matcher strict enough to
    // catch "associated applications" also flags "vendor". A guard that fires
    // on good documentation gets silenced, and then it protects nothing.
    //
    // This is the decidable slice of the same defect. Where an operation
    // declares no response body at all — a 204, or a 200 with no content — a
    // description that says it "returns" something is false with certainty, no
    // paraphrase judgement required.
    const lying: string[] = [];
    let bodiless = 0;

    // The negative lookahead is the whole rule, and I got it wrong first.
    //
    // A bare /returns?/ flagged eleven tools whose descriptions say exactly the
    // right thing — "Returns no content on success", "returns no content on
    // success (204)". That is a guard firing on GOOD documentation, which is
    // the failure mode this file's own Rule B comment warns about, and it was
    // caught only by reading the eleven rather than trusting the count.
    //
    // So a claim counts only when it is not immediately negated.
    const CLAIMS_A_BODY =
      /\b(?:returns?|reports?|responds with|yields)\s+(?!no\b|nothing\b|none\b|not\b)/i;

    for (const m of mapped) {
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, m.verb);
      if (!op?.responses) {continue;}

      // Only the unambiguous case: a success response that declares no content
      // whatsoever. A 200 whose schema this parser cannot resolve is NOT this —
      // that is a limitation of the parser, and flagging it would be blaming a
      // description for our own gap.
      const success = op.responses['200'] ?? op.responses['201'] ?? op.responses['204'];
      if (!success) {continue;}
      const hasContent = Object.keys(success.content ?? {}).length > 0;
      if (hasContent) {continue;}
      bodiless++;

      const text = m.tool.description ?? '';
      if (CLAIMS_A_BODY.test(text)) {
        lying.push(
          `${m.server}/${m.tool.name} (${m.verb.toUpperCase()} ${m.specPath}) — the operation ` +
            `declares no response content, but the description says it returns something`
        );
      }
    }

    expect(bodiless, 'no bodiless operation found; the spec loader may have broken').toBeGreaterThan(0);
    expect(
      lying,
      `${lying.length} description(s) promise a payload from a route that declares none:\n  ` +
        lying.join('\n  ')
    ).toEqual([]);
  });
});

// ─── Rule E — a JSON Patch path a description names must be one the spec shows ──

describe('a description does not name a JSON Patch path the spec contradicts', () => {
  it('every /path a PATCH tool advertises appears in that route’s own example', () => {
    // The second time this exact defect has shipped here. `update_bitlocker_pin`
    // PATCHed `/Pin`, a path the API does not serve, and survived four review
    // rounds (finding B12). Then `patch_local_admin_user_credentials` told a
    // model "the only legal path is /requestedExpirationDate" while the 26R1
    // example writes `/LocalAdminAccount/RequestedExpirationDate` — so a caller
    // obeying the description earned the 400 the description warned about.
    //
    // Decidable: the request-body example is the only statement the spec makes
    // about what may be written, and a path named in prose either appears in it
    // or does not.
    const wrong: string[] = [];
    let checked = 0;

    for (const m of mapped) {
      if (m.verb.toLowerCase() !== 'patch') {continue;}
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, m.verb) as
        | (SpecOperation & { requestBody?: { content?: Record<string, { example?: unknown }> } })
        | undefined;
      const example = Object.values(op?.requestBody?.content ?? {})[0]?.example;
      if (!Array.isArray(example)) {continue;}

      const legal = new Set(
        example
          .map((o) => (o as { path?: unknown }).path)
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.toLowerCase())
      );
      if (legal.size === 0) {continue;}
      checked++;

      // Paths named in the description, in the `/Segment` or `/A/B` shape.
      const named = (m.tool.description ?? '').match(/(?<![\w.])\/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)*/g) ?? [];
      for (const path of new Set(named)) {
        // Only judge paths that LOOK like patch targets — a description may
        // legitimately mention a URL path, which is a different thing.
        if (/^\/v\d/i.test(path)) {continue;}
        if (!legal.has(path.toLowerCase())) {
          wrong.push(
            `${m.server}/${m.tool.name}: names "${path}"; the 26R1 example writes ` +
              `${[...legal].join(', ')}`
          );
        }
      }
    }

    expect(checked, 'no PATCH operation carried a body example; the spec loader may have broken')
      .toBeGreaterThan(0);
    expect(
      wrong,
      `${wrong.length} description(s) name a JSON Patch path the route's own example contradicts. ` +
        `A caller that obeys earns a 400:\n  ${wrong.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule F — a described input field must exist in the request body ────────

describe('a write tool does not promise an input its route cannot accept', () => {
  it('every field-shaped name in a write description exists in that route’s request body', () => {
    // WHY THIS IS NOT A SECOND COPY OF RULE B.
    //
    // Rule B reads the RESPONSE. It resolves the tool's own operation and
    // diffs the description's field-shaped tokens against that route's 200/201
    // schema — and it reports, by design, the tools it could not check: those
    // whose route declares no 200 body with properties. That set is almost
    // entirely writes. A create or an update answers 201 with a Location
    // header, or 200 with an empty body, and Rule B has nothing to compare
    // against, so it steps aside and says so.
    //
    // Those are exactly the tools where the description is doing the most
    // work. A read tool's description over-promising costs a model an absent
    // field; a write tool's description over-promising costs an estate change
    // the operator believes happened. The half nobody was checking is the
    // REQUEST: what a model is told it may send.
    //
    // The consequence is quieter than a 400. bConnect answers a body carrying
    // an unknown key with 200 and drops the key (finding D6) — so the model
    // sends `description`, gets a success, and reports a group configured in a
    // way it is not. Nothing in the transcript says otherwise.
    //
    // KNOWN BLIND SPOT, measured, and stated so nobody trusts this further
    // than it goes. The matcher is Rule B's, /\b[a-z]+[A-Z][A-Za-z0-9]*\b/,
    // which requires an internal capital — and the write half of this
    // catalogue does not write that way. Measured across all 28 write tools
    // this rule can reach: ZERO camelCase tokens, so today it compares an
    // empty set and cannot fail. Write descriptions name their fields in bare
    // lowercase prose ("accepts name, description, and member assignments"),
    // which emits no token at all.
    //
    // So this rule is a ratchet, not a finding-machine: it is what keeps a
    // write description honest the day someone writes one in the read tools'
    // house style, which is where every camelCase token in the catalogue lives
    // today. The lowercase case is a genuinely different problem and is Rule G
    // below — kept separate because it needs a different matcher and had to be
    // judged on its own false-positive rate before adoption. Loosening THIS
    // matcher to bare words instead is not the fix: 129 (schema, word)
    // near-miss pairs across the 204 schemas in the 26R1 specs were measured,
    // so it would fire on ordinary English and be silenced within a week.
    const broken: string[] = [];
    let checked = 0;
    // Reported, not swallowed — the same discipline as Rule B. A write whose
    // body this parser cannot resolve is a gap in the guard, not a clean tool.
    const unverifiable: string[] = [];
    let alsoSeenByRuleB = 0;

    for (const m of mapped) {
      const verb = m.verb.toLowerCase();
      if (verb !== 'post' && verb !== 'put') {continue;}
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, verb);
      const body = Object.values(op?.requestBody?.content ?? {})[0]?.schema;
      const bodyFields = propertyNames(body, doc);
      if (bodyFields.size === 0) {
        unverifiable.push(`${m.server}/${m.tool.name}`);
        continue;
      }

      const legal = new Set([...bodyFields].map((f) => f.toLowerCase()));
      // A JSON Patch body describes the patch envelope, not the entity. Rule E
      // owns those: it checks the /paths named in prose against the route's own
      // example, which is the only statement 26R1 makes about what may be
      // written there.
      if (legal.size === 3 && ['op', 'value', 'path'].every((k) => legal.has(k))) {continue;}
      checked++;

      // A create legitimately describes what it gives back as well as what it
      // takes, so the response schema is legal here too — this rule is about
      // fields that exist NOWHERE on the operation, not about which direction
      // a real field travels in. Where a 200 schema exists, that makes this
      // rule's verdict a subset of Rule B's; the tools it adds are the writes
      // Rule B lists as unverifiable.
      const ok = op?.responses?.['200'] ?? op?.responses?.['201'];
      const responseFields = propertyNames(
        ok ? Object.values(ok.content ?? {})[0]?.schema : undefined,
        doc
      );
      if (responseFields.size > 0) {alsoSeenByRuleB++;}
      for (const f of responseFields) {legal.add(f.toLowerCase());}
      for (const p of Object.keys(m.tool.inputSchema?.properties ?? {})) {legal.add(p.toLowerCase());}

      const promised = (m.tool.description ?? '').match(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g) ?? [];
      const missing = [...new Set(promised)]
        .filter((t) => !NOT_FIELD_NAMES.has(t))
        .filter((t) => !legal.has(t.toLowerCase()));
      if (missing.length) {
        broken.push(
          `${m.server}/${m.tool.name}: ${missing.join(', ')}  (${verb.toUpperCase()} ${m.specPath})`
        );
      }
    }

    // The canary Rules B, C and E all carry. A collapse here means the
    // dispatch/route mapping or the spec loader broke, not that 26R1 stopped
    // declaring request bodies.
    expect(checked, 'no POST/PUT operation contributed a request-body schema; the mapping is probably broken')
      .toBeGreaterThan(20);
    console.log(
      `[descriptions] request-body promises checked on ${checked} write tool(s), of which ` +
        `${checked - alsoSeenByRuleB} declare no 200/201 body and are therefore checked by ` +
        `nothing else; ${unverifiable.length} could not be checked (no resolvable request body)`
    );
    expect(
      broken,
      `${broken.length} write tool description(s) name a field the route's request body does ` +
        `not accept. bConnect answers 200 and silently drops the unknown key (D6), so the ` +
        `model reports a value that was never stored:\n  ${broken.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule G — a house-phrased input list must be a list of real fields ──────

/**
 * Generic collective nouns that name a CATEGORY of fields rather than a field.
 * "accepts creation data" and "accepts the settings" are true statements that
 * no schema contains as a property, and flagging them would be the failure
 * this file keeps warning about — a guard that fires on good documentation.
 */
const NOT_FIELD_ITEMS = new Set([
  'data', 'settings', 'options', 'properties', 'fields', 'values', 'metadata',
  'details', 'attributes', 'parameters', 'arguments', 'information', 'content',
  'guid', 'uuid', 'json', 'body', 'payload', 'object',
]);

describe('a write tool’s "accepts …" list names fields the body actually has', () => {
  it('every single-word item in an input clause exists on the operation', () => {
    // WHY A SECOND RULE AND NOT A LOOSER RULE F.
    //
    // Rule B and Rule F both key on camelCase, because in prose a camelCase
    // token is a field name and nothing else. The write half of the catalogue
    // does not use it: measured, all 28 write tools Rule F can reach contain
    // zero camelCase tokens. They enumerate their inputs in ordinary English —
    // "Accepts group creation data including name, description, and member
    // assignments" — where every word is a word.
    //
    // A bare-word matcher over a whole description is unusable: 129 (schema,
    // word) near-miss pairs were measured across the 204 schemas in the 26R1
    // specs. What makes this decidable is not the words, it is the SENTENCE
    // FRAME. This catalogue has one house phrasing for input lists — "Accepts
    // X including a, b, and c" — and inside that frame a bare single word is
    // a field name by construction, not by inference.
    //
    // So the scope is drawn tight on purpose, and every narrowing below was
    // needed to reach zero false positives on the current catalogue:
    //
    //   POST/PUT with a resolvable request body only. A PATCH body is the
    //   JSON-Patch envelope, so there is no entity schema to compare against
    //   and the same prose would be judged against the wrong thing.
    //
    //   The clause STOPS at "returns"/"reports"/"responds". Without that,
    //   create_os_folder's "...and returns the newly created OS folder with
    //   its assigned GUID and metadata" contributed "metadata" — a false
    //   positive produced entirely by reading past the direction change.
    //
    //   Single words only. "member assignments" and "permission settings" are
    //   phrases; whether the API has such a concept is a judgement, and a
    //   guard that makes judgements gets argued with instead of fixed.
    //
    // Measured on adoption (2026-08-04): 6 items judged across 28 write tools,
    // 2 flagged, both real — servermanagement/create_security_group and
    // create_security_profile each promise a `description` field that
    // SecurityGroupForCreation ({name, profiles}) and SecurityProfileForCreation
    // ({name, comment, displayAdministratorIdentities,
    // displayEndpointUserIdentities}) do not declare. Zero false positives.
    // The consequence is the quiet one: bConnect answers an unknown key with
    // 200 and drops it (D6), so a model that follows the description reports a
    // group described in a way it is not.
    const broken: string[] = [];
    let judged = 0;

    // The house frame, and the point at which the sentence stops talking about
    // input and starts talking about output.
    const CLAUSE =
      /\b(?:accepts|takes|requires|expects|including|such as)\b((?:(?!\breturns?\b|\breports?\b|\bresponds\b)[^.])*)/gi;

    for (const m of mapped) {
      const verb = m.verb.toLowerCase();
      if (verb !== 'post' && verb !== 'put') {continue;}
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, verb);
      const bodyFields = propertyNames(
        Object.values(op?.requestBody?.content ?? {})[0]?.schema,
        doc
      );
      if (bodyFields.size === 0) {continue;}

      const legal = new Set([...bodyFields].map((f) => f.toLowerCase()));
      if (legal.size === 3 && ['op', 'value', 'path'].every((k) => legal.has(k))) {continue;}
      const ok = op?.responses?.['200'] ?? op?.responses?.['201'];
      for (const f of propertyNames(ok ? Object.values(ok.content ?? {})[0]?.schema : undefined, doc)) {
        legal.add(f.toLowerCase());
      }
      for (const p of Object.keys(m.tool.inputSchema?.properties ?? {})) {legal.add(p.toLowerCase());}
      // `profiles` and `profile` are the same field being named two ways, and
      // a plural mismatch is a writing choice rather than a false promise.
      const declares = (word: string) =>
        legal.has(word) || legal.has(`${word}s`) || (word.endsWith('s') && legal.has(word.slice(0, -1)));

      const items = [...(m.tool.description ?? '').matchAll(CLAUSE)]
        .flatMap((match) => match[1].split(/,|\band\b|\bor\b/))
        .map((s) => s.trim().replace(/[^A-Za-z0-9 ]/g, ''))
        .filter((s) => /^[A-Za-z][A-Za-z0-9]*$/.test(s) && s.length > 2)
        .map((s) => s.toLowerCase())
        .filter((s) => !NOT_FIELD_ITEMS.has(s));

      const absent = [...new Set(items)].filter((s) => {judged++; return !declares(s);});
      if (absent.length) {
        broken.push(
          `${m.server}/${m.tool.name}: names ${absent.map((a) => `"${a}"`).join(', ')} as input; ` +
            `the 26R1 body declares ${[...bodyFields].join(', ')}  (${verb.toUpperCase()} ${m.specPath})`
        );
      }
    }

    // Deliberately low. Only five write tools use the house frame at all, and
    // this exists so a matcher regression shows as a collapse to zero rather
    // than as a silent pass.
    expect(judged, 'no input clause was judged; the clause matcher is probably broken')
      .toBeGreaterThan(3);
    expect(
      broken,
      `${broken.length} write tool description(s) enumerate an input field the route's request ` +
        `body does not declare. bConnect answers 200 and drops the unknown key (D6), so the ` +
        `model reports a value that was never stored:\n  ${broken.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule C — a `_by_<entity>` suffix must name the entity it takes ──────────

describe('a _by_<entity> tool takes that entity', () => {
  it('the suffix predicts the required id parameter', () => {
    // The convention held for 43 of 44 tools, which is exactly what made the
    // 44th dangerous: a model generalises from it.
    // `list_installed_software_by_dynamic_group` required a
    // `universalDynamicGroupId`, and Dynamic Groups and Universal Dynamic
    // Groups are distinct kinds with distinct id spaces. Feeding it a Dynamic
    // Group id returned a 404 whose `releaseHint()` tail suggested the route
    // might not exist on this release — sending the model to diagnose a
    // version problem when it had a group-kind problem. There was no way to
    // learn the right lesson from that response.
    const mismatched: string[] = [];
    let suffixed = 0;

    // Benign mismatches: the suffix abbreviates the parameter, or the
    // parameter is the more specific of the two. Each is listed with the pair
    // rather than the tool alone, so a tool that later changes its parameter
    // stops being exempt.
    //
    // These are NOT the same shape as the defect this rule exists for. There,
    // the suffix named `dynamic_group` while the parameter was
    // `universalDynamicGroupId` — and Dynamic Groups and Universal Dynamic
    // Groups are BOTH real, distinct group kinds in 26R1 with distinct id
    // spaces, so the suffix pointed at a different thing that genuinely
    // exists. Substring matching cannot separate the two cases, because
    // "dynamicgroup" is a substring of "universaldynamicgroup"; judgement can,
    // so it is written down instead of inferred.
    const BENIGN: Record<string, string> = {
      // suffix abbreviates: there is no bare "Group" id space in the AD server.
      'activedirectory/list_ad_objects_by_group': 'adGroupId',
      'activedirectory/list_ad_users_by_group': 'adGroupId',
      // suffix is the more specific: assets attach to Windows endpoints only.
      'assets/list_assets_by_windows_endpoint': 'endpointId',
      // suffix abbreviates: "definition" here can only be a job definition.
      'jobs/list_job_instances_by_definition': 'jobDefinitionId',
      // parameter is the more specific: 26R1 names the Windows-scoped id.
      'variables/list_variable_instances_by_job_definition': 'windowsJobDefinitionId',
      'variables/list_variable_instances_by_application': 'windowsApplicationId',
    };

    // `_by_` tools whose suffix names something other than an id parameter.
    const NOT_AN_ID_SUFFIX = new Set([
      'list_detected_rule_violations_by_endpoint',
      'list_detected_vulnerabilities_by_endpoint',
    ]);

    // Only mapped tools have a schema to check the suffix against.
    for (const m of mapped) {
      const match = m.tool.name.match(/_by_([a-z_]+)$/);
      if (!match || NOT_AN_ID_SUFFIX.has(m.tool.name)) {continue;}
      const entity = match[1].replace(/_/g, ''); // logical_group -> logicalgroup
      const idParams = Object.keys(m.tool.inputSchema?.properties ?? {}).filter((p) =>
        /id$/i.test(p)
      );
      if (idParams.length === 0) {continue;}
      // The suffix must match SOME declared id parameter's stem. Not all of
      // them: several tools take both a group id and an endpoint id.
      const key = `${m.server}/${m.tool.name}`;
      const ok =
        idParams.some((p) => p.toLowerCase().replace(/id$/, '') === entity) ||
        (BENIGN[key] !== undefined && idParams.includes(BENIGN[key]));
      suffixed++;
      if (!ok) {
        mismatched.push(
          `${m.server}/${m.tool.name}: suffix says '${match[1]}', parameters are ${idParams.join(', ')}`
        );
      }
    }

    expect(suffixed, 'no _by_ tools found; the mapping is probably broken').toBeGreaterThan(20);
    expect(
      mismatched,
      `${mismatched.length} tool(s) whose _by_<entity> suffix does not name the id they take. ` +
        `The convention is strong enough across the rest of the catalogue that a model will ` +
        `generalise from it:\n  ${mismatched.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule H — an advertised input parameter must exist on the operation ─────

describe('a write tool does not advertise a parameter its route cannot accept', () => {
  it('every input-schema property of a POST/PUT tool exists on the operation', () => {
    // WHY NONE OF A–G COULD CATCH THIS.
    //
    // Rules B, F and G judge PROSE against the route, and all three
    // deliberately treat the tool's own input-schema property names as
    // legitimizing vocabulary (`legal.add(param)`) — a description that
    // mentions its own parameter is documenting, not promising. So a schema
    // property the route cannot accept can never fail a rule in this file.
    // And bConnect answers 200 and drops unknown body keys (D6), so the
    // failure is silent at runtime too — the model sends
    // `scheduledStartTime`, reads success, and reports a deferred deployment
    // that is not deferred.
    //
    // STATED HONESTLY: this class was not invisible to the suite. All four
    // instances below sat in suite-schema-vs-types.test.ts'
    // OPEN_UNDECLARED_PARAMS — recorded as "defects awaiting an upstream fix,
    // the list is meant to reach zero" — for two rounds before the
    // 2026-08-11 per-tool review re-found them by hand and fixed them. What
    // this rule adds over that register: it REFUSES rather than records (a
    // new instance fails immediately, with no filing cabinet to grow old
    // in), it compares against the SHIPPED SPEC rather than the generated
    // types (the two drift independently), and it verifies wrapper
    // parameters through the dispatch arm that unwraps them, which the
    // register never modelled.
    //
    // The four, fixed the day this rule landed (TOOL-REVIEW-MATRIX.md):
    //   jobs/create_kiosk_release          targetId          (body requires assignmentTargetId)
    //   jobs/create_job_instance           scheduledStartTime (no such body field)
    //   software/create_software_bundle    folderId          (body says parentId)
    //   software/add_application_to_bundle order             (body accepts applicationId only)
    //
    // Scope: POST/PUT with a resolvable operation. PATCH is excluded on
    // purpose: its body is the JSON-Patch envelope, the entity fields live in
    // `/path` strings, and Rule E owns those where the spec carries an
    // example — judging a PATCH tool's field-shaped parameters against the
    // envelope schema would flag every honest one.
    //
    // KNOWN BLIND SPOT, disclosed rather than papered over: a parameter
    // ending in `Id` on a route whose template carries a path parameter is
    // accepted WITHOUT checking the name, because 26R1 templates name path
    // params `{id}` while tools name them `logicalGroupId`. A wrong id-param
    // name on such a route slips through; Rule C covers the `_by_<entity>`
    // slice of that gap and nothing covers the rest.
    const broken: string[] = [];
    let checked = 0;
    const pathIdUnverified: string[] = [];
    // Rule I's block source, reused: a WRAPPER parameter (`groupData`) is
    // legitimate only when the arm demonstrably unwraps it — then the wrapper
    // travels as the body itself and it is the wrapper's NESTED properties
    // that must be body fields. First run of this rule flagged three wrapper
    // tools as broken; all three unwrap correctly, which is why this branch
    // exists. An opaque wrapper (no nested properties declared) is accepted
    // with nothing to check — worse ergonomics, but not a false promise.
    const dispatchOf = new Map(advertised.map((a) => [`${a.server}/${a.tool.name}`, a.dispatch]));

    for (const m of mapped) {
      const verb = m.verb.toLowerCase();
      if (verb !== 'post' && verb !== 'put') {continue;}
      const doc = loadSpec(m.moduleSegment);
      if (!doc) {continue;}
      const op = operationAt(doc, m.specPath, verb);
      if (!op) {continue;}
      const bodyFields = propertyNames(Object.values(op.requestBody?.content ?? {})[0]?.schema, doc);

      const legal = new Set([...bodyFields].map((f) => f.toLowerCase()));
      // A JSON-Patch envelope reached via POST/PUT would be Rule E's problem,
      // same as in Rule F.
      if (legal.size === 3 && ['op', 'value', 'path'].every((k) => legal.has(k))) {continue;}
      for (const p of op.parameters ?? []) {if (p.name) {legal.add(p.name.toLowerCase());}}
      for (const t of m.specPath.matchAll(/\{([^}]+)\}/g)) {legal.add(t[1].toLowerCase());}

      const props = m.tool.inputSchema?.properties ?? {};
      if (Object.keys(props).length === 0) {continue;}
      checked++;

      for (const [p, propSchema] of Object.entries(props)) {
        if (legal.has(p.toLowerCase())) {continue;}
        if (/id$/i.test(p) && m.specPath.includes('{')) {
          pathIdUnverified.push(`${m.server}/${m.tool.name}.${p}`);
          continue;
        }
        const ps = (propSchema ?? {}) as { type?: string; properties?: Record<string, unknown> };
        const block = dispatchOf.get(`${m.server}/${m.tool.name}`)?.blockSource ?? '';
        if (ps.type === 'object' && new RegExp(`args[!?]?\\.${p}\\b`).test(block)) {
          const badNested = Object.keys(ps.properties ?? {}).filter((n) => !legal.has(n.toLowerCase()));
          if (badNested.length) {
            broken.push(
              `${m.server}/${m.tool.name}: wrapper "${p}" declares ${badNested.join(', ')}; ` +
                `the operation accepts ${[...bodyFields].join(', ')}  (${verb.toUpperCase()} ${m.specPath})`
            );
          }
          continue;
        }
        broken.push(
          `${m.server}/${m.tool.name}: advertises "${p}"; the operation accepts ` +
            `${[...bodyFields].join(', ') || '(no body fields)'}  (${verb.toUpperCase()} ${m.specPath})`
        );
      }
    }

    expect(checked, 'no POST/PUT tool contributed properties; the mapping is probably broken')
      .toBeGreaterThan(15);
    console.log(
      `[descriptions] input schemas checked on ${checked} write tool(s); ` +
        `${pathIdUnverified.length} path-id parameter name(s) accepted unverified ` +
        `(spec templates name them {id})`
    );
    expect(
      broken,
      `${broken.length} write tool(s) advertise a parameter their operation cannot accept. ` +
        `bConnect answers 200 and silently drops an unknown body key (D6), so the model ` +
        `reports a value that was never stored — or, when the right name was required, the ` +
        `call can never succeed at all:\n  ${broken.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Rule I — a dispatch arm may only read parameters the tool declares ─────

describe('a dispatch arm reads only declared parameters', () => {
  it('every args.<name> read in a case block is a declared schema property', () => {
    // The other half of Rule H, and the half no schema-vs-spec diff can see:
    // the schema can be exactly right and the arm can still read a parameter
    // that does not exist. `link_entra_id_data` advertised the three
    // spec-correct entraId* fields and its arm read `args!.deviceId` —
    // undefined on every call, and unreachable by a caller, because the
    // unknown-parameter validator refuses undeclared keys before dispatch.
    // Every layer was individually plausible; only the cross-check fails.
    //
    // Scope: direct `args.<name>` / `args!.<name>` / `args?.<name>` reads in
    // the tool's own case block. Reads through an alias (`const all = args`)
    // and destructuring are the paged-list idiom whose keys the
    // unknown-parameter validator already bounds — out of scope rather than
    // half-checked. v1.1-gated tools are not advertised in this posture, so
    // their arms are not judged; they gain coverage the day the gate opens
    // in a test posture, not before.
    const broken: string[] = [];
    const serversWithReads = new Set<string>();
    let armsWithReads = 0;

    for (const a of advertised) {
      const block = a.dispatch?.blockSource;
      if (!block) {continue;}
      const declared = new Set(Object.keys(a.tool.inputSchema?.properties ?? {}));
      const reads = new Set(
        [...block.matchAll(/\bargs[!?]?\.([A-Za-z_$][A-Za-z0-9_$]*)\b/g)].map((r) => r[1])
      );
      if (reads.size > 0) {armsWithReads++; serversWithReads.add(a.server);}
      for (const r of reads) {
        if (!declared.has(r)) {
          broken.push(
            `${a.server}/${a.tool.name}: reads args.${r}; declares ` +
              `${[...declared].join(', ') || '(nothing)'}`
          );
        }
      }
    }

    // Two canaries. The count catches the block reader collapsing; the
    // per-server spread catches one server switching to an idiom this rule
    // cannot see, which would otherwise be silent for that whole server.
    expect(armsWithReads, 'almost no case block reads args; the block reader is probably broken')
      .toBeGreaterThan(50);
    console.log(
      `[descriptions] dispatch reads checked on ${armsWithReads} arm(s) across ` +
        `${serversWithReads.size} server(s)`
    );
    expect(serversWithReads.size, 'a server dropped out of the read check entirely').toBeGreaterThanOrEqual(11);
    expect(
      broken,
      `${broken.length} dispatch arm(s) read a parameter the tool does not declare. The ` +
        `unknown-parameter validator refuses the key before dispatch, so the read is ` +
        `undefined on every call — the advertised parameters are read by nothing and the ` +
        `tool cannot do what it says:\n  ${broken.join('\n  ')}`
    ).toEqual([]);
  });
});

// ─── Coverage of the guard itself ────────────────────────────────────────────

describe('the guard sees enough of the surface to be worth having', () => {
  it('maps most advertised tools to a route, and reports what it cannot', () => {
    const total = mapped.length + unmapped.length;
    // Composites, the v1.1 slices and the JSON-Patch writes have no single
    // operation by design, so this is a floor rather than a target. It exists
    // so a regression in the dispatch/route readers shows up here as coverage
    // collapsing rather than as every rule silently passing on nothing.
    expect(total).toBeGreaterThan(100);
    expect(mapped.length / total).toBeGreaterThan(0.5);
    console.log(
      `[descriptions] ${mapped.length} of ${total} advertised tools mapped to a 26R1 operation; ` +
        `${unmapped.length} unmapped (composites, v1.1, patch writes)`
    );
  });
});
