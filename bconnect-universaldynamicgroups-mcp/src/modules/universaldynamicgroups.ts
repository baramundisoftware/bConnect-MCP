import type { AxiosInstance } from 'axios';
import type { JsonPatchOperation } from '@bconnect/mcp-core';
import type { components, operations } from '../generated/universaldynamicgroups-types.js';

// Type aliases
type UniversalDynamicGroupPagedList = components['schemas']['UniversalDynamicGroupPagedList'];
type UniversalDynamicGroup = components['schemas']['UniversalDynamicGroup'];
type FolderPagedList = components['schemas']['FolderPagedList'];
type Folder = components['schemas']['Folder'];

// Query parameter types
type GetUDGsParams = operations['GetUniversalDynamicGroups']['parameters']['query'];
type GetFoldersParams = operations['GetFolders']['parameters']['query'];
type GetFoldersByFolderIdParams = operations['GetFoldersByFolderId']['parameters']['query'];

export class UniversalDynamicGroupsModule {
  private basePath = '/universaldynamicgroups/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  async getUniversalDynamicGroups(
    params: GetUDGsParams = {}
  ): Promise<UniversalDynamicGroupPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/UniversalDynamicGroups`,
      { params }
    );
    return response.data;
  }

  async getUniversalDynamicGroup(id: string): Promise<UniversalDynamicGroup> {
    const response = await this.httpClient.get(
      `${this.basePath}/UniversalDynamicGroups/${id}`
    );
    return response.data;
  }

  async getUniversalDynamicGroupsByFolder(
    folderId: string,
    params: GetUDGsParams = {}
  ): Promise<UniversalDynamicGroupPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/Folders/${folderId}/UniversalDynamicGroups`,
      { params }
    );
    return response.data;
  }

  async getFolders(
    params: GetFoldersParams = {}
  ): Promise<FolderPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/UniversalDynamicGroupsFolder`,
      { params }
    );
    return response.data;
  }

  async getFolder(id: string): Promise<Folder> {
    const response = await this.httpClient.get(
      `${this.basePath}/UniversalDynamicGroupsFolder/${id}`
    );
    return response.data;
  }

  // ── Thresholds (26R2, #354): not in the generated 26R1 types, so typed by their use ──

  /** GET /Thresholds: every threshold (paged). */
  async getThresholds(params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.httpClient.get(`${this.basePath}/Thresholds`, { params });
    return response.data;
  }

  /** GET /UniversalDynamicGroups/{dynamicGroupId}/Thresholds: one group's thresholds (paged). */
  async getThresholdsForGroup(dynamicGroupId: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.httpClient.get(`${this.basePath}/UniversalDynamicGroups/${dynamicGroupId}/Thresholds`, { params });
    return response.data;
  }

  /** GET /Thresholds/{id}. */
  async getThreshold(id: string): Promise<unknown> {
    const response = await this.httpClient.get(`${this.basePath}/Thresholds/${id}`);
    return response.data;
  }

  /** POST /Thresholds (26R2, #355): answers with the created threshold. */
  async createThreshold(body: Record<string, unknown>): Promise<unknown> {
    const response = await this.httpClient.post(`${this.basePath}/Thresholds`, body);
    return response.data;
  }

  /** PATCH /Thresholds/{id} (JSON Patch, 26R2, #355): answers with the changed threshold. */
  async updateThreshold(id: string, patch: JsonPatchOperation[]): Promise<unknown> {
    const response = await this.httpClient.patch(`${this.basePath}/Thresholds/${id}`, patch);
    return response.data;
  }

  /** DELETE /Thresholds/{id} (26R2, #355): 204, no content. */
  async deleteThreshold(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/Thresholds/${id}`);
  }

  async getFoldersByFolder(
    folderId: string,
    params: GetFoldersByFolderIdParams = {}
  ): Promise<FolderPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/UniversalDynamicGroupsFolder/${folderId}/Folders`,
      { params }
    );
    return response.data;
  }
}
