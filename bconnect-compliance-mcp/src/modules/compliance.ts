import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/compliance-types.js';
// M5 — the absent/empty/zero policy (packages/mcp-core/src/absent-data.ts).
import { readSubResource, type DataUnavailable } from '@bconnect/mcp-core';

// Type aliases
type RuleViolationPagedList = components['schemas']['RuleViolationPagedList'];
type DetectedVulnerabilityPagedList = components['schemas']['DetectedVulnerabilityPagedList'];
type RulePagedList = components['schemas']['RulePagedList'];
type Rule = components['schemas']['Rule'];
type Vulnerability = components['schemas']['Vulnerability'];
type VulnerabilityPagedList = components['schemas']['VulnerabilityPagedList'];

// Query parameter types
type GetDetectedRuleViolationsParams = operations['GetDetectedRuleViolations']['parameters']['query'];
type GetDetectedRuleViolationsForEndpointParams = operations['GetDetectedRuleViolationsForEndpoint']['parameters']['query'];
type GetAllDetectedVulnerabilitiesParams = operations['GetAllDetectedVulnerabilities']['parameters']['query'];
type GetDetectedVulnerabilitiesByEndpointParams = operations['GetDetectedVulnerabilitiesByEndpoint']['parameters']['query'];
type GetAllMobileDeviceRulesParams = operations['GetAllMobileDeviceRules']['parameters']['query'];
type GetAllVulnerabilitiesParams = operations['GetAllVulnerabilities']['parameters']['query'];

export class ComplianceModule {
  private basePath = '/compliance/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  /**
   * The client these reads go through.
   *
   * Exposed for cache PARTITIONING only: `exposure.ts` fingerprints it so a
   * cached CVE library cannot be served to a different bMS. Fingerprinting the
   * environment instead misses per-request gateway credentials and `__SUFFIX`
   * scoped variables, which is how a multi-tenant deployment is configured.
   */
  getHttpClient(): AxiosInstance {
    return this.httpClient;
  }

