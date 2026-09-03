/**
 * A module must not read `void` where the operation declares a response body.
 *
 * ── The class this exists to stop ───────────────────────────────────────────
 * Five instances found by hand between 2026-08-11 and 2026-08-14, across three
 * servers, every one the same shape — a handler returning a constant next to a
 * body nobody read:
 *
 *   msw_cleanup                 discarded `wasSuccessful` -> a failed cleanup
 *                               reported as done
 *   start/restart_microservice  asserted a completion the 200 declined to
 *                               assert ("starting", not "started")
 *   assign_job_to_* (x4)        printed a creation count on a 207 whose only
 *                               declared body is a ProblemDetails problem list
 *   trigger_intune_installation discarded a bare `boolean` -> a 200 carrying
 *                               false reported as triggered
 *   start_enrollment (Win/Mac)  fabricates `success: true` AND throws away
 *                               installCommand / validUntil / the whole Mac
 *                               enrollment profile
 *
 * Each was found only because somebody happened to open that file. Four of the
 * five were found by adversarial review of the fix to the previous one.
 *
 * ── Why THIS formulation, and not the one tried first ───────────────────────
 * The first attempt tried to detect the defect in the HANDLER — find a `case`
 * arm that awaits and then returns a string ignoring the result. Three
 * iterations of that were each wrong (indent-based extraction missed arms;
 * brace counting flagged `msw_cleanup`, which consumes its result six times),
 * and it was abandoned rather than shipped, because a guard that cannot be
 * validated against known answers is worse than none.
 *
 * The formulation below came from the review that found instance five, and it
 * is static rather than control-flow: the OpenAPI spec says whether a route
 * returns a body, and the module signature says whether anything reads it. No
 * dataflow analysis, no heuristics about wording.
 *
 * The suite already enforces the CONVERSE — `descriptions-match-routes`
 * checks that no description promises a body where the operation declares
 * none. That asymmetry is why instance five stayed live.
 *
 * ── Deliberately narrow ─────────────────────────────────────────────────────
 * `Promise<void>` is the unambiguous signal: the method cannot return the body
 * because its type forbids it. A method typed `Promise<unknown>` that ignores
 * the value is not caught here, and that is a knowing limit rather than an
 * oversight — catching it needs the dataflow analysis that was abandoned
 * above. This finds the class where it is decidable.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));

/** `${anything}` and `{param}` both collapse to `*`, so the two vocabularies meet. */
const canon = (p: string): string =>
  p.replace(/\$\{[^}]*\}/g, '*').replace(/\{[^}]*\}/g, '*').replace(/\/+$/, '');

interface SpecOp { responses?: Record<string, { content?: Record<string, unknown> }> }

function specFor(server: string): Record<string, Record<string, SpecOp>> | null {
  const domain = server.replace(/^bconnect-/, '').replace(/-mcp$/, '');
  const file = join(
    root, 'openapi-specs', '26R1',
    `bConnect_${domain[0].toUpperCase()}${domain.slice(1)}.json`
  );
  if (!existsSync(file)) {return null;}
  return (JSON.parse(readFileSync(file, 'utf8')) as { paths?: Record<string, Record<string, SpecOp>> })
    .paths ?? null;
}

/** `VERB /canonical/path` for every operation declaring a 2xx body. */
function routesWithBody(paths: Record<string, Record<string, SpecOp>>): Set<string> {
  const out = new Set<string>();
  for (const [path, ops] of Object.entries(paths)) {
    for (const [verb, op] of Object.entries(ops)) {
      const hasBody = Object.entries(op.responses ?? {}).some(
        ([code, r]) => /^2\d\d$/.test(code) && r.content && Object.keys(r.content).length > 0
      );
      if (hasBody) {out.add(`${verb.toUpperCase()} ${canon(path)}`);}
    }
  }
  return out;
}

interface VoidCall { method: string; verb: string; path: string; line: number }

