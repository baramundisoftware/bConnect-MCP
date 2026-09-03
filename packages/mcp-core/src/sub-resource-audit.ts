/**
 * Which sub-resource reads have declared what their 404 means (ARCH-1).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `absent-data.ts` states the absent/empty/zero policy and deliberately makes
 * it opt-in per route — a client-wide rewrite of every 404 would turn "you
 * asked a Windows-only route about a Linux box" into "this machine has no
 * vulnerabilities", which is worse than the error it replaced. What the opt-in
 * design never had was a way to tell a route that has been CONSIDERED from one
 * nobody has looked at. Measured 2026-08-04: 34 sub-resource reads across the
 * thirteen servers, one of them declared.
 *
 * The cost of that silence was measured on the declared route's own sibling.
 * `/compliance/v2.0/Endpoints/{id}/DetectedRuleViolations` answers 404 for
 * valid endpoint ids on a live estate, and the undeclared path reports that as
 * "a wrong id, or a route this bMS does not serve" — the two things it is not.
 *
 * So this is the mechanism a suite guard uses to see the difference. It is
 * deliberately a source scan and not a runtime registry: the property being
 * checked is that somebody WROTE DOWN a decision, and a registry only records
 * the routes that were already remembered.
 *
 * ── What counts as a sub-resource read ──────────────────────────────────────
 * A GET whose path template interpolates an id and then continues with another
 * path segment — `/<Parent>/${id}/<Sub>`. The leading `${this.basePath}` is not
 * an id and is discounted, so `/Endpoints/${id}` (a get-by-id, whose 404 is
 * honest by construction) does not match while
 * `/Endpoints/${id}/VariableInstances` does.
 *
 * A WRITE's path is shaped identically, so the path alone cannot separate them
 * and for a while it did not: 18 POST/PATCH/DELETE routes accumulated on a list
 * whose stated closing procedure only makes sense for a read. The scan reports
 * both and labels each with `kind`; see `SubResourceCall.kind` for why that
 * label defaults to "read" whenever the verb is not certain.
 *
 * ── What counts as a declaration ────────────────────────────────────────────
 * The enclosing method routes the read through `readSubResource(...)`, with
 * either a `ParentNotFoundPolicy` or `notOverloaded404(...)`. Both are
 * declarations; only the first changes behaviour.
 *
 * The enclosing method is found by scanning back to the nearest class-method
 * header, which is what every module in this suite is written as. A read
 * outside a class method is reported as undeclared rather than skipped — a
 * false positive is a line of source to look at, a false negative is the defect
 * this was written to find.
 */

/** A call of the form `/<Parent>/{id}/<Sub>` found in module source. */
export interface SubResourceCall {
  /** 1-based line of the call. */
  line: number;
  /** The path template exactly as written, `${...}` and all. */
  template: string;
  /** True when the enclosing method routes it through `readSubResource`. */
  declared: boolean;
  /**
   * The verb at the call site.
   *
   * ── Why this exists, and why it defaults to "read" (ARCH-1, 2026-08-14) ────
   * The shape-blind finder below matches a PATH, and a write's path is shaped
   * exactly like a read's — so `UNDECLARED_SUB_RESOURCE_READS` accumulated 18
   * writes: `/JobInstances/{id}/Start`, four `AssignJobDefinition`, three
   * `Microservices/{id}/{Start,Stop,Restart}`, four `StartEnrollment`,
   * `TriggerInstallationViaIntune`, `TriggerUpdateOnClient`, EntraId
   * link/unlink, and a `BundleApplications/{id}` PATCH.
   *
   * That is not a tidiness problem. The list's closing procedure is "measure
   * which of the four causes in absent-data.ts applies", and a write has no
   * collection and no count, so `dataUnavailableForParent`'s `data: null,
   * totalItems: null` envelope cannot be what it means. Those 18 can never be
   * closed the way the list says they close, so a fifth of the backlog was
   * permanently unclosable and inflated every count taken from it.
   *
   * The classification defaults to "read" on ANY doubt — an unrecognised verb,
   * a shape the gap test does not accept, no verb within the lookback. A write
   * mislabelled "read" stays on the read backlog, which is one extra line for
   * somebody to look at. A read mislabelled "write" leaves the read backlog
   * silently, and absence from that list is precisely how a read declares
   * itself fine. The asymmetry is the same one the finder's own header argues
   * for, applied one level down.
   */
  kind: "read" | "write";
}

