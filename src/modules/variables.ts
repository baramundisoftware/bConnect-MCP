import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/variables-types.js';

// Type aliases
type VariableDefinitionPagedList = components['schemas']['VariableDefinitionPagedList'];
type VariableDefinition = components['schemas']['VariableDefinition'];
type VariableInstancePagedList = components['schemas']['VariableInstancePagedList'];
type VariableInstance = components['schemas']['VariableInstance'];

// Query parameter types
type GetVariableDefinitionsParams = operations['GetVariableDefinitions']['parameters']['query'];
type GetVariableInstancesParams = operations['GetVariableInstances']['parameters']['query'];

// Write operation types - Phase 3
type VariableDefinitionForCreation = operations['CreateVariableDefinition']['requestBody']['content']['application/json'];
type VariableDefinitionUpdate = operations['UpdateVariableDefinition']['requestBody']['content']['application/json-patch+json'];
type VariableInstanceUpdate = operations['UpdateVariableInstance']['requestBody']['content']['application/json-patch+json'];

export class VariablesModule {
  private basePath = '/variables/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // Variable Definitions
  async getVariableDefinitions(
    params: GetVariableDefinitionsParams = {}
  ): Promise<VariableDefinitionPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/VariableDefinitions`, {
      params,
    });
    return response.data;
  }

  async getVariableDefinition(id: string): Promise<VariableDefinition> {
    const response = await this.httpClient.get(`${this.basePath}/VariableDefinitions/${id}`);
    return response.data;
  }

  // Variable Instances
  async getVariableInstances(
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/VariableInstances`, {
      params,
    });
    return response.data;
  }

  async getVariableInstance(id: string): Promise<VariableInstance> {
    const response = await this.httpClient.get(`${this.basePath}/VariableInstances/${id}`);
    return response.data;
  }

  // Variable Instances by Entity
  async getVariableInstancesByEndpoint(
    endpointId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/Endpoints/${endpointId}/VariableInstances`,
      { params }
    );
    return response.data;
  }

  async getVariableInstancesByLogicalGroup(
    logicalGroupId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/VariableInstances`,
      { params }
    );
    return response.data;
  }

  async getVariableInstancesByADObject(
    adObjectId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/ADObjects/${adObjectId}/VariableInstances`,
      { params }
    );
    return response.data;
  }

  async getVariableInstancesByWindowsApplication(
    windowsApplicationId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/WindowsApplications/${windowsApplicationId}/VariableInstances`,
      { params }
    );
    return response.data;
  }

  async getVariableInstancesByWindowsJobDefinition(
    windowsJobDefinitionId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/WindowsJobDefinitions/${windowsJobDefinitionId}/VariableInstances`,
      { params }
    );
    return response.data;
  }

  // ============================================================================
  // VARIABLES WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Create a new variable definition
   */
  async createVariableDefinition(varDefData: VariableDefinitionForCreation): Promise<VariableDefinition> {
    const response = await this.httpClient.post<VariableDefinition>(`${this.basePath}/VariableDefinitions`, varDefData);
    return response.data;
  }

  /**
   * Update a variable definition
   */
  async updateVariableDefinition(id: string, updateData: VariableDefinitionUpdate): Promise<VariableDefinition> {
    const response = await this.httpClient.patch<VariableDefinition>(`${this.basePath}/VariableDefinitions/${id}`, updateData);
    return response.data;
  }

  /**
   * Delete a variable definition by ID
   */
  async deleteVariableDefinition(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/VariableDefinitions/${id}`);
  }

  /**
   * Update a variable instance value
   */
  async updateVariableInstance(id: string, updateData: VariableInstanceUpdate): Promise<VariableInstance> {
    const response = await this.httpClient.patch<VariableInstance>(`${this.basePath}/VariableInstances/${id}`, updateData);
    return response.data;
  }
}
