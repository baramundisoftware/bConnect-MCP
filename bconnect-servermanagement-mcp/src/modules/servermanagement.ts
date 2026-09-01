import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/servermanagement-types.js';

// Type aliases
type ManagementServer = components['schemas']['ManagementServer'];
type Gateway = components['schemas']['Gateway'];
type DipInfo = components['schemas']['DipInfo'];
type VpnAppliance = components['schemas']['VpnAppliance'];
type Microservice = components['schemas']['Microservice'];
type CloudConnector = components['schemas']['CloudConnector'];
type PxeRelay = components['schemas']['PxeRelay'];
type SecurityGroupPagedList = components['schemas']['SecurityGroupPagedList'];
type SecurityGroup = components['schemas']['SecurityGroup'];
type SecurityProfilePagedList = components['schemas']['SecurityProfilePagedList'];
type SecurityProfile = components['schemas']['SecurityProfile'];
type ObjectPermissions = components['schemas']['ObjectPermissions'];
type CleanupSimulationResult = components['schemas']['CleanupSimulationResult'];
type CleanupResult = components['schemas']['CleanupResult'];

// Query parameter types
type GetSecurityGroupsParams = operations['GetSecurityGroups']['parameters']['query'];
type GetSecurityProfilesParams = operations['GetSecurityProfiles']['parameters']['query'];
// LOCAL FIX — D14b / D3: taken straight from the generated operation rather
// than hand-written, so it cannot drift from what the API declares.
type DownloadJobsQueryParams = operations['GetDownloadJobs']['parameters']['query'];

// Write operation types - Phase 2
type SecurityGroupForCreation = operations['CreateSecurityGroup']['requestBody']['content']['application/json'];
type SecurityGroupUpdate = operations['UpdateSecurityGroup']['requestBody']['content']['application/json-patch+json'];
type SecurityProfileForCreation = operations['CreateSecurityProfile']['requestBody']['content']['application/json'];
type SecurityProfileUpdate = operations['UpdateSecurityProfile']['requestBody']['content']['application/json-patch+json'];
type ObjectPermissionUpdate = operations['UpdateObjectPermission']['requestBody']['content']['application/json-patch+json'];

/**
 * The ONLY content type any bConnect PATCH route accepts.
 *
 * Measured 2026-08-19 across all 26R1 specs: 25 PATCH operations, every one
 * declaring `application/json-patch+json` and nothing else. axios sends
 * `application/json` when no config is passed (measured against a capturing
 * adapter), which those routes answer with 415.
 *
 * Enforced by `__tests__/suite-patch-content-type.test.ts`, which reads call-site
 * ARGUMENTS rather than grepping for this string — the string also appears in
 * generated type aliases, and counting it wrongly cleared two modules.
 */
const JSON_PATCH_REQUEST = { headers: { 'Content-Type': 'application/json-patch+json' } } as const;
export class ServerManagementModule {
  private basePath = '/servermanagement/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // Server Information
  async getManagementServer(): Promise<ManagementServer> {
    const response = await this.httpClient.get(`${this.basePath}/ManagementServer`);
    return response.data;
  }

  async getGateway(): Promise<Gateway> {
    const response = await this.httpClient.get(`${this.basePath}/Gateway`);
    return response.data;
  }

  async getDipStatus(): Promise<DipInfo[]> {
    const response = await this.httpClient.get(`${this.basePath}/Dips`);
    return response.data;
  }

  async getVpnAppliance(): Promise<VpnAppliance> {
    const response = await this.httpClient.get(`${this.basePath}/VpnAppliance`);
    return response.data;
  }

  // Microservices
  async getMicroservices(): Promise<Microservice[]> {
    const response = await this.httpClient.get(`${this.basePath}/Microservices`);
    return response.data;
  }

  async getMicroservice(id: string): Promise<Microservice> {
    const response = await this.httpClient.get(`${this.basePath}/Microservices/${id}`);
    return response.data;
  }