/**
 * EVERY template literal in the file. The call shape is deliberately not part
 * of the pattern.
 *
 * ── Two rounds of the same mistake, which is why this is now shape-blind ────
 * It began as `/\.get\(\s*`…`/`, requiring `(` immediately after `get`. Three
 * modules write `.get<T>(` — groups (30), jobs (12), endpoints (9) — so 51
 * reads were invisible. Widening it to allow the type argument fixed those and
 * missed a FOURTH server: every read in `bconnect-insights-mcp` goes through a
 * `readRows(http, `…`)` / `readOne(http, `…`)` helper, so `.get` is nowhere
 * near the template. Ten more reads, including
 * `/compliance/v2.0/WindowsEndpoints/{id}/DetectedVulnerabilities` — the exact
 * route the policy's own docstring cites as the measurement that motivated the
 * whole mechanism.
 *
 * Anchoring on the caller was the error both times. What identifies a
 * sub-resource read is the SHAPE OF THE PATH, which `isSubResourceTemplate`
 * already decides — so this now offers it every template and lets it choose.
 * Over-inclusion is the safe direction for a ratchet: a template that is not
 * really a read becomes one more line on a list of things nobody has checked,
 * whereas a missed one is a clean bill nobody issued.
 *
 * Why this matters more than an ordinary gap: absence from
 * `UNDECLARED_SUB_RESOURCE_READS` is precisely how a read declares itself fine.
 * A blind audit does not fail to answer — it answers "checked, nothing to
 * declare" about routes nobody has looked at. The guard produces the false
 * fact it exists to prevent.
 */
const READ = /`([^`]*)`/g;
/**
 * The wrappers that count as having declared something.
 *
 * Spelled out rather than matched as `readSubResource\w*`, so that adding a
 * wrapper is a deliberate edit here and not a side effect of naming. Each one
 * obliges the call site to say what was MEASURED:
 *   readSubResource(…, policy | notOverloaded404("…"))   the 404 is declared
 *   readSubResourceWhereEmptyIsAmbiguous(…)              the 200 is declared
 */
const DECLARATION = /\breadSubResource(?:WhereEmptyIsAmbiguous)?\s*\(/;

/**
 * A declaration passed as an ARGUMENT beside the path, e.g.
 * `readRows(http, \`…\`, pageSize, notOverloaded404("…"))`.
 *
 * ── Why this exists, and why it is scoped to the CALL ───────────────────────
 * Method-scoped attribution cannot reach `bconnect-insights-mcp`: its reads
 * live in top-level functions, and the scan credits only an enclosing class
 * method — deliberately, because the permissive fallback once let an unrelated
 * `readSubResource(` earlier in a file vouch for a read nobody had declared.
 *
 * The obvious repair — teach the scan about top-level functions — is WRONG, and
 * measurably so. `buildEndpointBriefing` holds four of these reads in one
 * function body; widening the attribution would let one declaration cover all
 * four. So the declaration is instead attached to the read itself, and this
 * looks only at the arguments of the call the template sits in, found by paren
 * depth. A sibling read in the same statement — the three inside
 * deployment-coverage's `Promise.all([...])` are exactly that — cannot borrow
 * it, because the scan stops at its own call's closing paren.
 */
const ARGUMENT_DECLARATION = /\bnotOverloaded404\s*\(|\bhowToDisambiguate\s*:/;
/** Bound on the argument scan, so a template outside any call cannot run away. */
const ARGUMENT_SCAN = 400;

/**
 * The rest of the argument list of the call containing `from`, or "" if the
 * template is not inside a call.
 */
function remainingArguments(source: string, from: number): string {
  let depth = 0;
  const limit = Math.min(source.length, from + ARGUMENT_SCAN);
  for (let i = from; i < limit; i++) {
    const char = source[i];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      if (depth === 0) {
        return source.slice(from, i);
      }
      depth--;
    }
  }
  return "";
}

/** A class method at the two-space indent every module in the suite uses. */
const METHOD_HEADER =
  /^ {2}(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:async\s+)?[A-Za-z_$][\w$]*\s*[(<]/;

/**
 * True when a path template addresses a sub-resource of an interpolated id.
 *
 * ── The whitespace test, and why narrowing here needed evidence ─────────────
 * Offering EVERY template literal to this predicate is what made the scan
 * shape-blind, and it also handed it prose. `endpoint-reach.ts` builds a note
 * reading `…or past maxGroupsChecked=${o.maxGroupsChecked}/budgetMs=${…}). The
 * endpoint may be in …`, in which `${o.maxGroupsChecked}/budgetMs` satisfies
 * "an interpolation followed by another segment" exactly. It sat on the
 * backlog as a route to go and measure against a live estate.
 *
 * Narrowing a finder is the direction that creates false clean bills, so this
 * rejects on the one property no URL path has and every sentence does:
 * whitespace. It was checked against the tree before landing — all 94 real
 * reads survive, the note is the only thing dropped — and the per-module
 * coverage guard in `suite-absent-empty-zero.test.ts` re-measures that on
 * every run rather than trusting this comment.
 */
export function isSubResourceTemplate(template: string): boolean {
  // A path has no spaces. A sentence that happens to contain `${x}/word` does.
  if (/\s/.test(template)) {
    return false;
  }
  // Drop a leading `${this.basePath}`-style prefix: it is a module base path,
  // not an id, and every template in the suite starts with one.
  return /\$\{[^}]+\}\/[A-Za-z]/.test(template.replace(/^\$\{[^}]+\}/, ""));
}

