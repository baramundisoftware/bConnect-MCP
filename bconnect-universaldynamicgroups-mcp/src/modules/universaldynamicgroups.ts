import type { AxiosInstance } from 'axios';
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
