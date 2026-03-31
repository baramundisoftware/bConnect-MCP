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
type KioskReleaseForCreation = paths["/v2.0/KioskReleases"]["post"]["requestBody"]["content"]["application/json"];
type AssignJobDefinitionRequest = paths["/v2.0/LogicalGroups/{logicalGroupId}/AssignJobDefinition"]["post"]["requestBody"]["content"]["application/json"];
type JsonPatchDocument = paths["/v2.0/Folders/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];

// Phase 26: Folder navigation
type FoldersList = paths["/v2.0/Folders"]["get"]["responses"]["200"]["content"]["application/json"];
type FolderSubfoldersList = paths["/v2.0/Folders/{folderId}/Folders"]["get"]["responses"]["200"]["content"]["application/json"];

// Phase 26: Kiosk releases by context
type KioskReleasesByJobDefinition = paths["/v2.0/JobDefinitions/{jobDefinitionId}/KioskReleases"]["get"]["responses"]["200"]["content"]["application/json"];
type KioskReleasesByEndpoint = paths["/v2.0/Endpoints/{endpointId}/KioskReleases"]["get"]["responses"]["200"]["content"]["application/json"];
type KioskReleasesByAdObject = paths["/v2.0/ADObjects/{adObjectId}/KioskReleases"]["get"]["responses"]["200"]["content"]["application/json"];
type KioskReleasesByLogicalGroup = paths["/v2.0/LogicalGroups/{logicalGroupId}/KioskReleases"]["get"]["responses"]["200"]["content"]["application/json"];

// Phase 26: Job instances by group
type JobInstancesByStaticGroup = paths["/v2.0/StaticGroups/{staticGroupId}/JobInstances"]["get"]["responses"]["200"]["content"]["application/json"];
type JobInstancesByDynamicGroup = paths["/v2.0/DynamicGroups/{dynamicGroupId}/JobInstances"]["get"]["responses"]["200"]["content"]["application/json"];

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
  async updateFolder(id: string, data: JsonPatchDocument): Promise<Folder> {
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
  async assignJobDefinitionToLogicalGroup(logicalGroupId: string, data: AssignJobDefinitionRequest): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Assign a job definition to endpoints in a static group
   */
  async assignJobDefinitionToStaticGroup(staticGroupId: string, data: AssignJobDefinitionRequest): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/StaticGroups/${staticGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Assign a job definition to endpoints in a Windows dynamic group
   */
  async assignJobDefinitionToWindowsDynamicGroup(dynamicGroupId: string, data: AssignJobDefinitionRequest): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/DynamicGroups/${dynamicGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Assign a job definition to endpoints in a universal dynamic group
   */
  async assignJobDefinitionToUniversalDynamicGroup(universalDynamicGroupId: string, data: AssignJobDefinitionRequest): Promise<JobInstance[]> {
    const response = await this.client.post<JobInstance[]>(
      `${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/AssignJobDefinition`,
      data
    );
    return response.data;
  }

  /**
   * Create a kiosk release (assign job definition to target for kiosk portal execution)
   */
  async createKioskRelease(data: KioskReleaseForCreation): Promise<KioskRelease> {
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

  // ============================================================================
  // PHASE 26 — FOLDER NAVIGATION
  // ============================================================================

  /**
   * Get all job folders (root level)
   */
  async getJobFolders(params?: JobsQueryParams): Promise<FoldersList> {
    const response = await this.client.get<FoldersList>(
      `${this.basePath}/Folders`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific job folder by ID
   */
  async getJobFolder(id: string): Promise<Folder> {
    const response = await this.client.get<Folder>(
      `${this.basePath}/Folders/${id}`
    );
    return response.data;
  }

  /**
   * Get subfolders of a specific folder
   */
  async getJobSubfolders(folderId: string, params?: JobsQueryParams): Promise<FolderSubfoldersList> {
    const response = await this.client.get<FolderSubfoldersList>(
      `${this.basePath}/Folders/${folderId}/Folders`,
      { params }
    );
    return response.data;
  }

  // ============================================================================
  // PHASE 26 — KIOSK RELEASES BY CONTEXT
  // ============================================================================

  /**
   * Get kiosk releases for a specific job definition
   */
  async getKioskReleasesByJobDefinition(jobDefinitionId: string, params?: JobsQueryParams): Promise<KioskReleasesByJobDefinition> {
    const response = await this.client.get<KioskReleasesByJobDefinition>(
      `${this.basePath}/JobDefinitions/${jobDefinitionId}/KioskReleases`,
      { params }
    );
    return response.data;
  }

  /**
   * Get kiosk releases for a specific endpoint
   */
  async getKioskReleasesByEndpoint(endpointId: string, params?: JobsQueryParams): Promise<KioskReleasesByEndpoint> {
    const response = await this.client.get<KioskReleasesByEndpoint>(
      `${this.basePath}/Endpoints/${endpointId}/KioskReleases`,
      { params }
    );
    return response.data;
  }

  /**
   * Get kiosk releases for a specific AD object
   */
  async getKioskReleasesByAdObject(adObjectId: string, params?: JobsQueryParams): Promise<KioskReleasesByAdObject> {
    const response = await this.client.get<KioskReleasesByAdObject>(
      `${this.basePath}/ADObjects/${adObjectId}/KioskReleases`,
      { params }
    );
    return response.data;
  }

  /**
   * Get kiosk releases for a specific logical group
   */
  async getKioskReleasesByLogicalGroup(logicalGroupId: string, params?: JobsQueryParams): Promise<KioskReleasesByLogicalGroup> {
    const response = await this.client.get<KioskReleasesByLogicalGroup>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/KioskReleases`,
      { params }
    );
    return response.data;
  }

  // ============================================================================
  // PHASE 26 — JOB INSTANCES BY GROUP
  // ============================================================================

  /**
   * Get job instances for a specific static group
   */
  async getJobInstancesByStaticGroup(staticGroupId: string, params?: JobsQueryParams): Promise<JobInstancesByStaticGroup> {
    const response = await this.client.get<JobInstancesByStaticGroup>(
      `${this.basePath}/StaticGroups/${staticGroupId}/JobInstances`,
      { params }
    );
    return response.data;
  }

  /**
   * Get job instances for a specific dynamic group
   */
  async getJobInstancesByDynamicGroup(dynamicGroupId: string, params?: JobsQueryParams): Promise<JobInstancesByDynamicGroup> {
    const response = await this.client.get<JobInstancesByDynamicGroup>(
      `${this.basePath}/DynamicGroups/${dynamicGroupId}/JobInstances`,
      { params }
    );
    return response.data;
  }
}

