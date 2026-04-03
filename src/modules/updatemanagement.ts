import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/updatemanagement-types.js';

// Type aliases
type WindowsEndpointPagedList = components['schemas']['WindowsEndpointPagedList'];
type WindowsEndpoint = components['schemas']['WindowsEndpoint'];

// Query parameter types
type GetWindowsEndpointsParams = operations['GetWindowsEndpoints']['parameters']['query'];

// Write operation types - Phase 3
type UpdateWindowsEndpointData = operations['UpdateWindowsEndpoint']['requestBody']['content']['application/json-patch+json'];

export class UpdateManagementModule {
  private basePath = '/updatemanagement/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  async getWindowsEndpoints(
    params: GetWindowsEndpointsParams = {}
  ): Promise<WindowsEndpointPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/WindowsEndpoints`,
      { params }
    );
    return response.data;
  }

  async getWindowsEndpoint(id: string): Promise<WindowsEndpoint> {
    const response = await this.httpClient.get(
      `${this.basePath}/WindowsEndpoints/${id}`
    );
    return response.data;
  }

  // ============================================================================
  // UPDATE MANAGEMENT WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Update Windows endpoint update profile (or reset to null)
   * Sets the Microsoft Update Management update profile for a Windows endpoint
   */
  async updateWindowsEndpoint(id: string, updateData: UpdateWindowsEndpointData): Promise<WindowsEndpoint> {
    const response = await this.httpClient.patch<WindowsEndpoint>(
      `${this.basePath}/WindowsEndpoints/${id}`,
      updateData
    );
    return response.data;
  }
}
