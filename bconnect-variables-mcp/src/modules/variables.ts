import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/variables-types.js';
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

// Type aliases
type VariableDefinitionPagedList = components['schemas']['VariableDefinitionPagedList'];
type VariableDefinition = components['schemas']['VariableDefinition'];
type VariableInstancePagedList = components['schemas']['VariableInstancePagedList'];
type VariableInstance = components['schemas']['VariableInstance'];

// Query parameter types
type GetVariableDefinitionsParams = operations['GetVariableDefinitions']['parameters']['query'];
type GetVariableInstancesParams = operations['GetVariableInstances']['parameters']['query'];

// Write operation types
type VariableDefinitionForCreation = operations['CreateVariableDefinition']['requestBody']['content']['application/json'];
type VariableDefinitionUpdate = operations['UpdateVariableDefinition']['requestBody']['content']['application/json-patch+json'];
type VariableInstanceUpdate = operations['UpdateVariableInstance']['requestBody']['content']['application/json-patch+json'];

/**
 * The ONLY content type any bConnect PATCH route accepts.
 *
 * Measured 2026-08-19 across all 26R1 specs: 25 PATCH operations, every one
 * declaring `application/json-patch+json` and nothing else. Both `update*`
 * methods below sent no content type, so axios defaulted to `application/json`
 * (measured against a capturing adapter) — which those routes answer with 415.
 *
 * This module LOOKED correct to two earlier checks, and the way it fooled them
 * is the point: it mentions `application/json-patch+json` twice, in the
 * `operations[...]['content'][...]` TYPE aliases above. A grep for the string
 * counted those as header settings. The signal that actually distinguishes a
 * bare PATCH is the ARGUMENT COUNT at the call site — two arguments means no
 * config object was passed at all.
 */
const JSON_PATCH_REQUEST = { headers: { 'Content-Type': 'application/json-patch+json' } } as const;

export class VariablesModule {
  private basePath = '/variables/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // ── Variable Definitions ─────────────────────────────────────────────────

  async getVariableDefinitions(
    params: GetVariableDefinitionsParams = {}
  ): Promise<VariableDefinitionPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/VariableDefinitions`, { params });
    return response.data;
  }

  async getVariableDefinition(id: string): Promise<VariableDefinition> {
    const response = await this.httpClient.get(`${this.basePath}/VariableDefinitions/${id}`);
    return response.data;
  }

  async createVariableDefinition(body: VariableDefinitionForCreation): Promise<VariableDefinition> {
    const response = await this.httpClient.post(`${this.basePath}/VariableDefinitions`, body);
    return response.data;
  }

  async updateVariableDefinition(id: string, patchDoc: VariableDefinitionUpdate): Promise<VariableDefinition> {
    const response = await this.httpClient.patch(`${this.basePath}/VariableDefinitions/${id}`, patchDoc, JSON_PATCH_REQUEST);
    return response.data;
  }

  async deleteVariableDefinition(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/VariableDefinitions/${id}`);
  }

  // ── Variable Instances ───────────────────────────────────────────────────

  async getVariableInstances(
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/VariableInstances`, { params });
    return response.data;
  }

  async getVariableInstance(id: string): Promise<VariableInstance> {
    const response = await this.httpClient.get(`${this.basePath}/VariableInstances/${id}`);
    return response.data;
  }

  async getVariableInstancesByEndpoint(
    endpointId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/Endpoints/${endpointId}/VariableInstances`,
          { params }
        );
        return response.data;
      },
      endpointId,
      notOverloaded404(
        "Measured 2026-08-14: 26 of 26 parents answer 200 (3 with totalItems 0, 23 with rows); a well-formed nonexistent id answers 404."
      )
    );
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

  async getVariableInstancesByWindowsJobDefinition(
    windowsJobDefinitionId: string,
    params: GetVariableInstancesParams = {}
  ): Promise<VariableInstancePagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/WindowsJobDefinitions/${windowsJobDefinitionId}/VariableInstances`,
          { params }
        );
        return response.data;
      },
      windowsJobDefinitionId,
      notOverloaded404(
        "Measured 2026-08-14: 170 of 170 parents answer 200 (10 with totalItems 0, 160 with rows); a well-formed nonexistent id answers 404."
      )
    );
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

  async updateVariableInstance(id: string, patchDoc: VariableInstanceUpdate): Promise<VariableInstance> {
    const response = await this.httpClient.patch(`${this.basePath}/VariableInstances/${id}`, patchDoc, JSON_PATCH_REQUEST);
    return response.data;
  }
}