/** Methods typed `Promise<void>` that make a client call with a template path. */
function voidMethods(source: string, basePath: string): VoidCall[] {
  const out: VoidCall[] = [];
  const re = /async\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*Promise<void>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '{') {depth++;}
      else if (c === '}') {depth--;}
      i++;
    }
    const body = source.slice(m.index + m[0].length, i - 1);
    const call = body.match(/\.(get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*`([^`]*)`/);
    if (!call) {continue;}
    out.push({
      method: m[1],
      verb: call[1].toUpperCase(),
      // The module's basePath carries a server segment the spec does not.
      path: canon(call[2].replace('${this.basePath}', basePath.replace(/^\/[a-z]+/, ''))),
      line: source.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

// ─── ARCH-2b: the typed half, which `Promise<void>` cannot decide ───────────

/**
 * The blind spot `Promise<void>` leaves, and why it needed the compiler.
 *
 * ARCH-2 closed at 10 → 0, and closing it emptied its own detector: **not one
 * of the 63 write methods that call a body-declaring route is `Promise<void>`
 * any more.** The guard above now decides nothing about any of them. A method
 * typed `Promise<Asset>` can await the POST, throw the response away and
 * fabricate a plausible object, and its type is still honest.
 *
 * That is not hypothetical. Measured 2026-08-16 on `createAsset`, mutated to
 * `await this.httpClient.post(...); return { ...data, created: true } as
 * unknown as Asset;` — a type-clean discard of the whole response body:
 *
 *   npm run typecheck                    0 errors
 *   the assets server suite              7 files, 54 tests, all pass
 *   suite-write-result-discarded (above) passes
 *   every-advertised-tool-dispatches     passes
 *
 * Nothing in the repository saw it.
 *
 * ── Why this is AST and not a fourth regex ──────────────────────────────────
 * Three regex attempts at the handler-arm version were abandoned (see the
 * header). A FOURTH was written and thrown away on 2026-08-16 before this:
 * a textual classifier that asked whether the method's return mentions
 * `data`/`res`/`response`. It reported a clean 63-of-63 and then FAILED its own
 * vacuity check — the mutation above returns `{ ...data, created: true }`, and
 * the word `data` in an unrelated position satisfied it. A pattern loose enough
 * to pass either way tests nothing; that rule is in this repo's working notes
 * and it caught its author here.
 *
 * The question is a dataflow one and is answered as one, but LOCALLY — inside a
 * single method body, which is what makes it decidable where the abandoned
 * cross-`case`-arm analysis was not. Taint starts at the awaited write call and
 * propagates through variable declarations to a fixpoint; the method passes if
 * any `return` reaches it.
 */
const WRITE_VERBS = new Set(['post', 'patch', 'put', 'delete']);

interface TypedWrite {
  method: string;
  verb: string;
  path: string;
  returnType: string;
  usesResult: boolean;
}

const contains = (root: ts.Node, target: ts.Node): boolean => {
  let hit = false;
  const walk = (n: ts.Node): void => {
    if (n === target) { hit = true; return; }
    if (!hit) { ts.forEachChild(n, walk); }
  };
  walk(root);
  return hit;
};

const referencesAny = (root: ts.Node, names: Set<string>): boolean => {
  let hit = false;
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && names.has(n.text)) { hit = true; return; }
    if (!hit) { ts.forEachChild(n, walk); }
  };
  walk(root);
  return hit;
};

/** Every name a declaration binds — plain, destructured or renamed. */
function boundNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) { into.add(name.text); return; }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) { boundNames(el.name, into); }
  }
}

/**
 * Write methods, and whether the response they get is ever returned.
 *
 * Deliberately NOT type-aware beyond the syntax: no `ts.TypeChecker`, no
 * program construction. One `createSourceFile` per module, and the same spec
 * data the `Promise<void>` half already uses decides whether a body exists.
 */
function typedWrites(source: string, fileName: string, basePath: string): TypedWrite[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: TypedWrite[] = [];

  const analyse = (node: ts.MethodDeclaration): void => {
    const body = node.body;
    if (!body) { return; }

    // The write call this method makes, if any.
    let call: ts.CallExpression | null = null;
    const findCall = (n: ts.Node): void => {
      if (
        !call &&
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        WRITE_VERBS.has(n.expression.name.text) &&
        /client/i.test(n.expression.expression.getText(sf)) &&
        n.arguments.length > 0 &&
        ts.isTemplateExpression(n.arguments[0])
      ) {
        call = n;
        return;
      }
      ts.forEachChild(n, findCall);
    };
    findCall(body);
    if (!call) { return; }
    const found: ts.CallExpression = call;
    const access = found.expression as ts.PropertyAccessExpression;

    // Taint: names bound from the call's result, to a fixpoint. A response
    // shaped through a helper before being returned still counts as read.
    const tainted = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      const scan = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && n.initializer) {
          const derives =
            contains(n.initializer, found) || referencesAny(n.initializer, tainted);
          if (derives) {
            const before = tainted.size;
            boundNames(n.name, tainted);
            if (tainted.size > before) { grew = true; }
          }
        }
        ts.forEachChild(n, scan);
      };
      scan(body);
    }

    let usesResult = false;
    const checkReturns = (n: ts.Node): void => {
      if (ts.isReturnStatement(n) && n.expression) {
        if (contains(n.expression, found) || referencesAny(n.expression, tainted)) {
          usesResult = true;
        }
      }
      ts.forEachChild(n, checkReturns);
    };
    checkReturns(body);

    out.push({
      method: node.name.getText(sf),
      verb: access.name.text.toUpperCase(),
      path: canon(
        found.arguments[0].getText(sf).replace(/^`|`$/g, '')
          .replace('${this.basePath}', basePath.replace(/^\/[a-z]+/, ''))
      ),
      returnType: node.type?.getText(sf) ?? '(inferred)',
      usesResult,
    });
  };

  const visit = (n: ts.Node): void => {
    if (ts.isMethodDeclaration(n)) { analyse(n); }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Known discards. Every entry is a method that throws away a body the API
 * declares — NOT a method that has been checked and found fine.
 *
 * Deleting a line requires making the method return its body and the handler
 * read it. Adding one requires a reason nobody has yet had.
 */
const DISCARDS_A_DECLARED_BODY: string[] = [
  // EMPTY as of 2026-08-14. All ten entries were fixed in two commits: the
  // enrollment pair first, then the two maintenance-window updates, the
  // Android/iOS PATCHes, the three servermanagement updates and the management
  // server restart. Each now returns its declared body and each handler reads
  // it instead of answering a constant.
  //
  // An empty list is the DANGEROUS state for a ratchet, not the finished one:
  // it passes identically whether the defect is gone or the detector is broken.
  // That is why the vacuity check below no longer pins a real method — there is
  // none left to pin — and drives the detector with a synthetic fixture instead.
  //
  // Adding a line here requires a reason nobody has yet had. The correct fix is
  // almost always to return the body.
];

describe('ARCH-2 — a write must not discard a body the API declares', () => {
  const servers = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('bconnect-') && d.name.endsWith('-mcp'))
    .map((d) => d.name);

  const scanned: string[] = [];
  const covered: string[] = [];
  const noSpec: string[] = [];
  const noBasePath: string[] = [];

  for (const server of servers) {
    const paths = specFor(server);
    if (!paths) {
      noSpec.push(server);
      continue;
    }
    const withBody = routesWithBody(paths);
    const modules = join(root, server, 'src', 'modules');
    if (!existsSync(modules)) {continue;}
    covered.push(server);
    for (const file of readdirSync(modules).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(modules, file), 'utf8');
      // BOTH quote styles. Matching only `"` skipped bconnect-servermanagement
      // entirely, which uses `'` — a scanner blind to a whole server because of
      // a quoting variation is exactly the failure this suite keeps finding.
      const basePath = source.match(/basePath\s*=\s*["']([^"']+)["']/)?.[1];
      if (basePath === undefined) {
        // A skip only matters where it could HIDE something: a module holding a
        // `Promise<void>` route method whose path this cannot resolve. The
        // composite and helper modules own no routes and are not skips.
        if (/async\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*:\s*Promise<void>/.test(source)) {
          noBasePath.push(`${server}/src/modules/${file}`);
        }
        continue;
      }
      for (const call of voidMethods(source, basePath)) {
        if (withBody.has(`${call.verb} ${call.path}`)) {
          scanned.push(`${server}/src/modules/${file} :: ${call.method}`);
        }
      }
    }
  }

  it('scans a real share of the suite — the guard must not be quietly blind', () => {
    // The lesson from the ARCH-1 audit, which matched `.get(` and could not see
    // `.get<T>(`: a guard that skips a server reports "nothing to declare"
    // about code nobody looked at. Name what was skipped rather than pooling a
    // total that a missing contributor cannot dent.
    expect(covered.length, `only ${covered.length} server(s) scanned`).toBeGreaterThanOrEqual(10);
    // groups and insights have no spec of their own — their reads belong to
    // other domains' specs. Recorded so the number is explained, not assumed.
    expect(noSpec.sort()).toEqual(['bconnect-groups-mcp', 'bconnect-insights-mcp']);
    expect(noBasePath, 'a module whose basePath could not be read was skipped silently').toEqual([]);
  });

  /**
   * The detector still detects — driven by a FIXTURE, because nothing real is
   * broken any more.
   *
   * This assertion has been rewritten twice, and the sequence is the lesson.
   * It first pinned the enrollment pair (what the guard was built from), then
   * moved to a maintenance-window update when that pair was fixed, and now
   * pins nothing real at all: the list is empty, so every "no unlisted discard"
   * result below passes whether the defect is gone OR the detector is broken.
   *
   * A ratchet at zero is the state where a silent detector failure is
   * indistinguishable from success, so the check cannot come from the tree. It
   * comes from a synthetic module instead: a known discard fed to the same
   * function the real scan uses.
   */
  describe('the detector still detects', () => {
    const FIXTURE = `export class M {
  private basePath = '/endpoints/v2.0';

  async updateThing(id: string, data: unknown): Promise<void> {
    await this.client.patch(\`\${this.basePath}/Things/\${id}\`, data);
  }

  async readsItsBody(id: string, data: unknown): Promise<Thing> {
    const response = await this.client.patch<Thing>(\`\${this.basePath}/Things/\${id}\`, data);
    return response.data;
  }
}
`;

    it('flags a Promise<void> method that makes a client call', () => {
      const found = voidMethods(FIXTURE, '/endpoints/v2.0');
      expect(found.map((c) => c.method)).toContain('updateThing');
      expect(found.find((c) => c.method === 'updateThing')).toMatchObject({
        verb: 'PATCH',
        path: '/v2.0/Things/*',
      });
    });

    it('does NOT flag a method that returns its body', () => {
      // The other direction, or the check above passes for a detector that
      // flags everything — which would make the empty list meaningless too.
      expect(voidMethods(FIXTURE, '/endpoints/v2.0').map((c) => c.method)).not.toContain(
        'readsItsBody'
      );
    });

    it('canonicalises the module path into the spec vocabulary', () => {
      // `${this.basePath}` carries a server segment the spec does not, and the
      // id interpolation has to collapse to `*` or nothing ever matches a
      // declared route. Both are silent failure modes: they produce an empty
      // result, which reads as "no discards".
      // EVERY `${...}` collapses, the base path included — which is why
      // voidMethods substitutes the real basePath BEFORE calling canon. Written
      // out because I asserted the other behaviour first and was wrong.
      expect(canon('${this.basePath}/Things/${id}')).toBe('*/Things/*');
      expect(canon('/v2.0/Things/{id}')).toBe('/v2.0/Things/*');
    });
  });

  it('has no discard that is not on the list', () => {
    const known = new Set(DISCARDS_A_DECLARED_BODY);
    const unlisted = scanned.filter((s) => !known.has(s));
    expect(
      unlisted,
      'a write that discards a declared response body must read it, or be listed here with why — ' +
        'see the header of this file for the five instances that motivated it'
    ).toEqual([]);
  });

  it('has no list entry that has since been fixed', () => {
    // The ratchet half: making a method return its body must delete its line,
    // so the list shrinks and cannot quietly become a permanent excuse.
    const found = new Set(scanned);
    const stale = DISCARDS_A_DECLARED_BODY.filter((entry) => !found.has(entry));
    expect(stale, 'these no longer discard a body — delete them from the list').toEqual([]);
  });
});