  // Infrastructure Components
  async getCloudConnectors(): Promise<CloudConnector[]> {
    const response = await this.httpClient.get(`${this.basePath}/CloudConnectors`);
    return response.data;
  }

  async getPxeRelays(): Promise<PxeRelay[]> {
    const response = await this.httpClient.get(`${this.basePath}/PxeRelays`);
    return response.data;
  }

  // Security Groups
  async getSecurityGroups(
    params: GetSecurityGroupsParams = {}
  ): Promise<SecurityGroupPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/SecurityGroups`, {
      params,
    });
    return response.data;
  }

  async getSecurityGroup(id: string): Promise<SecurityGroup> {
    const response = await this.httpClient.get(`${this.basePath}/SecurityGroups/${id}`);
    return response.data;
  }

  // Security Profiles
  async getSecurityProfiles(
    params: GetSecurityProfilesParams = {}
  ): Promise<SecurityProfilePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/SecurityProfiles`, {
      params,
    });
    return response.data;
  }

  async getSecurityProfile(id: string): Promise<SecurityProfile> {
    const response = await this.httpClient.get(`${this.basePath}/SecurityProfiles/${id}`);
    return response.data;
  }

  // Object Permissions
  async getAccessRights(objectId: string): Promise<ObjectPermissions> {
    const response = await this.httpClient.get(`${this.basePath}/Objects/${objectId}/Rights`);
    return response.data;
  }

  // ============================================================================
  // WRITE OPERATIONS - Phase 2
  // ============================================================================

  /**
   * Restart the baramundi Management Server
   * Requires server setting rights (43F30D47-4410-438E-AAD0-98157456322D)
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding the one fact worth having.
   *
   * `POST /v2.0/Restart` answers 200 with a bare date-time string described as
   * "Restart time of the management server". The handler said "Management server restart
   * initiated." — which asserts an IMMEDIATE restart the response never claims. If the
   * server schedules it instead, the returned timestamp is the only thing that says so,
   * and it was being thrown away in favour of the assertion it would have corrected.
   */
  async restartManagementServer(): Promise<string> {
    const response = await this.httpClient.post<string>(`${this.basePath}/Restart`);
    return response.data;
  }

  /**
   * Cancel scheduled restart of the baramundi Management Server
   * Requires server setting rights (43F30D47-4410-438E-AAD0-98157456322D)
   */
  async cancelScheduledRestart(): Promise<void> {
    await this.httpClient.post(`${this.basePath}/CancelScheduledRestart`);
  }

  /**
   * Start a microservice by ID
   * Requires server setting rights (43F30D47-4410-438E-AAD0-98157456322D)
   */
  async startMicroservice(id: string): Promise<void> {
    await this.httpClient.post(`${this.basePath}/Microservices/${id}/Start`);
  }

  /**
   * Stop a microservice by ID
   * Requires server setting rights (43F30D47-4410-438E-AAD0-98157456322D)
   */
  async stopMicroservice(id: string): Promise<void> {
    await this.httpClient.post(`${this.basePath}/Microservices/${id}/Stop`);
  }

  /**
   * Restart a microservice by ID
   * Requires server setting rights (43F30D47-4410-438E-AAD0-98157456322D)
   */
  async restartMicroservice(id: string): Promise<void> {
    await this.httpClient.post(`${this.basePath}/Microservices/${id}/Restart`);
  }

  /**
   * Create a new security group
   */
  async createSecurityGroup(data: SecurityGroupForCreation): Promise<SecurityGroup> {
    const response = await this.httpClient.post<SecurityGroup>(
      `${this.basePath}/SecurityGroups`,
      data
    );
    return response.data;
  }

  /**
   * Update an existing security group
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * 200 is "Returns the new values of the security group with the specified id". This is a
   * PERMISSIONS surface: a JSON-Patch that quietly failed to apply and one that applied were
   * the same `{success: true}` to the caller, which is the worst place for that to be true.
   */
  async updateSecurityGroup(id: string, data: SecurityGroupUpdate): Promise<SecurityGroup> {
    const response = await this.httpClient.patch<SecurityGroup>(`${this.basePath}/SecurityGroups/${id}`, data, JSON_PATCH_REQUEST);
    return response.data;
  }

  /**
   * Delete a security group by ID
   */
  async deleteSecurityGroup(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/SecurityGroups/${id}`);
  }

  /**
   * Create a new security profile
   */
  async createSecurityProfile(data: SecurityProfileForCreation): Promise<SecurityProfile> {
    const response = await this.httpClient.post<SecurityProfile>(
      `${this.basePath}/SecurityProfiles`,
      data
    );
    return response.data;
  }

  /**
   * Update an existing security profile
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * 200 is "Returns the new values of the security profile with the specified id". Same
   * permissions-surface argument as updateSecurityGroup above.
   */
  async updateSecurityProfile(id: string, data: SecurityProfileUpdate): Promise<SecurityProfile> {
    const response = await this.httpClient.patch<SecurityProfile>(`${this.basePath}/SecurityProfiles/${id}`, data, JSON_PATCH_REQUEST);
    return response.data;
  }

  /**
   * Delete a security profile by ID
   */
  async deleteSecurityProfile(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/SecurityProfiles/${id}`);
  }

  /**
   * Update object permissions
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * 200 is "Returns the new values of the object permission with the specified id". Same again.
   */
  async updateObjectPermission(id: string, data: ObjectPermissionUpdate): Promise<ObjectPermissions> {
    const response = await this.httpClient.patch<ObjectPermissions>(`${this.basePath}/Objects/${id}`, data, JSON_PATCH_REQUEST);
    return response.data;
  }

  // ============================================================================
  // 26R1-ONLY OPERATIONS
  // ============================================================================

  /** Get API keys configured in baramundi Management Suite (26R1 only) */
  async getApiKeys(): Promise<unknown[]> {
    const response = await this.httpClient.get(`${this.basePath}/ApiKeys`);
    return response.data;
  }

  /**
   * Simulate MSW cleanup on a DIP server (26R1 only).
   *
   * Returns the body, which is the whole point of a simulation: the 200
   * carries `filesToDelete[]`. Until 2026-08-11 this returned void — a
   * dry-run whose only product was discarded (TOOL-REVIEW-MATRIX.md H5).
   */
  async simulateMSWCleanup(): Promise<CleanupSimulationResult> {
    const response = await this.httpClient.post<CleanupSimulationResult>(
      `${this.basePath}/Dips/SimulateMSWCleanup`
    );
    return response.data;
  }

  /**
   * Trigger MSW cleanup on a DIP server (26R1 only).
   *
   * Returns the body: the 200 carries `wasSuccessful`, and discarding it
   * (as this did until 2026-08-11) reported a failed cleanup as done —
   * the verify-install exit-0 defect class.
   */
  async mswCleanup(): Promise<CleanupResult> {
    const response = await this.httpClient.post<CleanupResult>(
      `${this.basePath}/Dips/MSWCleanup`
    );
    return response.data;
  }

  /**
   * Get all download jobs in baramundi Management Suite (26R1 only)
   *
   * LOCAL FIX — D14b / D3: this method took no arguments, so the filters
   * GET /v2.0/DownloadJobs declares (Name, StateValue, LastExecution) and its
   * paging were unreachable. `params` is optional and additive; see
   * operations.GetDownloadJobs in src/generated/servermanagement-types.ts.
   */
  async getDownloadJobs(params?: DownloadJobsQueryParams): Promise<unknown[]> {
    const response = await this.httpClient.get(`${this.basePath}/DownloadJobs`, { params });
    return response.data;
  }

  /** Get a specific download job by ID (26R1 only) */
  async getDownloadJob(id: string): Promise<unknown> {
    const response = await this.httpClient.get(`${this.basePath}/DownloadJobs/${id}`);
    return response.data;
  }
}
