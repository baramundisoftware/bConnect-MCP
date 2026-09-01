/**
 * bconnect-compliance-mcp — the tool catalogue, declared once (finding OPT-31)
 *
 * ── What moved ──────────────────────────────────────────────────────────────
 * Every tool in this server used to be written out three times inside
 * `src/index.ts` and `src/utils/mcp-tool-validation-rules.ts`: a hand-authored
 * `inputSchema`, a hand-authored `ValidationRule[]`, and a `case` in a
 * `validateToolArguments` switch that mapped the first to the second. The
 * schema and the rules restated the same OpenAPI operation, and nothing made
 * them agree — `__tests__/suite-schema-vs-types.test.ts` exists precisely
 * because they had already drifted apart across the suite.
 *
 * `defineTools()` derives BOTH from the operation, so they cannot disagree.
 * What is left here is the part no spec contains: the description, and the
 * judgement about which parameters to advertise.
 *
 * ── Why compliance went first ───────────────────────────────────────────────
 * Smallest blast radius of the twelve: 8 wrapper tools, all GET, all already on
 * 26R1 types, no write gate to get wrong, and a clean 1:1 between tool and
 * operation (verified — the eight operationIds below are the whole spec).
 *
 * ── The two composites do NOT go through derivation ─────────────────────────
 * `get_vulnerability_exposure` and `get_unpatched_endpoints` answer no single
 * route: they join detected vulnerabilities against the CVE library and against
 * job history, across two API prefixes, in ~1,500 lines of `src/modules/`.
 * `composite()` passes them through by identity — same object, same order, same
 * bytes — and their schemas below are the same objects index.ts used to hold.
 * They are also two of the thirteen protected demo tools, so "same bytes" is a
 * requirement rather than a nicety, and `__tests__/declared-tools.test.ts`
 * asserts it with `toEqual` against the pre-change text.
 *
 * ── One deliberate surface change ───────────────────────────────────────────
 * `get_mobile_device_rule` took `ruleId` and `get_vulnerability` took
 * `vulnerabilityId`. Neither name exists upstream: both routes declare `id`
 * (`/v2.0/Rules/{id}`, `/v2.0/Vulnerabilities/{id}`). The names were invented
 * here, and `defineTools` refuses to advertise a parameter the operation does
 * not declare — which is the D6 guard doing its job, not an inconvenience. Both
 * now advertise `id`, matching the rest of the suite (`get_job_definition`,
 * `get_asset`, `get_software_bundle` all take `id`). This is a BREAKING change
 * to two tool schemas; neither is a protected demo tool.
 */

import {
  composite,
  defineTools,
  objectSchema,
  type DeclaredTools,
} from "@bconnect/mcp-core";
import { COMPLIANCE_OPERATIONS } from "./generated/compliance-operations.js";

/**
 * `OrderBy` and `SearchQuery` are per-route: each names the properties THAT
 * route sorts and searches. The canonical fragment cannot know them, and the
 * vendor's own sentence is over the derivation layer's 80-byte limit — so these
 * are stated, which is exactly the case `describe` exists for.
 */
const violationFilters = {
  OrderBy: "Sort results by property name and direction (e.g. 'RuleName asc'). Possible values: EndpointName, RuleName.",
  SearchQuery: "Filter results by matching against EndpointName or RuleName.",
};

