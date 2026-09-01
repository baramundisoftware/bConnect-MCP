/**
 * The absent / empty / zero policy (M5).
 *
 * The defect this guards is not "a 404 was returned" — it is that three
 * different facts reach a caller as the same JSON:
 *
 *   the parent has no data yet   -> HTTP 404
 *   the route does not exist     -> HTTP 404, identical body but for traceId
 *   the collection is genuinely empty -> 200 with data: [], totalItems: 0
 *
 * so an answer meaning "we do not know" is indistinguishable from one meaning
 * "we looked, there are none". Measured live 2026-08-03: WIN10CLIENT3 (present,
 * managed, a real WindowsEndpoint) answers 404 on
 * /compliance/v2.0/WindowsEndpoints/{id}/DetectedVulnerabilities, while
 * WIN10CLIENT4 answers 200 with totalItems 1.
 *
 * The tests below pin the two properties that make the fix worth having:
 * the unavailable answer must never be READABLE as zero, and it must never
 * claim a cause it cannot establish.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findSubResourceCalls,
  isSubResourceTemplate,
  dataUnavailableForParent,
  isDataUnavailable,
  readSubResource,
  collectionOrUnavailable,
  countResultFromEnvelope,
  BConnectApiError,
} from '@bconnect/mcp-core';

const POLICY = {
  subject: 'detected vulnerabilities',
  servesPlatform: 'Windows',
  howToDisambiguate: 'Call get_endpoint with this id.',
};

describe('M5 — an unavailable result cannot be read as zero', () => {
  it('reports null rather than an empty array and a zero count', () => {
    const out = dataUnavailableForParent('WIN10CLIENT3', POLICY);

    // This is the whole point. §M5 originally proposed { data: [],
    // totalItems: 0, dataAvailable: false }, which any caller that skips the
    // flag reads as a clean machine. Nulls are unusable by accident.
    expect(out.data).toBeNull();
    expect(out.totalItems).toBeNull();
    expect(out.totalItems).not.toBe(0);
    expect(out.data).not.toEqual([]);
  });

  it('is detectable without knowing the shape', () => {
    expect(isDataUnavailable(dataUnavailableForParent('x', POLICY))).toBe(true);
    expect(isDataUnavailable({ data: [], totalItems: 0 })).toBe(false);
    expect(isDataUnavailable(null)).toBe(false);
    expect(isDataUnavailable(undefined)).toBe(false);
  });

  it('tells the caller not to report it as a clean result', () => {
    const { note } = dataUnavailableForParent('WIN10CLIENT3', POLICY);
    expect(note).toMatch(/does NOT mean zero/i);
    expect(note).toMatch(/not report this as a clean result/i);
  });
});

describe('M5 — the cause is enumerated, never chosen (A11)', () => {
  const out = dataUnavailableForParent('WIN10CLIENT3', POLICY);

  it('lists every cause consistent with a 404, including the platform one', () => {
    // A11 killed the `type`-discriminates proposal: WIN10CLIENT3 and
    // WIN10CLIENT10 are both WindowsEndpoint, so for the two cases that
    // actually matter the field is constant. Nothing may claim to know which.
    expect(out.possibleCauses.length).toBeGreaterThanOrEqual(4);
    expect(out.possibleCauses.join(' ')).toMatch(/never produced/i);
    expect(out.possibleCauses.join(' ')).toMatch(/not a Windows endpoint/i);
    expect(out.possibleCauses.join(' ')).toMatch(/not a valid endpoint id/i);
  });

  it('names a MULTI-platform restriction verbatim, so the live A9 case is visible', () => {
    // /compliance/v2.0/Endpoints/{id}/DetectedRuleViolations serves "Android,
    // iOS or macOS" per 26R1's own summary — its path segment is /Endpoints/,
    // which is why an earlier version of this suite read it as serving every
    // type and dropped the platform cause entirely. On an estate with ZERO
    // mobile endpoints (this one), that cause is not a footnote: it is the
    // explanation for every 404 the route produces, and hiding it left the
    // envelope claiming the machine "has never produced" violations.
    const multi = dataUnavailableForParent('e-1', {
      subject: 'detected rule violations',
      servesPlatform: 'Android, iOS or macOS',
      howToDisambiguate: 'Check the platform first.',
    });
    // Exact, including the article. `an?` is what let "is not a Android"
    // through the first time — a pattern loose enough to accept the bug it was
    // meant to describe.
    expect(multi.possibleCauses.join(' ')).toContain(
      'is not an Android, iOS or macOS endpoint; this route serves Android, iOS or macOS endpoints only'
    );
    // Five since 2026-08-14: missing rights joined the enumeration. This
    // fixture does not pass `rightsRuledOut`, so it keeps the rights cause.
    expect(multi.possibleCauses).toHaveLength(5);
    // The consonant case must keep its own article.
    expect(
      dataUnavailableForParent('e-1', POLICY).possibleCauses.join(' ')
    ).toContain('is not a Windows endpoint');
    expect(multi.totalItems).toBeNull();
    expect(multi.data).toBeNull();
  });

  it('names MISSING RIGHTS, because a scoped-away credential 404s like absent data', () => {
    // Added 2026-08-14. The list named four causes and not this one, while
    // bConnect refuses some routes with the literal words "not found or not
    // visible due to missing rights" — so a 404 caused by a scoped-away API key
    // was presented as four causes none of which was the real one. `readRows`
    // in the insights composites had listed rights all along, so the two
    // vocabularies disagreed and the envelope was the weaker of them.
    expect(out.possibleCauses.join(' ')).toMatch(/may not be permitted to read/i);
    expect(out.possibleCauses.join(' ')).toMatch(/missing rights/i);
    expect(out.causesRuledOut).toBeUndefined();
  });

  it('drops the rights cause ONLY where a route measured it away, and says it did', () => {
    // A refuted cause must not sit in a list of possible ones — that is the
    // same error as claiming a platform restriction that does not exist. But
    // deleting it silently would lose the fact that somebody checked, and the
    // next reader would check again. So it moves to causesRuledOut.
    const measured = dataUnavailableForParent('e-1', {
      subject: 'detected rule violations',
      servesPlatform: 'Android, iOS or macOS',
      howToDisambiguate: 'Check the platform first.',
      rightsRuledOut: 'Full rights confirmed on the object.',
    });
    expect(measured.possibleCauses.join(' ')).not.toMatch(/may not be permitted to read/i);
    expect(measured.causesRuledOut).toEqual([
      'Missing rights — Full rights confirmed on the object.',
    ]);
    // The other causes survive: this is one removal, not a collapse.
    expect(measured.possibleCauses).toHaveLength(4);
    expect(measured.totalItems).toBeNull();
  });

  it('names the platform, so the A9 case is visible rather than hidden', () => {
    // Sweeping all 26 endpoints gives 5 x 404, but 3 are non-Windows and their
    // 404 is CORRECT. A reader must be able to see that possibility here.
    expect(out.possibleCauses.some((c) => /Windows endpoints only/i.test(c))).toBe(true);
  });
});

describe('M5 — only 404 is translated', () => {
  it('translates a 404 into the envelope', async () => {
    const out = await readSubResource(
      () => Promise.reject(new BConnectApiError(404, 'Resource not found.', { method: 'GET', path: '/x' })),
      'WIN10CLIENT3',
      POLICY
    );
    expect(isDataUnavailable(out)).toBe(true);
  });

  it('lets a 500 through as a fault', async () => {
    // 401/5xx must stay faults — no argument the model can choose fixes them,
    // so presenting them as a recoverable result invites a retry loop.
    await expect(
      readSubResource(
        () => Promise.reject(new BConnectApiError(500, 'Server error', { method: 'GET', path: '/x' })),
        'WIN10CLIENT3',
        POLICY
      )
    ).rejects.toThrow(/Server error/);
  });

  it('lets a 403 through rather than reporting no data', async () => {
    // A credential scoped away from this route is not "no vulnerabilities".
    await expect(
      readSubResource(
        () => Promise.reject(new BConnectApiError(403, 'Forbidden', { method: 'GET', path: '/x' })),
        'WIN10CLIENT3',
        POLICY
      )
    ).rejects.toThrow(/Forbidden/);
  });

  it('passes a successful read through untouched', async () => {
    const payload = { data: [{ cveId: 'CVE-1' }], totalItems: 1 };
    const out = await readSubResource(() => Promise.resolve(payload), 'WIN10CLIENT4', POLICY);
    expect(out).toBe(payload);
    expect(isDataUnavailable(out)).toBe(false);
  });

  it('passes a genuinely empty 200 through as empty, not as unavailable', async () => {
    // The distinction the whole policy exists to preserve: an empty array is a
    // fact. It must NOT be converted into "we do not know".
    const empty = { data: [], totalItems: 0 };
    const out = await readSubResource(() => Promise.resolve(empty), 'WIN10CLIENT4', POLICY);
    expect(isDataUnavailable(out)).toBe(false);
    expect(out).toBe(empty);
  });
});

describe('M5 — countOnly cannot answer zero either', () => {
  it('carries the real reason instead of the generic no-count note', () => {
    const count = countResultFromEnvelope(dataUnavailableForParent('WIN10CLIENT3', POLICY));

    // countOnly is how a caller asks "how many vulnerabilities does this
    // machine have". A zero here is the most dangerous output in the suite.
    expect(count.totalItems).toBeNull();
    expect(count.totalItems).not.toBe(0);
    expect(count.note).toMatch(/does NOT mean zero/i);
    // The generic branch tells the caller to page the result, which cannot
    // help when the cause is an overloaded 404.
    expect(count.note).not.toMatch(/page the result/i);
    expect(count.possibleCauses?.length).toBeGreaterThan(0);
  });

  it('still returns a real count for a route that answered normally', () => {
    expect(countResultFromEnvelope({ totalItems: 17 }).totalItems).toBe(17);
    expect(countResultFromEnvelope({ totalItems: 0 }).totalItems).toBe(0);
  });
});

describe('M5 — an absent collection key is not an empty one', () => {
  it('treats an absent key as unavailable', () => {
    // The v1.1 inventory routes return {"EndpointId":"…"} with the collection
    // key missing rather than an empty array when there is no scan data.
    const out = collectionOrUnavailable({ EndpointId: 'e-1' }, 'Scans', 'e-1', POLICY);
    expect(isDataUnavailable(out)).toBe(true);
  });

  it('treats a present-but-empty key as a fact', () => {
    const out = collectionOrUnavailable({ EndpointId: 'e-1', Scans: [] }, 'Scans', 'e-1', POLICY);
    expect(isDataUnavailable(out)).toBe(false);
    expect(out).toEqual({ data: [], totalItems: 0, dataAvailable: true });
  });

  it('returns the rows when there are rows', () => {
    const out = collectionOrUnavailable(
      { EndpointId: 'e-1', Scans: [{ id: 1 }, { id: 2 }] }, 'Scans', 'e-1', POLICY
    );
    expect(out).toEqual({ data: [{ id: 1 }, { id: 2 }], totalItems: 2, dataAvailable: true });
  });
});

// ─── ARCH-1: every sub-resource read declares what its 404 means ─────────────

/**
 * Every sub-resource READ that has not yet said what its 404 means.
 *
 * The policy in absent-data.ts is opt-in per route, and correctly so — a
 * client-wide rewrite of every 404 would turn "you asked a Windows-only route
 * about a Linux box" into "this machine has no vulnerabilities". What it lacked
 * was any way to tell a route that has been CONSIDERED from one nobody has
 * looked at. Measured 2026-08-04: 34 sub-resource reads across the thirteen
 * servers, ONE of them declared — and the undeclared list included the declared
 * one's own sibling, /compliance/v2.0/Endpoints/{id}/DetectedRuleViolations,
 * which answered 404 for six of six valid endpoint ids on the live estate while
 * telling the caller the id was wrong or the route absent. Both false.
 *
 * So this is a ratchet, not a conversion. Adding a sub-resource read without a
 * declaration fails; declaring one of these fails too, and the fix is to delete
 * its line. Three ways to declare, all in absent-data.ts:
 *
 *   readSubResource(read, id, { subject, servesPlatform?, howToDisambiguate })
 *       the 404 is overloaded — translate it into the unavailable envelope
 *   readSubResource(read, id, notOverloaded404("what was measured, and when"))
 *       the 404 is honest — changes no behaviour, records that it was checked
 *   readSubResourceWhereEmptyIsAmbiguous(read, id, confirmParent, policy)
 *       the 200 is overloaded — an empty page might be a parent that is absent
 *
 * ── 2026-08-14: the list was MEASURED, 94 -> 17 ─────────────────────────────
 * 2,870 live reads over whole parent populations. What survives is NOT a pile
 * of routes nobody has looked at — every one below is grouped under the reason
 * it could not be closed, and those reasons are the point:
 *
 *   12  no childless parent exists on this estate, so there is no evidence
 *    2  insights reads with nothing measured to declare
 *    1  all-404, cause NOT established (n=1, and the parent id kind is a guess)
 *    1  refused by our own credential containment
 *    1  deliberately not probed, measured and handled elsewhere
 *
 * A route leaves this list only by being declared, and "declared" now means a
 * measurement is written at the call site. Full record:
 * SUBRESOURCE-404-PROBE-2026-08-14.md; reproduce with
 * scripts/probe-subresource-404.mjs.
 *
 * ── 2026-08-14: 18 of these were never reads ────────────────────────────────
 * The scan matches a PATH, and a write's path is shaped exactly like a read's,
 * so `/JobInstances/{id}/Start`, four `AssignJobDefinition`, three
 * `Microservices/{id}/{Start,Stop,Restart}`, four `StartEnrollment`,
 * `TriggerInstallationViaIntune`, `TriggerUpdateOnClient`, EntraId link/unlink
 * and a `BundleApplications/{id}` PATCH had all accumulated here.
 *
 * That is not untidiness. This list's closing procedure is "measure which of
 * the four causes in absent-data.ts applies", and a write has no collection and
 * no count, so the `data: null, totalItems: null` envelope cannot be what its
 * 404 means. Those 18 could never be closed the way the list says they close —
 * a fifth of the backlog was permanently unclosable, and every count taken off
 * it was wrong by that much. They are enumerated below in their own list, under
 * the guard family that can actually discharge them (ARCH-2, write bodies).
 *
 * A nineteenth entry was not a route at all: a prose fragment of an
 * endpoint-reach.ts note, in which `${o.maxGroupsChecked}/budgetMs` satisfied
 * "an interpolation followed by a path segment". `isSubResourceTemplate` now
 * rejects anything containing whitespace.
 */
