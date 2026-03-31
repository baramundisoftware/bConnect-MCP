/**
 * bConnect Endpoints Module
 *
 * Handles endpoint (device) management operations
 */

import type { AxiosInstance } from "axios";
import type { paths } from "../generated/endpoints-types.js";

// Type aliases for cleaner code - READ operations
type EndpointsList = paths["/v2.0/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type Endpoint = paths["/v2.0/Endpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsList = paths["/v2.0/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpoint = paths["/v2.0/WindowsEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for READ operations on individual platform endpoints
type LinuxEndpoint = paths["/v2.0/LinuxEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpoint = paths["/v2.0/MacEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for group-based endpoint list operations
type EndpointsByLogicalGroupList = paths["/v2.0/LogicalGroups/{logicalGroupId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByLogicalGroupList = paths["/v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Android WRITE operations
type AndroidEndpointForCreation = paths["/v2.0/AndroidEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type AndroidEndpoint = paths["/v2.0/AndroidEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type AndroidEndpointUpdate = paths["/v2.0/AndroidEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type AndroidEnrollmentRequest = paths["/v2.0/AndroidEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];
type AndroidEnrollmentResponse = paths["/v2.0/AndroidEndpoints/{id}/StartEnrollment"]["post"]["responses"]["200"]["content"]["application/json"];

// Type aliases for iOS WRITE operations
type IosEndpointForCreation = paths["/v2.0/IosEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type IosEndpoint = paths["/v2.0/IosEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type IosEndpointUpdate = paths["/v2.0/IosEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type IosEnrollmentRequest = paths["/v2.0/IosEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];
type IosEnrollmentResponse = paths["/v2.0/IosEndpoints/{id}/StartEnrollment"]["post"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Windows Endpoint WRITE operations
type WindowsEndpointForCreation = paths["/v2.0/WindowsEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type WindowsEndpointCreated = paths["/v2.0/WindowsEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type WindowsEndpointUpdate = paths["/v2.0/WindowsEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type WindowsEndpointUpdated = paths["/v2.0/WindowsEndpoints/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];
type WindowsEnrollmentRequest = paths["/v2.0/WindowsEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];

// Type aliases for Linux Endpoint WRITE operations
type LinuxEndpointForCreation = paths["/v2.0/LinuxEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type LinuxEndpointCreated = paths["/v2.0/LinuxEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type LinuxEndpointUpdate = paths["/v2.0/LinuxEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type LinuxEndpointUpdated = paths["/v2.0/LinuxEndpoints/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Mac Endpoint WRITE operations
type MacEndpointForCreation = paths["/v2.0/MacEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type MacEndpointCreated = paths["/v2.0/MacEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type MacEndpointUpdate = paths["/v2.0/MacEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type MacEndpointUpdated = paths["/v2.0/MacEndpoints/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];
type MacEnrollmentRequest = paths["/v2.0/MacEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];

// Type aliases for LogicalGroup WRITE operations
type LogicalGroupForCreation = paths["/v2.0/LogicalGroups"]["post"]["requestBody"]["content"]["application/json"];
type LogicalGroupCreated = paths["/v2.0/LogicalGroups"]["post"]["responses"]["201"]["content"]["application/json"];
type LogicalGroupUpdate = paths["/v2.0/LogicalGroups/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type LogicalGroupUpdated = paths["/v2.0/LogicalGroups/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Maintenance Window operations - Phase 3
type MaintenanceWindowData = paths["/v2.0/Endpoints/{id}/MaintenanceWindow"]["post"]["requestBody"]["content"]["application/json"];
type MaintenanceWindow = paths["/v2.0/Endpoints/{id}/MaintenanceWindow"]["post"]["responses"]["201"]["content"]["application/json"];
type MaintenanceWindowGet = paths["/v2.0/Endpoints/{id}/MaintenanceWindow"]["get"]["responses"]["200"]["content"]["application/json"];
type MaintenanceWindowForGroupGet = paths["/v2.0/LogicalGroups/{id}/MaintenanceWindow"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Android GET operations - Phase 24
type AndroidEndpointGet = paths["/v2.0/AndroidEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type AndroidEndpointsList = paths["/v2.0/AndroidEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for iOS GET operations - Phase 24
type IosEndpointGet = paths["/v2.0/IosEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type IosEndpointsList = paths["/v2.0/IosEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Network GET operations - Phase 24
type NetworkEndpointGet = paths["/v2.0/NetworkEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type NetworkEndpointsList = paths["/v2.0/NetworkEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Industrial Endpoint WRITE operations - Phase 3
type IndustrialEndpointForCreation = paths["/v2.0/IndustrialEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type IndustrialEndpoint = paths["/v2.0/IndustrialEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type IndustrialEndpointUpdate = paths["/v2.0/IndustrialEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];

// Type aliases for Network Endpoint WRITE operations - Phase 3
type NetworkEndpointForCreation = paths["/v2.0/NetworkEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type NetworkEndpoint = paths["/v2.0/NetworkEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type NetworkEndpointUpdate = paths["/v2.0/NetworkEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];

export interface EndpointsQueryParams {
  OrderBy?: string;
  SearchQuery?: string;
  DisplayName?: string;
  Page?: number;
  PageSize?: number;
}

export class EndpointsModule {
  private basePath = "/endpoints/v2.0";

  constructor(private client: AxiosInstance) {}

  /**
   * Get all endpoints with optional filtering and pagination
   */
  async getEndpoints(params?: EndpointsQueryParams): Promise<EndpointsList> {
    const response = await this.client.get<EndpointsList>(
      `${this.basePath}/Endpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific endpoint by ID
   */
  async getEndpoint(id: string): Promise<Endpoint> {
    const response = await this.client.get<Endpoint>(
      `${this.basePath}/Endpoints/${id}`
    );
    return response.data;
  }

  /**
   * Search endpoints by query string
   * Searches across DisplayName, HostName, PrimaryIP, OSVersionString, SerialNumber, and Comment
   */
  async searchEndpoints(query: string, pageSize?: number): Promise<EndpointsList> {
    return this.getEndpoints({
      SearchQuery: query,
      PageSize: pageSize || 50
    });
  }

  /**
   * Get endpoints by display name
   */
  async getEndpointsByName(displayName: string): Promise<EndpointsList> {
    return this.getEndpoints({
      DisplayName: displayName
    });
  }

  /**
   * Get all Windows endpoints
   */
  async getWindowsEndpoints(params?: EndpointsQueryParams): Promise<WindowsEndpointsList> {
    const response = await this.client.get<WindowsEndpointsList>(
      `${this.basePath}/WindowsEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific Windows endpoint by ID
   */
  async getWindowsEndpoint(id: string): Promise<WindowsEndpoint> {
    const response = await this.client.get<WindowsEndpoint>(
      `${this.basePath}/WindowsEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get endpoints from a logical group
   */
  async getLogicalGroupEndpoints(
    logicalGroupId: string,
    params?: EndpointsQueryParams
  ): Promise<EndpointsList> {
    const response = await this.client.get<EndpointsList>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/Endpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all endpoints (any type) assigned to a specific logical group
   */
  async getEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: EndpointsQueryParams
  ): Promise<EndpointsByLogicalGroupList> {
    const response = await this.client.get<EndpointsByLogicalGroupList>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/Endpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all Windows endpoints assigned to a specific logical group
   */
  async getWindowsEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: EndpointsQueryParams
  ): Promise<WindowsEndpointsByLogicalGroupList> {
    const response = await this.client.get<WindowsEndpointsByLogicalGroupList>(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/WindowsEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all logical groups
   */
  async getLogicalGroups(): Promise<any> {
    const response = await this.client.get(
      `${this.basePath}/LogicalGroups`
    );
    return response.data;
  }

  /**
   * Get a specific logical group
   */
  async getLogicalGroup(id: string): Promise<any> {
    const response = await this.client.get(
      `${this.basePath}/LogicalGroups/${id}`
    );
    return response.data;
  }

  /**
   * Get Linux endpoints
   */
  async getLinuxEndpoints(params?: EndpointsQueryParams): Promise<any> {
    const response = await this.client.get(
      `${this.basePath}/LinuxEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific Linux endpoint by ID
   */
  async getLinuxEndpoint(id: string): Promise<LinuxEndpoint> {
    const response = await this.client.get<LinuxEndpoint>(
      `${this.basePath}/LinuxEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get Mac endpoints
   */
  async getMacEndpoints(params?: EndpointsQueryParams): Promise<any> {
    const response = await this.client.get(
      `${this.basePath}/MacEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific Mac endpoint by ID
   */
  async getMacEndpoint(id: string): Promise<MacEndpoint> {
    const response = await this.client.get<MacEndpoint>(
      `${this.basePath}/MacEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get Android endpoints
   */
  async getAndroidEndpoints(params?: EndpointsQueryParams): Promise<any> {
    const response = await this.client.get(
      `${this.basePath}/AndroidEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get iOS endpoints
   */
  async getIosEndpoints(params?: EndpointsQueryParams): Promise<any> {
    const response = await this.client.get(
      `${this.basePath}/IosEndpoints`,
      { params }
    );
    return response.data;
  }

  // WRITE OPERATIONS - Android Endpoints

  /**
   * Create a new Android endpoint
   */
  async createAndroidEndpoint(endpointData: AndroidEndpointForCreation): Promise<AndroidEndpoint> {
    const response = await this.client.post<AndroidEndpoint>(
      `${this.basePath}/AndroidEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Android endpoint
   */
  async updateAndroidEndpoint(id: string, updateData: AndroidEndpointUpdate): Promise<void> {
    await this.client.patch(
      `${this.basePath}/AndroidEndpoints/${id}`,
      updateData
    );
  }

  /**
   * Delete an Android endpoint by ID
   */
  async deleteAndroidEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/AndroidEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for an Android endpoint
   * @param id - The endpoint ID
   * @param enrollmentData - Optional enrollment data (emailRecipient, emailLanguageId)
   */
  async startAndroidEnrollment(id: string, enrollmentData?: AndroidEnrollmentRequest): Promise<AndroidEnrollmentResponse> {
    const response = await this.client.post<AndroidEnrollmentResponse>(
      `${this.basePath}/AndroidEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
    return response.data;
  }

  // WRITE OPERATIONS - iOS Endpoints

  /**
   * Create a new iOS endpoint
   */
  async createIosEndpoint(endpointData: IosEndpointForCreation): Promise<IosEndpoint> {
    const response = await this.client.post<IosEndpoint>(
      `${this.basePath}/IosEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing iOS endpoint
   */
  async updateIosEndpoint(id: string, updateData: IosEndpointUpdate): Promise<void> {
    await this.client.patch(
      `${this.basePath}/IosEndpoints/${id}`,
      updateData
    );
  }

  /**
   * Delete an iOS endpoint by ID
   */
  async deleteIosEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/IosEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for an iOS endpoint
   * @param id - The endpoint ID
   * @param enrollmentData - Optional enrollment data (emailRecipient, emailLanguageId)
   */
  async startIosEnrollment(id: string, enrollmentData?: IosEnrollmentRequest): Promise<IosEnrollmentResponse> {
    const response = await this.client.post<IosEnrollmentResponse>(
      `${this.basePath}/IosEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
    return response.data;
  }

  // ============================================================================
  // WINDOWS ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new Windows endpoint
   */
  async createWindowsEndpoint(endpointData: WindowsEndpointForCreation): Promise<WindowsEndpointCreated> {
    const response = await this.client.post<WindowsEndpointCreated>(
      `${this.basePath}/WindowsEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Windows endpoint
   */
  async updateWindowsEndpoint(id: string, updateData: WindowsEndpointUpdate): Promise<WindowsEndpointUpdated> {
    const response = await this.client.patch<WindowsEndpointUpdated>(
      `${this.basePath}/WindowsEndpoints/${id}`,
      updateData
    );
    return response.data;
  }

  /**
   * Delete a Windows endpoint by ID
   */
  async deleteWindowsEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/WindowsEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for a Windows endpoint
   */
  async startWindowsEndpointEnrollment(id: string, enrollmentData?: WindowsEnrollmentRequest): Promise<void> {
    await this.client.post(
      `${this.basePath}/WindowsEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
  }

  /**
   * Trigger installation and enrollment via Intune for a Windows endpoint
   */
  async triggerInstallationViaIntune(id: string): Promise<void> {
    await this.client.post(
      `${this.basePath}/WindowsEndpoints/${id}/TriggerInstallationViaIntune`
    );
  }

  // ============================================================================
  // LINUX ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new Linux endpoint
   */
  async createLinuxEndpoint(endpointData: LinuxEndpointForCreation): Promise<LinuxEndpointCreated> {
    const response = await this.client.post<LinuxEndpointCreated>(
      `${this.basePath}/LinuxEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Linux endpoint
   */
  async updateLinuxEndpoint(id: string, updateData: LinuxEndpointUpdate): Promise<LinuxEndpointUpdated> {
    const response = await this.client.patch<LinuxEndpointUpdated>(
      `${this.basePath}/LinuxEndpoints/${id}`,
      updateData
    );
    return response.data;
  }

  /**
   * Delete a Linux endpoint by ID
   */
  async deleteLinuxEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/LinuxEndpoints/${id}`
    );
  }

  // ============================================================================
  // MAC ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new Mac endpoint
   */
  async createMacEndpoint(endpointData: MacEndpointForCreation): Promise<MacEndpointCreated> {
    const response = await this.client.post<MacEndpointCreated>(
      `${this.basePath}/MacEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Mac endpoint
   */
  async updateMacEndpoint(id: string, updateData: MacEndpointUpdate): Promise<MacEndpointUpdated> {
    const response = await this.client.patch<MacEndpointUpdated>(
      `${this.basePath}/MacEndpoints/${id}`,
      updateData
    );
    return response.data;
  }

  /**
   * Delete a Mac endpoint by ID
   */
  async deleteMacEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/MacEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for a Mac endpoint
   */
  async startMacEndpointEnrollment(id: string, enrollmentData?: MacEnrollmentRequest): Promise<void> {
    await this.client.post(
      `${this.basePath}/MacEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
  }

  // ============================================================================
  // LOGICAL GROUP WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new logical group
   */
  async createLogicalGroup(groupData: LogicalGroupForCreation): Promise<LogicalGroupCreated> {
    const response = await this.client.post<LogicalGroupCreated>(
      `${this.basePath}/LogicalGroups`,
      groupData
    );
    return response.data;
  }

  /**
   * Update an existing logical group
   */
  async updateLogicalGroup(id: string, updateData: LogicalGroupUpdate): Promise<LogicalGroupUpdated> {
    const response = await this.client.patch<LogicalGroupUpdated>(
      `${this.basePath}/LogicalGroups/${id}`,
      updateData
    );
    return response.data;
  }

  /**
   * Delete a logical group by ID (group must be empty)
   */
  async deleteLogicalGroup(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/LogicalGroups/${id}`
    );
  }

  // ============================================================================
  // MAINTENANCE WINDOW WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Create a maintenance window for an endpoint
   */
  async createMaintenanceWindowForEndpoint(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<MaintenanceWindow> {
    const response = await this.client.post<MaintenanceWindow>(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`,
      maintenanceWindowData
    );
    return response.data;
  }

  /**
   * Update a maintenance window for an endpoint
   */
  async updateMaintenanceWindowForEndpoint(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<void> {
    await this.client.put(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`,
      maintenanceWindowData
    );
  }

  /**
   * Delete a maintenance window for an endpoint
   */
  async deleteMaintenanceWindowForEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`
    );
  }

  /**
   * Create a maintenance window for a logical group
   */
  async createMaintenanceWindowForLogicalGroup(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<MaintenanceWindow> {
    const response = await this.client.post<MaintenanceWindow>(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`,
      maintenanceWindowData
    );
    return response.data;
  }

  /**
   * Update a maintenance window for a logical group
   */
  async updateMaintenanceWindowForLogicalGroup(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<void> {
    await this.client.put(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`,
      maintenanceWindowData
    );
  }

  /**
   * Delete a maintenance window for a logical group
   */
  async deleteMaintenanceWindowForLogicalGroup(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`
    );
  }

  // ============================================================================
  // INDUSTRIAL ENDPOINT WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Create a new industrial endpoint
   */
  async createIndustrialEndpoint(endpointData: IndustrialEndpointForCreation): Promise<IndustrialEndpoint> {
    const response = await this.client.post<IndustrialEndpoint>(
      `${this.basePath}/IndustrialEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing industrial endpoint
   */
  async updateIndustrialEndpoint(id: string, updateData: IndustrialEndpointUpdate): Promise<IndustrialEndpoint> {
    const response = await this.client.patch<IndustrialEndpoint>(
      `${this.basePath}/IndustrialEndpoints/${id}`,
      updateData
    );
    return response.data;
  }

  /**
   * Delete an industrial endpoint by ID
   */
  async deleteIndustrialEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/IndustrialEndpoints/${id}`
    );
  }

  // ============================================================================
  // NETWORK ENDPOINT WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Create a new network endpoint
   */
  async createNetworkEndpoint(endpointData: NetworkEndpointForCreation): Promise<NetworkEndpoint> {
    const response = await this.client.post<NetworkEndpoint>(
      `${this.basePath}/NetworkEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing network endpoint
   */
  async updateNetworkEndpoint(id: string, updateData: NetworkEndpointUpdate): Promise<NetworkEndpoint> {
    const response = await this.client.patch<NetworkEndpoint>(
      `${this.basePath}/NetworkEndpoints/${id}`,
      updateData
    );
    return response.data;
  }

  /**
   * Delete a network endpoint by ID
   */
  async deleteNetworkEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/NetworkEndpoints/${id}`
    );
  }

  // ============================================================================
  // GENERIC ENDPOINT DELETE OPERATION - Phase 3
  // ============================================================================

  /**
   * Delete any endpoint by ID (generic delete)
   * Works for all endpoint types (Windows, Linux, Mac, Android, iOS, Industrial, Network, etc.)
   */
  async deleteEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Endpoints/${id}`
    );
  }

  // ============================================================================
  // PHASE 24 — MISSING READ OPERATIONS
  // ============================================================================

  /**
   * Get a specific Android endpoint by ID
   */
  async getAndroidEndpoint(id: string): Promise<AndroidEndpointGet> {
    const response = await this.client.get<AndroidEndpointGet>(
      `${this.basePath}/AndroidEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get a list of all Android endpoints
   */
  async listAndroidEndpoints(params?: EndpointsQueryParams): Promise<AndroidEndpointsList> {
    const response = await this.client.get<AndroidEndpointsList>(
      `${this.basePath}/AndroidEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific iOS endpoint by ID
   */
  async getIosEndpoint(id: string): Promise<IosEndpointGet> {
    const response = await this.client.get<IosEndpointGet>(
      `${this.basePath}/IosEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get a list of all iOS endpoints
   */
  async listIosEndpoints(params?: EndpointsQueryParams): Promise<IosEndpointsList> {
    const response = await this.client.get<IosEndpointsList>(
      `${this.basePath}/IosEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all network endpoints
   */
  async listNetworkEndpoints(params?: EndpointsQueryParams): Promise<NetworkEndpointsList> {
    const response = await this.client.get<NetworkEndpointsList>(
      `${this.basePath}/NetworkEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific network endpoint by ID
   */
  async getNetworkEndpoint(id: string): Promise<NetworkEndpointGet> {
    const response = await this.client.get<NetworkEndpointGet>(
      `${this.basePath}/NetworkEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get the maintenance window for a specific endpoint
   */
  async getMaintenanceWindowForEndpoint(id: string): Promise<MaintenanceWindowGet> {
    const response = await this.client.get<MaintenanceWindowGet>(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`
    );
    return response.data;
  }

  /**
   * Get the maintenance window for a logical group
   */
  async getMaintenanceWindowForLogicalGroup(id: string): Promise<MaintenanceWindowForGroupGet> {
    const response = await this.client.get<MaintenanceWindowForGroupGet>(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`
    );
    return response.data;
  }

  // ============================================================================
  // PHASE 24 — 26R1-ONLY OPERATIONS (Unmanaged Endpoints + EntraID)
  // ============================================================================

  /**
   * Get all unmanaged endpoints (26R1 only)
   */
  async listUnmanagedEndpoints(params?: EndpointsQueryParams): Promise<unknown> {
    const response = await this.client.get(
      `${this.basePath}/UnmanagedEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific unmanaged endpoint by ID (26R1 only)
   */
  async getUnmanagedEndpoint(id: string): Promise<unknown> {
    const response = await this.client.get(
      `${this.basePath}/UnmanagedEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Delete an unmanaged endpoint by ID (26R1 only)
   */
  async deleteUnmanagedEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/UnmanagedEndpoints/${id}`
    );
  }

  /**
   * Get EntraID data for a specific endpoint (26R1 only)
   */
  async getEntraIdData(endpointId: string): Promise<unknown> {
    const response = await this.client.get(
      `${this.basePath}/Endpoints/${endpointId}/EntraIdData`
    );
    return response.data;
  }

  /**
   * Link EntraID data to an endpoint (26R1 only)
   */
  async linkEntraIdData(endpointId: string, deviceId: string): Promise<unknown> {
    const response = await this.client.post(
      `${this.basePath}/Endpoints/${endpointId}/EntraIdData`,
      { deviceId }
    );
    return response.data;
  }

  /**
   * Unlink EntraID data from an endpoint (26R1 only)
   */
  async unlinkEntraIdData(endpointId: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Endpoints/${endpointId}/EntraIdData`
    );
  }
}