export const DECLARED: DeclaredTools = defineTools(COMPLIANCE_OPERATIONS, {
  // ── Composite analysis (LOCAL ADDITION) ─────────────────────────────────
  //
  // Declared first, as they were before: `defineToolCatalogue` guarantees
  // declaration order and these two are the tools worth finding first.
  get_vulnerability_exposure: composite({
    description:
      "Report which endpoints carry vulnerabilities at or above a CVSS threshold, ranked by count. " +
      "Joins detected vulnerabilities against the vulnerability library server-side and returns an " +
      "aggregate summary rather than raw rows. Use this for questions like 'which machines are most " +
      "at risk', 'what is our critical exposure', or 'how bad is endpoint X' — it replaces roughly 40 " +
      "separate calls. This measures CVE DETECTIONS from the vulnerability scanner, NOT outstanding " +
      "Microsoft Updates — for 'which Windows Updates is this machine missing' use " +
      "list_update_management_endpoints in bconnect-updatemanagement. Always read " +
      "meta.resultTrustworthy before quoting any count: when it is false the vulnerability library " +
      "did not fully load and a zero means 'unknown', not 'clean'. Read-only.",
    inputSchema: objectSchema({
      minCvss: {
        type: "number",
        description: "Minimum CVSS score to count, inclusive (default: 7 — 'high and above').",
      },
      endpointName: {
        type: "string",
        description: "Restrict the analysis to a single endpoint by display name.",
      },
      includeIgnored: {
        type: "boolean",
        description: "Include detections marked ignored in bMS (default: false).",
      },
      topEndpoints: {
        type: "number",
        description: "How many endpoints to return, most-affected first (default: 20).",
      },
      refreshLibrary: {
        type: "boolean",
        description: "Force a refresh of the cached vulnerability library (default: false; cache lives 1 hour).",
      },
      includeScanAge: {
        type: "boolean",
        description:
          "Annotate each ranked endpoint with the date its vulnerability data was last refreshed, " +
          "and summarise how current the ranking is (default: true). Costs one cached request.",
      },
      staleAfterDays: {
        type: "number",
        description: "Scan age in days beyond which an endpoint's count is reported as stale (default: 30).",
      },
    }),
    rules: [
      { name: "minCvss", required: false, type: "number", min: 0, max: 10 },
      { name: "endpointName", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "includeIgnored", required: false, type: "boolean" },
      { name: "topEndpoints", required: false, type: "number", min: 1, max: 1000 },
      { name: "refreshLibrary", required: false, type: "boolean" },
      { name: "includeScanAge", required: false, type: "boolean" },
      { name: "staleAfterDays", required: false, type: "number", min: 0 },
    ],
  }),

  get_unpatched_endpoints: composite({
    description:
      "Rank endpoints that need patching, joining three things nothing in bConnect joins natively: " +
      "how many vulnerabilities each endpoint carries above a CVSS threshold, whether the endpoint is " +
      "reachable right now (so a patch job would actually run rather than queue against a machine that " +
      "has been offline for months), and how old the vulnerability scan behind that count is. Use this " +
      "for 'which machines need patching', 'show me the patch queue', or 'which vulnerable endpoints can " +
      // TRIMMED. The removed clause said the response "states in plain language
      // when the ranking is not comparable across rows" — true, and something
      // the caller reads in the response itself rather than needing in advance.
      // "Labelled, not hidden" stays because a model that expects unreachable
      // endpoints to be filtered out will misread the ranking; and the final
      // sentence stays untouched because it says this tool does not patch.
      "we actually fix today'. Unreachable and never-scanned endpoints are labelled, not hidden. " +
      // The near-miss that produces a wrong answer rather than a wasted turn.
      // This tool advertises "which machines need patching" and "show me the
      // patch queue"; a model asked "which machines are missing critical
      // patches" lands here and returns a CVE ranking, which an administrator
      // reads as a Windows Update compliance report. They are different sets,
      // from different data, with different freshness.
      "This ranks by CVE DETECTIONS from the vulnerability scanner, NOT by outstanding Microsoft " +
      "Updates — for 'which Windows Updates is this machine missing' use " +
      "list_update_management_endpoints in bconnect-updatemanagement, which answers the whole " +
      "estate in one read-only call. Always read meta.resultTrustworthy before quoting any count: " +
      "when it is false the underlying data was incomplete, and a zero means 'unknown', not 'clean'. " +
      "Read-only — it stages the decision, it does not patch anything.",
    inputSchema: objectSchema({
      minCvss: {
        type: "number",
        description: "Minimum CVSS score to count a vulnerability, inclusive (default: 7).",
      },
      limit: {
        type: "number",
        description: "How many endpoints to return, most-affected first (default: 10).",
      },
      reachableWithinDays: {
        type: "number",
        description:
          "An endpoint counts as reachable if it checked in within this many days (default: 7, which " +
          "spans a weekend). The right value is the interval at which the endpoints being managed " +
          "actually contact bMS — a shorter window labels healthy machines unreachable. " +
          "meta.reachability reports the observed check-in ages so the default can be checked rather " +
          "than assumed.",
      },
      staleAfterDays: {
        type: "number",
        description: "Scan age in days beyond which an endpoint's count is flagged as stale (default: 30).",
      },
      onlyReachable: {
        type: "boolean",
        description:
          "Drop unreachable endpoints instead of returning them labelled (default: false — labelling is " +
          "usually more useful, since a long-dark machine is itself a finding).",
      },
      includeIgnored: {
        type: "boolean",
        description: "Include detections marked ignored in bMS (default: false).",
      },
      refresh: {
        type: "boolean",
        description: "Force a refresh of the cached vulnerability library and job history (default: false).",
      },
    }),
    rules: [
      { name: "minCvss", required: false, type: "number", min: 0, max: 10 },
      { name: "limit", required: false, type: "number", min: 1, max: 1000 },
      { name: "reachableWithinDays", required: false, type: "number", min: 0 },
      { name: "staleAfterDays", required: false, type: "number", min: 0 },
      { name: "onlyReachable", required: false, type: "boolean" },
      { name: "includeIgnored", required: false, type: "boolean" },
      { name: "refresh", required: false, type: "boolean" },
    ],
  }),

  // ── Rule Violations ─────────────────────────────────────────────────────
  list_detected_rule_violations: {
    op: "GetDetectedRuleViolations",
    description:
      "List all detected compliance rule violations for Android, iOS, and macOS endpoints managed in baramundi Management Suite. Returns a paged list of rule violations with endpoint names, rule names, violation states, and detection timestamps.",
    describe: violationFilters,
    shaping: ["countOnly"],
  },

  // INT-47 — renamed from list_detected_rule_violations_for_endpoint.
  // `_by_<scope>` is the suite convention (list_assets_by_windows_endpoint,
  // list_defender_threats_by_endpoint, list_job_instances_by_logical_group);
  // `_for_endpoint` existed only here and in its vulnerabilities twin.
  list_detected_rule_violations_by_endpoint: {
    op: "GetDetectedRuleViolationsForEndpoint",
    description:
      "List all detected compliance rule violations for a specific Android, iOS, or macOS endpoint identified by its GUID. Returns a paged list of violations including rule names, violation states, and detection timestamps for the specified endpoint.",
    describe: {
      ...violationFilters,
      endpointId: "GUID of the Android, iOS, or macOS endpoint to retrieve rule violations for.",
    },
    shaping: ["countOnly"],
  },

  // ── Detected Vulnerabilities ────────────────────────────────────────────
  list_detected_vulnerabilities: {
    op: "GetAllDetectedVulnerabilities",
    description:
      "List all detected CVE vulnerabilities across all Windows endpoints managed in baramundi Management Suite. Returns detections GROUPED BY ENDPOINT: each entry carries the endpoint and its scan date once, with that endpoint's CVEs beneath it, instead of repeating the endpoint on every row — measured 47-60% smaller with nothing dropped. data[] is one entry per ENDPOINT while totalItems counts DETECTIONS; meta states both. Pass detail:true for the flat one-row-per-detection record.",
    describe: {
      OrderBy: "Sort results by property name and direction. Possible values: EndpointName, CveId.",
      SearchQuery: "Filter results by matching against EndpointName or CveId.",
    },
    shaping: ["countOnly", "detail"],
  },

  // INT-47 — renamed from list_detected_vulnerabilities_for_endpoint.
  list_detected_vulnerabilities_by_endpoint: {
    op: "GetDetectedVulnerabilitiesByEndpoint",
    description:
      "List all detected CVE vulnerabilities for a specific Windows endpoint identified by its GUID. Returns a paged list of vulnerabilities including CVE identifiers, detection timestamps, and ignored status for that specific managed Windows endpoint. countOnly:true answers 'how many' without fetching a page.",
    describe: {
      OrderBy: "Sort results by property name and direction. Possible value: CveId.",
      SearchQuery: "Filter results by matching against CveId.",
      endpointId: "GUID of the Windows endpoint to retrieve detected vulnerabilities for.",
    },
    shaping: ["countOnly"],
  },

  // ── Mobile Device Rules ─────────────────────────────────────────────────
  list_mobile_device_rules: {
    op: "GetAllMobileDeviceRules",
    description:
      "List all mobile device compliance rules configured in baramundi Management Suite for Android, iOS, and macOS endpoints. Returns a paged list of rules with names, types, severity levels, and descriptions used to evaluate endpoint compliance status.",
    describe: {
      OrderBy: "Sort results by property name and direction. Possible values: RuleName, Description.",
      SearchQuery: "Filter results by matching against RuleName or Description.",
    },
    shaping: ["countOnly"],
  },

  get_mobile_device_rule: {
    op: "GetMobileDeviceRule",
    description:
      "Get the details of a specific mobile device compliance rule by its GUID. Returns the rule name, type, severity level, and description for the specified compliance rule configured in baramundi Management Suite for mobile endpoint compliance evaluation.",
    // `id`, not `ruleId` — see the header. The wording is stated rather than
    // derived because the derived form would be "GUID of the rule." and the
    // resource is worth naming in full.
    describe: { id: "GUID of the mobile device compliance rule to retrieve." },
  },

  // ── Vulnerabilities (CVE Library) ───────────────────────────────────────
  //
  // AUD-optimization-1 — this is the whole CVE library (totalItems 37,571
  // measured live), and affectedOperatingSystems alone was 42.1% of a 20-row
  // page (6,751 of 16,039 B). Dropped from the compact projection and named
  // in meta.dropped, same "detail:true escape" pattern as OPT-3/OPT-4 and the
  // WMI __PATH fold: -41.6% measured, nothing hidden, detail:true is exact.
  list_vulnerabilities: {
    op: "GetAllVulnerabilities",
    description:
      "List all CVE vulnerabilities in the baramundi vulnerability library for Windows endpoints. Returns a paged list of vulnerabilities with CVE identifiers, CVSS scores, severity ratings, and descriptions. This is the whole CVE library (tens of thousands of entries) — always filter or use countOnly rather than paging through it blind. Compact by default: affectedOperatingSystems is dropped (it ran 42% of page bytes on a live 20-row measurement) and named in meta.dropped. Pass detail:true for the full record including affectedOperatingSystems, fields:[..] to pick columns, countOnly:true for the count alone.",
    describe: {
      OrderBy: "Sort results by property name and direction. Possible values: CveId, Severity.",
      SearchQuery: "Filter results by matching against searchable vulnerability properties.",
    },
    shaping: ["countOnly", "detail", "fields"],
  },

  get_vulnerability: {
    op: "GetVulnerability",
    description:
      "Get the details of a specific CVE vulnerability from the baramundi vulnerability library by its GUID. Returns the CVE identifier, CVSS score, severity rating, description, and lists of affected products and operating systems.",
    describe: { id: "GUID of the CVE vulnerability to retrieve from the baramundi library." },
  },
});
