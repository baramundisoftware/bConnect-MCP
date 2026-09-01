import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/operatingsystems-types.js';
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

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

/**
 * The ONLY content type any bConnect PATCH route accepts.
 *
 * Measured 2026-08-19 across all 26R1 specs: 25 PATCH operations, every one
 * declaring `application/json-patch+json` and nothing else. axios sends
 * `application/json` when no config is passed (measured against a capturing
 * adapter), which those routes answer with 415.
 *
 * Enforced by `__tests__/suite-patch-content-type.test.ts`, which reads call-site
 * ARGUMENTS rather than grepping for this string — the string also appears in
 * generated type aliases, and counting it wrongly cleared two modules.
 */
const JSON_PATCH_REQUEST = { headers: { 'Content-Type': 'application/json-patch+json' } } as const;
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
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/Folders/${folderId}/Folders`,
          { params }
        );
        return response.data;
      },
      folderId,
      notOverloaded404(
        "Measured 2026-08-14: 1 of 1 parents answer 200 (1 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
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
    const response = await this.httpClient.patch<Folder>(`${this.basePath}/Folders/${id}`, updateData, JSON_PATCH_REQUEST);
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
    const response = await this.httpClient.patch<WindowsEndpoint>(`${this.basePath}/WindowsEndpoints/${id}`, updateData, JSON_PATCH_REQUEST);
    return response.data;
  }
}
