import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/compliance-types.js';

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

  async getDetectedRuleViolations(params: GetDetectedRuleViolationsParams = {}): Promise<RuleViolationPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/DetectedRuleViolations`, { params });
    return response.data;
  }

  async getDetectedRuleViolationsForEndpoint(endpointId: string, params: GetDetectedRuleViolationsForEndpointParams = {}): Promise<RuleViolationPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/Endpoints/${endpointId}/DetectedRuleViolations`, { params });
    return response.data;
  }

  async getAllDetectedVulnerabilities(params: GetAllDetectedVulnerabilitiesParams = {}): Promise<DetectedVulnerabilityPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/DetectedVulnerabilities`, { params });
    return response.data;
  }

  async getDetectedVulnerabilitiesByEndpoint(endpointId: string, params: GetDetectedVulnerabilitiesByEndpointParams = {}): Promise<DetectedVulnerabilityPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/WindowsEndpoints/${endpointId}/DetectedVulnerabilities`, { params });
    return response.data;
  }

  async getAllMobileDeviceRules(params: GetAllMobileDeviceRulesParams = {}): Promise<RulePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/MobileDeviceRules`, { params });
    return response.data;
  }

  async getMobileDeviceRule(ruleId: string): Promise<Rule> {
    const response = await this.httpClient.get(`${this.basePath}/MobileDeviceRules/${ruleId}`);
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