const UNDECLARED_SUB_RESOURCE_READS = [
  // ── 12: no childless parent exists on this estate ────────────────────────
  // Every parent probed answered 200 WITH ROWS, so the observation that would
  // settle the question — a parent that legitimately has none — was never
  // available. No 404 was produced either. That is not evidence the 404 is
  // honest; it is no evidence, which is what this list is for.
  //
  // These are UNMEASURED, not unmeasurable. Each needs one shape this estate
  // does not happen to have, and most are a console creation away: a software
  // bundle with no applications, a job definition with no kiosk releases, a
  // logical group with no variables, a group with no members.
  //
  // ── The three DynamicGroups rows, and what changed on 2026-08-14 ─────────
  // They were recorded as all-404 with the cause undecidable. A Windows dynamic
  // group id supplied from the bMC console settled the cause: all three answer
  // 200 (Endpoints 1, WindowsEndpoints 1, JobInstances 19) and a nonexistent id
  // answers 404. The routes are served and the id KIND is right. The earlier
  // all-404 came from a UNIVERSAL dynamic group id — a different kind, which
  // correctly 404s here. What is still missing is a dynamic group with no
  // members.
  //
  // The owner reports (2026-08-14) that Windows dynamic groups are BEING
  // DEPRECATED by baramundi. Recorded as REPORTED, not as fact: the 26R1 spec
  // marks none of these operations `deprecated` — checked, all four are
  // `deprecated: false`. If the deprecation lands, these three close by the
  // routes going away rather than by measurement, which makes them the
  // lowest-value rows here to chase.
  'bconnect-groups-mcp/src/modules/groups.ts :: ${this.basePath}/DynamicGroups/${dynamicGroupId}/Endpoints',
  'bconnect-groups-mcp/src/modules/groups.ts :: ${this.basePath}/DynamicGroups/${dynamicGroupId}/WindowsEndpoints',
  'bconnect-groups-mcp/src/modules/groups.ts :: ${this.basePath}/StaticGroups/${staticGroupId}/Endpoints',
  'bconnect-groups-mcp/src/modules/groups.ts :: ${this.basePath}/StaticGroups/${staticGroupId}/WindowsEndpoints',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/DynamicGroups/${dynamicGroupId}/JobInstances',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/Endpoints/${endpointId}/KioskReleases',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/LogicalGroups/${logicalGroupId}/KioskReleases',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/StaticGroups/${staticGroupId}/JobInstances',
  'bconnect-servermanagement-mcp/src/modules/servermanagement.ts :: ${this.basePath}/Objects/${objectId}/Rights',
  'bconnect-software-mcp/src/modules/software.ts :: ${this.basePath}/Bundles/${bundleId}/BundleApplications',
  'bconnect-variables-mcp/src/modules/variables.ts :: ${this.basePath}/ADObjects/${adObjectId}/VariableInstances',
  'bconnect-variables-mcp/src/modules/variables.ts :: ${this.basePath}/LogicalGroups/${logicalGroupId}/VariableInstances',

  // ── 1: all-404, and the cause is NOT established ─────────────────────────
  // n=1 against a parent whose id KIND is itself a hypothesis: a
  // windowsApplicationId is ASSUMED to be a BundleApplication id, and this
  // estate holds exactly one BundleApplication, which 404'd. An all-404 result
  // is equally consistent with "overloaded", "route not served" and "wrong id
  // kind"; naming one would be the A11 error. Nearly no evidence either way.
  'bconnect-variables-mcp/src/modules/variables.ts :: ${this.basePath}/WindowsApplications/${windowsApplicationId}/VariableInstances',

  // ── 2: insights reads with nothing measured to declare ───────────────────
  // The other eight insights reads DECLARE, by passing the declaration to
  // readRows() as an argument — see paged-read.ts for why it is an argument and
  // not something the audit infers from scope. These two have no measurement to
  // pass: the same two routes appear above as INCONCLUSIVE. Both are already
  // SAFE at runtime; what is absent is evidence, not protection.
  'bconnect-insights-mcp/src/modules/deployment-coverage.ts :: /software/v2.0/Bundles/${options.bundleId}/BundleApplications',
  'bconnect-insights-mcp/src/modules/endpoint-reach.ts :: /jobs/v2.0/Endpoints/${options.endpointId}/KioskReleases',

  // ── 1: refused by our own credential containment ─────────────────────────
  // BitLocker recovery secrets need ALLOW_SECRET_READ=true, which was not set
  // for the probe and should not be set for one. Config-gated, so under the
  // reachability rule it ranks below default-posture defects.
  'bconnect-defensecontrol-mcp/src/modules/defensecontrol.ts :: ${this.basePath}/BitLocker/WindowsEndpoints/${id}/Secrets',

  // ── 1: deliberately not probed ───────────────────────────────────────────
  // preview-assignment builds the parent segment from a group KIND, not an id.
  // Its 404 was measured live 2026-08-04 and IS handled at the call site, with
  // the measurement written there — it simply cannot be expressed as one route.
  'bconnect-jobs-mcp/src/modules/preview-assignment.ts :: /endpoints/v2.0/${segment}/${id}/Endpoints',

];