/**
 * Known typed discards. Same contract as the list above, different decider:
 * a method that awaits a body-declaring write and never returns what came back.
 */
const DISCARDS_A_DECLARED_BODY_TYPED: string[] = [
  // EMPTY as of 2026-08-16, on the first run of the detector over the tree —
  // all 63 sites already return their body, because ARCH-2's manual pass fixed
  // them. So this ratchet is PREVENTIVE from birth, and therefore starts in the
  // dangerous state: an empty list passes identically whether nothing is broken
  // or nothing is being checked. The vacuity block below is the whole defence,
  // and it drives the real detector with a synthetic module.
];

describe('ARCH-2b — a typed write must not fabricate what the API returned', () => {
  const servers = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('bconnect-') && d.name.endsWith('-mcp'))
    .map((d) => d.name);

  const discards: string[] = [];
  const population: string[] = [];
  const voidHalf: string[] = [];

  for (const server of servers) {
    const paths = specFor(server);
    if (!paths) {continue;}
    const withBody = routesWithBody(paths);
    const modules = join(root, server, 'src', 'modules');
    if (!existsSync(modules)) {continue;}
    for (const file of readdirSync(modules).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(modules, file), 'utf8');
      const basePath = source.match(/basePath\s*=\s*["']([^"']+)["']/)?.[1];
      if (basePath === undefined) {continue;}
      for (const w of typedWrites(source, file, basePath)) {
        if (!withBody.has(`${w.verb} ${w.path}`)) {continue;}
        const id = `${server}/src/modules/${file} :: ${w.method}`;
        population.push(id);
        // `Promise<void>` is the OTHER half's territory, and it cannot return a
        // body by construction. Partitioning rather than double-reporting keeps
        // each failure attributable to the check that can actually decide it.
        if (/^Promise<void>$/.test(w.returnType)) { voidHalf.push(id); continue; }
        if (!w.usesResult) { discards.push(id); }
      }
    }
  }

  it('scans the population the Promise<void> half no longer covers', () => {
    // ARCH-2 closing emptied its own detector: zero of these are Promise<void>
    // now, so the guard above decides nothing about any of them. If this ever
    // reads near zero the AST walk has stopped finding write calls, and an
    // empty discard list below would mean nothing at all.
    expect(
      population.length,
      'no write method resolves to a body-declaring route; the AST walk or the ' +
        'basePath substitution has rotted, and the empty ratchet below is vacuous'
    ).toBeGreaterThan(40);
    // Recorded, not asserted at a number: this is what ARCH-2's success looks
    // like from here, and it is the reason ARCH-2b exists.
    console.log(
      `[arch-2b] ${population.length} write method(s) hit a body-declaring route; ` +
        `${voidHalf.length} are Promise<void> (the other half's), ${discards.length} discard`
    );
  });

  describe('the detector still detects', () => {
    // A synthetic module carrying one of each shape. The negatives matter as
    // much as the positive: a detector that flags everything makes an empty
    // ratchet just as meaningless as one that flags nothing.
    const FIXTURE = `export class M {
  private basePath = '/endpoints/v2.0';

  async fabricates(id: string, data: unknown): Promise<Thing> {
    await this.client.patch(\`\${this.basePath}/Things/\${id}\`, data);
    return { ...data, updated: true } as unknown as Thing;
  }

  async returnsBody(id: string, data: unknown): Promise<Thing> {
    const response = await this.client.patch<Thing>(\`\${this.basePath}/Things/\${id}\`, data);
    return response.data;
  }

  async destructures(id: string, data: unknown): Promise<Thing> {
    const { data: body } = await this.client.patch<Thing>(\`\${this.basePath}/Things/\${id}\`, data);
    return body;
  }

  async shapesThenReturns(id: string, data: unknown): Promise<Thing> {
    const response = await this.client.patch<Thing>(\`\${this.basePath}/Things/\${id}\`, data);
    const shaped = normalise(response.data);
    return shaped;
  }

  async returnsInline(id: string, data: unknown): Promise<Thing> {
    return (await this.client.patch<Thing>(\`\${this.basePath}/Things/\${id}\`, data)).data;
  }
}
`;
    const found = typedWrites(FIXTURE, 'fixture.ts', '/endpoints/v2.0');
    const byName = (n: string): TypedWrite =>
      found.find((w) => w.method === n) as TypedWrite;

    it('flags a method that awaits the write and returns a fabricated object', () => {
      // The exact shape measured live on createAsset, which passed typecheck,
      // the whole assets suite, ARCH-2 and the dispatch guard.
      expect(byName('fabricates').usesResult).toBe(false);
    });

    it('does NOT flag the four shapes that do read the body', () => {
      // Written as one assertion over all four so a detector that only handles
      // `response.data` cannot pass by luck. `destructures` and
      // `shapesThenReturns` are the ones a naive check gets wrong.
      expect({
        returnsBody: byName('returnsBody').usesResult,
        destructures: byName('destructures').usesResult,
        shapesThenReturns: byName('shapesThenReturns').usesResult,
        returnsInline: byName('returnsInline').usesResult,
      }).toEqual({
        returnsBody: true,
        destructures: true,
        shapesThenReturns: true,
        returnsInline: true,
      });
    });

    it('reads the route out of the call, not out of the method name', () => {
      expect(byName('fabricates')).toMatchObject({ verb: 'PATCH', path: '/v2.0/Things/*' });
    });
  });

  it('has no typed discard that is not on the list', () => {
    const known = new Set(DISCARDS_A_DECLARED_BODY_TYPED);
    const unlisted = discards.filter((d) => !known.has(d));
    expect(
      unlisted,
      'a write that awaits a declared body and returns something it did not come from is ' +
        'asserting an outcome it never read — the HALLUCINATED-fact family. Return the body, ' +
        'or list it here with the reason:\n  ' + unlisted.join('\n  ')
    ).toEqual([]);
  });

  it('has no typed list entry that has since been fixed', () => {
    const found = new Set(discards);
    const stale = DISCARDS_A_DECLARED_BODY_TYPED.filter((e) => !found.has(e));
    expect(stale, 'these no longer discard a body — delete them from the list').toEqual([]);
  });
});
