import type { JsonPatchOperation } from "@bconnect/mcp-core";
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

// Query parameter types
type GetSecurityGroupsParams = operations['GetSecurityGroups']['parameters']['query'];
type GetSecurityProfilesParams = operations['GetSecurityProfiles']['parameters']['query'];

// Write operation types - Phase 2
type SecurityGroupForCreation = operations['CreateSecurityGroup']['requestBody']['content']['application/json'];
type SecurityProfileForCreation = operations['CreateSecurityProfile']['requestBody']['content']['application/json'];

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
  async restartManagementServer(utcScheduleRestartTime?: string): Promise<unknown> {
    const response = await this.httpClient.post(`${this.basePath}/Restart`, undefined, {
      ...(utcScheduleRestartTime && { params: { utcScheduleRestartTime } }),
    });
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
  async updateSecurityGroup(id: string, data: JsonPatchOperation[]): Promise<unknown> {
    const response = await this.httpClient.patch(`${this.basePath}/SecurityGroups/${id}`, data);
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
  async updateSecurityProfile(id: string, data: JsonPatchOperation[]): Promise<unknown> {
    const response = await this.httpClient.patch(`${this.basePath}/SecurityProfiles/${id}`, data);
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
  async updateObjectPermission(id: string, data: JsonPatchOperation[]): Promise<unknown> {
    const response = await this.httpClient.patch(`${this.basePath}/Objects/${id}`, data);
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

  /** Simulate MSW cleanup on a DIP server (26R1 only) */
  async simulateMSWCleanup(): Promise<unknown> {
    const response = await this.httpClient.post(`${this.basePath}/Dips/SimulateMSWCleanup`);
    return response.data;
  }

  /** Trigger MSW cleanup on a DIP server (26R1 only) */
  async mswCleanup(): Promise<unknown> {
    const response = await this.httpClient.post(`${this.basePath}/Dips/MSWCleanup`);
    return response.data;
  }

  /** Get all download jobs in baramundi Management Suite (26R1 only) */
  async getDownloadJobs(params: Record<string, unknown> = {}): Promise<unknown[]> {
    const response = await this.httpClient.get(`${this.basePath}/DownloadJobs`, { params });
    return response.data;
  }

  /** Get a specific download job by ID (26R1 only) */
  async getDownloadJob(id: string): Promise<unknown> {
    const response = await this.httpClient.get(`${this.basePath}/DownloadJobs/${id}`);
    return response.data;
  }
}
