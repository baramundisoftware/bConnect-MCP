/**
 * bConnect Jobs Module
 *
 * Handles job and deployment management operations
 */

import type { AxiosInstance } from "axios";
import type { paths } from "../generated/jobs-types.js";

// Type aliases for cleaner code
type JobDefinitionsList = paths["/v2.0/JobDefinitions"]["get"]["responses"]["200"]["content"]["application/json"];
type JobDefinition = paths["/v2.0/JobDefinitions/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type JobDefinitionsByFolderList = paths["/v2.0/Folders/{folderId}/JobDefinitions"]["get"]["responses"]["200"]["content"]["application/json"];
type JobInstancesList = paths["/v2.0/JobInstances"]["get"]["responses"]["200"]["content"]["application/json"];
type JobInstance = paths["/v2.0/JobInstances/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type JobInstancesByJobDefinitionList = paths["/v2.0/JobDefinitions/{jobDefinitionId}/JobInstances"]["get"]["responses"]["200"]["content"]["application/json"];
type JobInstancesByLogicalGroupList = paths["/v2.0/LogicalGroups/{logicalGroupId}/JobInstances"]["get"]["responses"]["200"]["content"]["application/json"];
type EndpointJobInstances = paths["/v2.0/Endpoints/{endpointId}/JobInstances"]["get"]["responses"]["200"]["content"]["application/json"];
type JobInstanceForCreation = paths["/v2.0/JobInstances"]["post"]["requestBody"]["content"]["application/json"];
type Folder = paths["/v2.0/Folders/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type FolderForCreation = paths["/v2.0/Folders"]["post"]["requestBody"]["content"]["application/json"];
type KioskReleasesList = paths["/v2.0/KioskReleases"]["get"]["responses"]["200"]["content"]["application/json"];
type KioskRelease = paths["/v2.0/KioskReleases/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

export interface JobsQueryParams {
  OrderBy?: string;
  SearchQuery?: string;
  Page?: number;
  PageSize?: number;
}

export class JobsModule {
  private basePath = "/jobs/v2.0";

  constructor(private client: AxiosInstance) {}

  /**
   * Get all job definitions with optional filtering and pagination
   */
  async getJobDefinitions(params?: JobsQueryParams): Promise<JobDefinitionsList> {
    const response = await this.client.get<JobDefinitionsList>(
      `${this.basePath}/JobDefinitions`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific job definition by ID
   */
  async getJobDefinition(id: string): Promise<JobDefinition> {
    const response = await this.client.get<JobDefinition>(
      `${this.basePath}/JobDefinitions/${id}`
    );
    return response.data;
  }

  /**
   * Get all job definitions contained in a specific folder
   */
  async getJobDefinitionsByFolder(
    folderId: string,
    params?: JobsQueryParams
  ): Promise<JobDefinitionsByFolderList> {
    const response = await this.client.get<JobDefinitionsByFolderList>(
      `${this.basePath}/Folders/${folderId}/JobDefinitions`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all job instances with optional filtering and pagination
   */
  async getJobInstances(params?: JobsQueryParams): Promise<JobInstancesList> {
    const response = await this.client.get<JobInstancesList>(
      `${this.basePath}/JobInstances`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific job instance by ID
   */
  async getJobInstance(id: string): Promise<JobInstance> {
    const response = await this.client.get<JobInstance>(
      `${this.basePath}/JobInstances/${id}`
    );
    return response.data;
  }

  /**
   * Get job instances for a specific endpoint
   */
  async getEndpointJobInstances(
    endpointId: string,
    params?: JobsQueryParams
  ): Promise<EndpointJobInstances> {
    const response = await this.client.get<EndpointJobInstances>(
      `${this.basePath}/Endpoints/${endpointId}/JobInstances`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all job instances for a specific job definition (deployment tracking)
   */
  async getJobInstancesByJobDefinition(
    jobDefinitionId: string,
    params?: JobsQueryParams
  ): Promise<JobInstancesByJobDefinitionList> {
    const response = await this.client.get<JobInstancesByJobDefinitionList>(
      `${this.basePath}/JobDefinitions/${jobDefinitionId}/JobInstances`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all job instances assigned to endpoints in a specific logical group
   */
  async getJobInstancesByLogicalGroup(
    logicalGroupId: string,
    params?: JobsQueryParams
  ): Promise<JobInstancesByLogicalGroupList> {
    const response = await this.client.get<JobInstancesByLogicalGroupList>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/JobInstances`,
      { params }
    );
    return response.data;
  }

  // ============================================================================
  // WRITE OPERATIONS - Phase 1 Implementation
  // ============================================================================

  /**
   * Create a job instance by assigning a job definition to an endpoint
   */
  async createJobInstance(data: JobInstanceForCreation): Promise<JobInstance> {
    const response = await this.client.post<JobInstance>(
      `${this.basePath}/JobInstances`,
      data
    );
    return response.data;
  }

  /**
   * Start a job instance by ID
   */
  async startJobInstance(id: string): Promise<void> {
    await this.client.post(
      `${this.basePath}/JobInstances/${id}/Start`
    );
  }

  /**
   * Stop a job instance by ID
   */
  async stopJobInstance(id: string): Promise<void> {
    await this.client.post(
      `${this.basePath}/JobInstances/${id}/Stop`
    );
  }

  /**
   * Resume a job instance by ID (Windows endpoints only)
   */
  async resumeJobInstance(id: string): Promise<void> {
    await this.client.post(
      `${this.basePath}/JobInstances/${id}/Resume`
    );
  }

  /**
   * Delete a job instance by ID
   */
  async deleteJobInstance(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/JobInstances/${id}`
    );
  }

  /**
   * Create a job folder
   */
  async createFolder(data: FolderForCreation): Promise<Folder> {
    const response = await this.client.post<Folder>(
      `${this.basePath}/Folders`,
      data
    );
    return response.data;
  }

  /**
   * Update a job folder by ID (uses JSON Patch format)
   */
  async updateFolder(id: string, data: any): Promise<Folder> {
    const response = await this.client.patch<Folder>(
      `${this.basePath}/Folders/${id}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a job folder by ID
   */
  async deleteFolder(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Folders/${id}`
    );
  }

  /**
   * Assign a job definition to endpoints in a logical group
   */
  async assignJobDefinitionToLogicalGroup(logicalGroupId: string, data: any): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Assign a job definition to endpoints in a static group
   */
  async assignJobDefinitionToStaticGroup(staticGroupId: string, data: any): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/StaticGroups/${staticGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Assign a job definition to endpoints in a Windows dynamic group
   */
  async assignJobDefinitionToWindowsDynamicGroup(dynamicGroupId: string, data: any): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/DynamicGroups/${dynamicGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Assign a job definition to endpoints in a universal dynamic group
   */
  async assignJobDefinitionToUniversalDynamicGroup(universalDynamicGroupId: string, data: any): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Create a kiosk release (assign job definition to target for kiosk portal execution)
   */
  async createKioskRelease(data: any): Promise<any> {
    const response = await this.client.post(
      `${this.basePath}/KioskReleases`,
      data
    );
    return response.data;
  }

  /**
   * Withdraw a kiosk release by ID
   */
  async withdrawKioskRelease(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/KioskReleases/${id}`
    );
  }

  /**
   * Get all kiosk releases with optional filtering and pagination
   *
   * Kiosk releases allow job definitions to be executed via the baramundi Kiosk portal
   * by end users or devices. This method retrieves all active kiosk releases.
   */
  async getKioskReleases(params?: JobsQueryParams): Promise<KioskReleasesList> {
    const response = await this.client.get<KioskReleasesList>(
      `${this.basePath}/KioskReleases`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific kiosk release by ID
   *
   * Retrieves detailed information about a kiosk release including the assignment
   * target, job definition, and supported platforms.
   */
  async getKioskRelease(id: string): Promise<KioskRelease> {
    const response = await this.client.get<KioskRelease>(
      `${this.basePath}/KioskReleases/${id}`
    );
    return response.data;
  }
}