/**
 * The verb tokens a call site can carry, and the gap allowed before the path.
 *
 * `nearest wins` would be too loose on its own: an unrelated `.post(` earlier
 * in the same method would capture a read and drop it off the backlog. So a
 * verb only claims a template when nothing but whitespace and plain
 * `identifier,` arguments separate them — which covers `.get(\`…\`)`,
 * `.post(\n  \`…\`,` and `readRows(http, \`…\`)` while refusing anything
 * further away.
 */
const VERB = /\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(|\b(readRows|readOne|readCount)\s*\(/g;
const GAP = /^\s*(?:[A-Za-z_$][\w$.]*\s*,\s*)*$/;
const WRITE_VERBS = new Set(["post", "put", "patch", "delete"]);
/** How far back to look for the verb governing a template. */
const LOOKBACK = 240;

/** The verb governing the template at `index`, defaulting to "read". */
function verbFor(source: string, index: number): "read" | "write" {
  const prefix = source.slice(Math.max(0, index - LOOKBACK), index);
  VERB.lastIndex = 0;
  let nearest: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = VERB.exec(prefix)) !== null) {
    // Only a verb close enough to be THIS template's caller counts.
    if (GAP.test(prefix.slice(match.index + match[0].length))) {
      nearest = match[1] ?? match[2];
    }
  }
  return nearest !== null && WRITE_VERBS.has(nearest) ? "write" : "read";
}

/**
 * Find every sub-resource call in a TypeScript source file and report its verb
 * and whether a 404 declaration governs it.
 *
 * Writes are REPORTED, not filtered. Dropping them here would make 18 routes
 * vanish from every enumeration at once, and a thing that disappears from the
 * scan is indistinguishable from a thing that was checked — the exact failure
 * this module's header spends four paragraphs on. The caller sorts them onto
 * the right list; see `UNDECLARED_SUB_RESOURCE_WRITES`.
 */
export function findSubResourceCalls(source: string): SubResourceCall[] {
  const lines = source.split("\n");
  const methodStarts: number[] = [];
  lines.forEach((line, index) => {
    if (METHOD_HEADER.test(line)) {
      methodStarts.push(index);
    }
  });

  const found: SubResourceCall[] = [];
  READ.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = READ.exec(source)) !== null) {
    const template = match[1];
    if (!isSubResourceTemplate(template)) {
      continue;
    }
    const index = source.slice(0, match.index).split("\n").length - 1;
    // ── No enclosing method means NOT DECLARED ──────────────────────────
    // This fell back to `start = 0`, taking the whole file prefix as the
    // read's body — so any unrelated `readSubResource(` earlier in the file
    // produced a false `declared: true`, silently dropping the read off the
    // list and recreating the very defect this audit exists to catch. The
    // pessimistic direction is the correct one: an unattributed read is one
    // nobody has declared. It became reachable the moment the pattern above
    // stopped anchoring on `.get`, because insights' reads live in top-level
    // functions with no two-space class-method header.
    let start: number | null = null;
    for (const candidate of methodStarts) {
      if (candidate <= index) {
        start = candidate;
      }
    }
    const body = start === null ? "" : lines.slice(start, index + 1).join("\n");
    const args = remainingArguments(source, match.index + match[0].length);
    found.push({
      line: index + 1,
      template,
      declared:
        (start !== null && DECLARATION.test(body)) || ARGUMENT_DECLARATION.test(args),
      kind: verbFor(source, match.index),
    });
  }
  return found;
}