/**
 * Sub-resource WRITES. Enumerated here so that moving them off the read list
 * does not make them vanish.
 *
 * A route that disappears from the scan is indistinguishable from a route that
 * was checked and found fine — that is this file's oldest lesson, and deleting
 * these outright would have re-learned it at the cost of 22 call sites. What
 * they need is not a 404 policy but the ARCH-2 property in
 * `suite-write-result-discarded.test.ts`: a write must not discard a body the
 * API declares. `start_enrollment` (Windows/Mac) is on both records.
 *
 * Four templates appear on BOTH lists, and that is correct rather than sloppy:
 * `/Endpoints/{id}/MaintenanceWindow`, `/LogicalGroups/{id}/MaintenanceWindow`,
 * `/BitLocker/WindowsEndpoints/{id}/Secrets` and
 * `/Bundles/{bundleId}/BundleApplications` are each read by one method and
 * written by another. The read still owes a 404 declaration.
 */
const SUB_RESOURCE_WRITES = [
  'bconnect-defensecontrol-mcp/src/modules/defensecontrol.ts :: ${this.basePath}/BitLocker/WindowsEndpoints/${id}/Secrets',
  'bconnect-defensecontrol-mcp/src/modules/defensecontrol.ts :: ${this.basePath}/LocalAdministrativeAccounts/WindowsEndpoints/${id}/TriggerUpdateOnClient',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/AndroidEndpoints/${id}/StartEnrollment',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/Endpoints/${endpointId}/EntraIdData',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/Endpoints/${id}/MaintenanceWindow',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/IosEndpoints/${id}/StartEnrollment',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/LogicalGroups/${id}/MaintenanceWindow',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/MacEndpoints/${id}/StartEnrollment',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/WindowsEndpoints/${id}/StartEnrollment',
  'bconnect-endpoints-mcp/src/modules/endpoints.ts :: ${this.basePath}/WindowsEndpoints/${id}/TriggerInstallationViaIntune',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/DynamicGroups/${dynamicGroupId}/AssignJobDefinition',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/JobInstances/${id}/Resume',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/JobInstances/${id}/Start',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/JobInstances/${id}/Stop',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/LogicalGroups/${logicalGroupId}/AssignJobDefinition',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/StaticGroups/${staticGroupId}/AssignJobDefinition',
  'bconnect-jobs-mcp/src/modules/jobs.ts :: ${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/AssignJobDefinition',
  'bconnect-servermanagement-mcp/src/modules/servermanagement.ts :: ${this.basePath}/Microservices/${id}/Restart',
  'bconnect-servermanagement-mcp/src/modules/servermanagement.ts :: ${this.basePath}/Microservices/${id}/Start',
  'bconnect-servermanagement-mcp/src/modules/servermanagement.ts :: ${this.basePath}/Microservices/${id}/Stop',
  'bconnect-software-mcp/src/modules/software.ts :: ${this.basePath}/Bundles/${bundleId}/BundleApplications',
  'bconnect-software-mcp/src/modules/software.ts :: ${this.basePath}/Bundles/${bundleId}/BundleApplications/${id}',
];

