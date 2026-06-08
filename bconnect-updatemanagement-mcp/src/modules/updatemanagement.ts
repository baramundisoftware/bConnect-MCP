import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/updatemanagement-types.js';

// Type aliases
type WindowsEndpointPagedList = components['schemas']['WindowsEndpointPagedList'];
type WindowsEndpoint = components['schemas']['WindowsEndpoint'];
type JsonPatchDocument = components['schemas']['JsonPatchDocument'];

// Query parameter types
type GetWindowsEndpointsParams = operations['GetWindowsEndpoints']['parameters']['query'];

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

  async updateWindowsEndpoint(
    id: string,
    patchDoc: JsonPatchDocument
  ): Promise<WindowsEndpoint> {
    const response = await this.httpClient.patch(
      `${this.basePath}/WindowsEndpoints/${id}`,
      patchDoc,
      { headers: { 'Content-Type': 'application/json-patch+json' } }
    );
    return response.data;
  }
}
