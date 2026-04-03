import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/operatingsystems-types.js';

// Type aliases
type FolderPagedList = components['schemas']['FolderPagedList'];
type Folder = components['schemas']['Folder'];
type WindowsEndpointPagedList = components['schemas']['WindowsEndpointPagedList'];
type WindowsEndpoint = components['schemas']['WindowsEndpoint'];

// Query parameter types
type GetFoldersParams = operations['GetFolders']['parameters']['query'];
type GetFoldersByFolderIdParams = operations['GetFoldersByFolderId']['parameters']['query'];
type GetWindowsEndpointsParams = operations['GetWindowsEndpoints']['parameters']['query'];

// Write operation types - Phase 3
type FolderForCreation = components['schemas']['FolderForCreation'];
type FolderUpdate = operations['UpdateFolder']['requestBody']['content']['application/json-patch+json'];
type WindowsEndpointUpdate = operations['UpdateWindowsEndpoint']['requestBody']['content']['application/json-patch+json'];

export class OperatingSystemsModule {
  private basePath = '/operatingsystems/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // Folders
  async getFolders(params: GetFoldersParams = {}): Promise<FolderPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/Folders`, {
      params,
    });
    return response.data;
  }

  async getFolder(id: string): Promise<Folder> {
    const response = await this.httpClient.get(`${this.basePath}/Folders/${id}`);
    return response.data;
  }

  async getFoldersByFolderId(
    folderId: string,
    params: GetFoldersByFolderIdParams = {}
  ): Promise<FolderPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/Folders/${folderId}/Folders`,
      { params }
    );
    return response.data;
  }

  // Windows Endpoints OS Installation Info
  async getWindowsEndpoints(
    params: GetWindowsEndpointsParams = {}
  ): Promise<WindowsEndpointPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/WindowsEndpoints`, {
      params,
    });
    return response.data;
  }

  async getWindowsEndpoint(id: string): Promise<WindowsEndpoint> {
    const response = await this.httpClient.get(`${this.basePath}/WindowsEndpoints/${id}`);
    return response.data;
  }

  // ============================================================================
  // OPERATING SYSTEMS WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Create a new OS folder
   */
  async createFolder(folderData: FolderForCreation): Promise<Folder> {
    const response = await this.httpClient.post<Folder>(`${this.basePath}/Folders`, folderData);
    return response.data;
  }

  /**
   * Update an OS folder
   */
  async updateFolder(id: string, updateData: FolderUpdate): Promise<Folder> {
    const response = await this.httpClient.patch<Folder>(`${this.basePath}/Folders/${id}`, updateData);
    return response.data;
  }

  /**
   * Delete an OS folder by ID (folder must be empty)
   */
  async deleteFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/Folders/${id}`);
  }

  /**
   * Update Windows endpoint OS install configuration
   */
  async updateWindowsEndpoint(id: string, updateData: WindowsEndpointUpdate): Promise<WindowsEndpoint> {
    const response = await this.httpClient.patch<WindowsEndpoint>(`${this.basePath}/WindowsEndpoints/${id}`, updateData);
    return response.data;
  }
}