describe('ARCH-1 — a sub-resource read either declares its 404 policy or is on the list', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));

  function moduleSources(): string[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'build' || entry.name === '__tests__') {continue;}
          walk(full);
        } else if (entry.name.endsWith('.ts')) {
          files.push(full);
        }
      }
    };
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^bconnect-.*-mcp$/.test(entry.name)) {
        walk(join(root, entry.name, 'src'));
      }
    }
    return files.sort();
  }

  const scanned = moduleSources().flatMap((file) => {
    const relative = file.slice(root.length).replace(/\\/g, '/');
    return findSubResourceCalls(readFileSync(file, 'utf8')).map((call) => ({
      key: `${relative} :: ${call.template}`,
      declared: call.declared,
      kind: call.kind,
    }));
  });
  const reads = scanned.filter((call) => call.kind === 'read');
  const writes = scanned.filter((call) => call.kind === 'write');

  it('finds the sub-resource reads at all — the canary for the scan itself', () => {
    // If this collapses, the scan broke; the list below has not been fixed.
    expect(reads.length).toBeGreaterThanOrEqual(30);
    expect(reads.filter((read) => read.declared).length).toBeGreaterThanOrEqual(1);
  });

  it('has no undeclared read that is not on the list', () => {
    const known = new Set(UNDECLARED_SUB_RESOURCE_READS);
    const unlisted = reads.filter((read) => !read.declared && !known.has(read.key)).map((r) => r.key);
    expect(
      unlisted,
      'a new sub-resource read must say what its 404 means — see absent-data.ts'
    ).toEqual([]);
  });

  it('keeps writes off the read list, because a write cannot close the way it says', () => {
    // The defect this split fixed. 18 POST/PATCH/DELETE routes sat here, and
    // the list's closing procedure — measure which of absent-data.ts's four
    // causes applies — has no meaning for a call with no collection and no
    // count. They were unclosable, and they inflated every count taken off the
    // list by a fifth.
    const readKeys = new Set(reads.map((r) => r.key));
    const writeOnly = UNDECLARED_SUB_RESOURCE_READS.filter((key) => !readKeys.has(key));
    expect(
      writeOnly,
      'these have no read call site — they belong in SUB_RESOURCE_WRITES'
    ).toEqual([]);
  });

  it('enumerates every sub-resource write, so moving them did not hide them', () => {
    // Absence from a list is how a route declares itself fine, so the 22 that
    // left the read list have to arrive somewhere that is also checked.
    const known = new Set(SUB_RESOURCE_WRITES);
    expect(
      [...new Set(writes.filter((w) => !known.has(w.key)).map((w) => w.key))],
      'a new sub-resource write must be enumerated — see ARCH-2'
    ).toEqual([]);
    const found = new Set(writes.map((w) => w.key));
    expect(
      SUB_RESOURCE_WRITES.filter((key) => !found.has(key)),
      'these writes are gone from the source — delete them from the list'
    ).toEqual([]);
  });

  it('has no list entry that has since been declared', () => {
    // The ratchet's other direction: opting a route in means deleting its line,
    // so the list can only ever shrink and a stale entry cannot hide a fix.
    const undeclared = new Set(reads.filter((read) => !read.declared).map((read) => read.key));
    const stale = UNDECLARED_SUB_RESOURCE_READS.filter((key) => !undeclared.has(key));
    expect(stale, 'these now declare a 404 policy — delete them from the list').toEqual([]);
  });
  // The scan itself — a guard that silently skips a server is worse than none
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * The ratchet above enumerates every sub-resource read that has not yet
   * declared what its 404 means, and its title promises that a read "either
   * declares its 404 policy or is on the list". That was false of 30 routes.
   *
   * `sub-resource-audit.ts` matched `\.get\(` — a `(` immediately after `get`.
   * Every read in `bconnect-groups-mcp/src/modules/groups.ts` is written
   * `.get<EndpointsByLogicalGroup>(...)`, so not one of them could ever match.
   * 30 reads, the entire server, invisible — and the list read as complete
   * because absence from it is how a read declares itself fine.
   *
   * The existing canary could not catch it: `scanned.length >= 30` is satisfied
   * by the other servers' reads alone, so the number it asserts is reachable
   * with an entire module missing. A floor over a pooled total cannot detect a
   * missing contributor.
   *
   * These assert PER-MODULE presence instead. A server whose reads all vanish
   * now fails by name rather than by arithmetic.
   */
  describe('the sub-resource scan sees every module that has reads', () => {
    const scannedByFile = moduleSources().map((file) => {
      const relative = file.slice(root.length).replace(/\\/g, '/');
      const source = readFileSync(file, 'utf8');
      return {
        relative,
        // Counted independently of the scanner, from the source itself, so this
        // cannot agree with the scanner by sharing its bug.
        getCalls: (source.match(/\.get\s*(?:<[^>]*>)?\s*\(/g) ?? []).length,
        found: findSubResourceCalls(source).length,
        foundReads: findSubResourceCalls(source).filter((c) => c.kind === 'read').length,
      };
    });

    it('finds reads in bconnect-groups-mcp, which holds 30 of them', () => {
      // The exact file, not the first match in the server: bconnect-groups-mcp
      // also holds `group-member-matrix.ts`, which has no reads and would
      // satisfy a looser find while proving nothing.
      const groups = scannedByFile.find((f) =>
        f.relative.endsWith('bconnect-groups-mcp/src/modules/groups.ts')
      );
      expect(groups, 'the groups module was not scanned at all').toBeDefined();
      // Vacuity: the module really does contain reads, so a zero below is the
      // scanner's failure and not an empty file.
      expect(groups!.getCalls).toBeGreaterThanOrEqual(30);
      expect(groups!.found, 'groups reads are invisible to the audit').toBeGreaterThan(0);
      // As READS specifically. `kind` is the new way this module's 30 could
      // leave the backlog in one step: mislabel them all "write" and the read
      // list empties while the scan still reports 30 calls. groups.ts issues no
      // writes at all, so anything but 30 reads here is the classifier failing.
      expect(
        groups!.foundReads,
        'groups reads were found but not classified as reads'
      ).toBeGreaterThanOrEqual(30);
    });

    it('finds every SUB-RESOURCE-shaped read that is actually in the source', () => {
      // ── Extracted WITHOUT a regex, on purpose ──────────────────────────
      // The first version of this guard copied the scanner's own pattern
      // character for character, so `expected > found` was false by
      // construction and it returned [] for any source tree — a tautology
      // wearing the title of a property. That is the same shared-bug failure
      // the scanner's own header describes, reproduced in the test written to
      // catch it.
      //
      // This splits on backticks instead: odd-indexed segments of a
      // backtick-split are the template literals, no pattern involved. It
      // still agrees with the scanner about WHAT counts — `isSubResourceTemplate`
      // is the one shared decision, and it must be, or the two would be
      // measuring different things — but it cannot inherit a matching bug,
      // because it does no matching.
      const blind = moduleSources()
        .map((file) => {
          const relative = file.slice(root.length).replace(/\\/g, '/');
          const source = readFileSync(file, 'utf8');
          const templates = source
            .split('`')
            .filter((_, i) => i % 2 === 1)
            .filter(isSubResourceTemplate);
          return { relative, expected: templates.length, found: findSubResourceCalls(source).length };
        })
        .filter((f) => f.expected > f.found)
        .map((f) => `${f.relative}: ${f.expected} sub-resource call(s) in source, ${f.found} seen`);

      expect(
        blind,
        'a read the scan cannot see is an exception list that lies by omission — absence from ' +
          'UNDECLARED_SUB_RESOURCE_READS is how a read declares itself fine'
      ).toEqual([]);
    });
  });

});
