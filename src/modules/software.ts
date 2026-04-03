import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/software-types.js';

// Type aliases
type InstalledWindowsSoftwarePagedList = components['schemas']['InstalledWindowsSoftwarePagedList'];

// Query parameter types
type GetInstalledSoftwareParams = operations['GetInstalledWindowsSoftware']['parameters']['query'];

export class SoftwareModule {
  private basePath = '/software/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  async getInstalledWindowsSoftware(
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/InstalledWindowsSoftware`,
      { params }
    );
    return response.data;
  }

  async getInstalledSoftwareByEndpoint(
    endpointId: string,
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/WindowsEndpoints/${endpointId}/InstalledWindowsSoftware`,
      { params }
    );
    return response.data;
  }

  async getInstalledSoftwareByLogicalGroup(
    logicalGroupId: string,
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/InstalledWindowsSoftware`,
      { params }
    );
    return response.data;
  }

  async getInstalledSoftwareByUniversalDynamicGroup(
    universalDynamicGroupId: string,
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/InstalledWindowsSoftware`,
      { params }
    );
    return response.data;
  }
}