  async getDetectedRuleViolations(params: GetDetectedRuleViolationsParams = {}): Promise<RuleViolationPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/DetectedRuleViolations`, { params });
    return response.data;
  }

  // M5 — the sibling absent-data.ts cites as the cost of leaving a route
  // undeclared. Its 404 is declared here, and the FIRST version of this comment
  // got the reason wrong; the correction is the useful part.
  //
  // What is measured: 404 for 26 of 26 endpoint ids on this estate (the
  // 2026-08-04 note recorded six of six). Undeclared, that reached the model as
  // tool-error.ts's documented meaning of a 404 — "wrong id, or the route does
  // not exist on this release" — which are the two things it is not.
  //
  // This route is platform-restricted: 26R1's own summary is "Gets detected
  // rule violations for an Android, iOS or macOS endpoint by endpoint id". For
  // most of 2026-08-14 the estate held ZERO of all three, so every one of those
  // 26 ids was the wrong platform, every 404 was CORRECT, and the route had
  // never been called with an id it accepts. Two earlier versions of this
  // comment are recorded in git: the first read the estate-wide zero as proof
  // of overloading (it was not — with no mobile endpoints nothing could have
  // produced a violation), the second concluded the overload was undemonstrated.
  //
  // ── Then an Android endpoint was added, and it IS demonstrated ───────────
  // Measured the same day, once the owner registered one MDM record:
  //
  //   GET /endpoints/v2.0/AndroidEndpoints/{id}   200, type "AndroidEndpoint"
  //   GET /compliance/v2.0/Endpoints/{id}/DetectedRuleViolations      **404**
  //   GET /compliance/v2.0/DetectedRuleViolations   200, totalItems 0
  //   GET /compliance/v2.0/Rules                    200, 2 rules configured
  //
  // A VALID endpoint, of the RIGHT platform, with genuinely zero violations,
  // answers 404 — while the same feature's collection route expresses that
  // same zero as 200 with totalItems 0. The platform explanation is exhausted
  // and what remains is the overload itself: this route renders "none" as a
  // 404. Identical in shape to its sibling DetectedVulnerabilities (200 for 21
  // of 23 Windows endpoints, 404 for 2), which is the other demonstrated case.
  //
  // ── RIGHTS were tested and EXCLUDED, because they are a live cause here ──
  // "not visible due to missing rights" is how this API refuses on some other
  // routes, so the owner changed permissions and asked whether that was it.
  // Re-measured with a fresh client and the response cache disabled, so
  // neither a cached 404 nor a stale mounted build could answer for it:
  //
  //   estate-wide /DetectedRuleViolations      200   (module readable)
  //   the Android endpoint itself              200   (object readable)
  //   /Objects/{id}/Rights for that endpoint   Full, for EVERY security
  //                                            profile including the
  //                                            credential's own
  //   violations for that endpoint             404   (unchanged)
  //
  // The credential can read both halves independently and holds Full rights on
  // the object, and this route's 404 carries no `detail` at all where the
  // rights refusals elsewhere say so explicitly. Rights are not the cause.
  //
  // `servesPlatform` stays and is still true: 25 of the 27 endpoints here are
  // Windows, Linux or network, and for those the 404 IS correct. The envelope
  // is the only shape that keeps both readings in front of the caller without
  // picking one, which is what A11 asks for.
  async getDetectedRuleViolationsForEndpoint(endpointId: string, params: GetDetectedRuleViolationsForEndpointParams = {}): Promise<RuleViolationPagedList | DataUnavailable> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/Endpoints/${endpointId}/DetectedRuleViolations`, { params });
        return response.data as RuleViolationPagedList;
      },
      endpointId,
      {
        subject: "detected rule violations",
        servesPlatform: "Android, iOS or macOS",
        rightsRuledOut:
          "tested 2026-08-14 after a permissions change: the estate-wide " +
          "/DetectedRuleViolations reads 200, the endpoint itself reads 200, and " +
          "/servermanagement/v2.0/Objects/{id}/Rights reports Full for every security profile " +
          "including the credential's own. The 404 also carries no `detail`, where this API's " +
          "rights refusals state one.",
        howToDisambiguate:
          "Check the PLATFORM first — call get_endpoint with this id. This route serves Android, " +
          "iOS and macOS endpoints only, so for a Windows, Linux or network endpoint the 404 is " +
          "correct and expected. If it IS a mobile endpoint, the 404 is this route rendering " +
          "\"none\" as an error — measured 2026-08-14 against a real Android endpoint with zero " +
          "violations. Call list_detected_rule_violations (no endpoint id) to get the real count: " +
          "0 there means the estate genuinely has none, and above 0 means the data for THIS " +
          "endpoint is missing rather than empty.",
      }
    );
  }

  async getAllDetectedVulnerabilities(params: GetAllDetectedVulnerabilitiesParams = {}): Promise<DetectedVulnerabilityPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/DetectedVulnerabilities`, { params });
    return response.data;
  }

  // M5 — this route's 404 is overloaded. Measured live 2026-08-03: it answers
  // 200 for 21 of this estate's 23 Windows endpoints and 404 for 2
  // (WIN10CLIENT3, WIN10CLIENT10), both present and managed. The bare error
  // read as "Resource not found", whose most dangerous interpretation is
  // "nothing found, therefore zero vulnerabilities".
  //
  // Only 404 is translated, and only here — see absent-data.ts for why this is
  // not a client-wide rule (a blanket version would report a Linux endpoint as
  // having no vulnerabilities) and why the cause is enumerated rather than
  // chosen (the `type` discriminator proposed for it does not discriminate).
  async getDetectedVulnerabilitiesByEndpoint(endpointId: string, params: GetDetectedVulnerabilitiesByEndpointParams = {}): Promise<DetectedVulnerabilityPagedList | DataUnavailable> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/WindowsEndpoints/${endpointId}/DetectedVulnerabilities`, { params });
        return response.data as DetectedVulnerabilityPagedList;
      },
      endpointId,
      {
        subject: "detected vulnerabilities",
        servesPlatform: "Windows",
        howToDisambiguate:
          "Call get_endpoint with this id: if it returns a non-Windows endpoint the 404 is correct " +
          "and expected; if it returns a Windows endpoint, treat the scan data as MISSING, not empty.",
      }
    );
  }

  // Route corrected 2026-08-03. Both methods called `/MobileDeviceRules`, which
  // 404s — the tools had never returned data. The 26R1 spec declares
  // GetAllMobileDeviceRules at GET /v2.0/Rules and GetMobileDeviceRule at
  // GET /v2.0/Rules/{id}; verified live, `/Rules` answers 200 and
  // `/MobileDeviceRules` answers 404.
  //
  // This survived every earlier check because each one stopped short of the wire:
  // the drift guard could not map the tool to an operation and pinned it as
  // "unverifiable" rather than wrong, and a review confirmed the URL was built
  // correctly without asking whether the server accepted it. A constructed URL is
  // not a working one.
  async getAllMobileDeviceRules(params: GetAllMobileDeviceRulesParams = {}): Promise<RulePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/Rules`, { params });
    return response.data;
  }

  async getMobileDeviceRule(ruleId: string): Promise<Rule> {
    const response = await this.httpClient.get(`${this.basePath}/Rules/${ruleId}`);
    return response.data;
  }

  async getAllVulnerabilities(params: GetAllVulnerabilitiesParams = {}): Promise<VulnerabilityPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/Vulnerabilities`, { params });
    return response.data;
  }

  async getVulnerability(vulnerabilityId: string): Promise<Vulnerability> {
    const response = await this.httpClient.get(`${this.basePath}/Vulnerabilities/${vulnerabilityId}`);
    return response.data;
  }
}
