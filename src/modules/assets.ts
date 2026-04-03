import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/assets-types.js';

// Type aliases for easier use - READ operations
type AssetPagedList = components['schemas']['AssetPagedList'];
type Asset = components['schemas']['Asset'];
type AssetTypePagedList = components['schemas']['AssetTypePagedList'];
type AssetType = components['schemas']['AssetType'];
type AssetStockFolderPagedList = components['schemas']['AssetStockFolderPagedList'];

// Query parameter types
type GetAssetsParams = operations['GetAssets']['parameters']['query'];
type GetAssetTypesParams = operations['GetAssetTypes']['parameters']['query'];
type GetAssetStockFoldersParams = operations['GetAssetStockFolders']['parameters']['query'];

// Type aliases for WRITE operations - Phase 2
type AssetForCreation = operations['CreateAsset']['requestBody']['content']['application/json'];
type AssetForUpdate = operations['UpdateAsset']['requestBody']['content']['application/json-patch+json'];
type AssetTypeForCreation = operations['CreateAssetType']['requestBody']['content']['application/json'];
type AssetStockFolderForCreation = operations['CreateAssetStockFolder']['requestBody']['content']['application/json'];
type AssetStockFolderForUpdate = operations['UpdateAssetStockFolder']['requestBody']['content']['application/json-patch+json'];
type AssetTypeFolderForCreation = operations['CreateAssetTypeFolder']['requestBody']['content']['application/json'];
type AssetTypeFolderForUpdate = operations['UpdateAssetTypeFolder']['requestBody']['content']['application/json-patch+json'];

export class AssetsModule {
  private basePath = '/assets/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  async getAssets(params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/Assets`, {
      params,
    });
    return response.data;
  }

  async getAsset(id: string): Promise<Asset> {
    const response = await this.httpClient.get(`${this.basePath}/Assets/${id}`);
    return response.data;
  }

  async getAssetTypes(params: GetAssetTypesParams = {}): Promise<AssetTypePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes`, {
      params,
    });
    return response.data;
  }

  async getAssetType(id: string): Promise<AssetType> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes/${id}`);
    return response.data;
  }

  async getAssetsByLogicalGroup(
    logicalGroupId: string,
    params: GetAssetsParams = {}
  ): Promise<AssetPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/LogicalGroups/${logicalGroupId}/Assets`,
      { params }
    );
    return response.data;
  }

  async getAssetsByEndpoint(
    endpointId: string,
    params: GetAssetsParams = {}
  ): Promise<AssetPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/WindowsEndpoint/${endpointId}/Assets`,
      { params }
    );
    return response.data;
  }

  async getAssetStockAssets(params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetStock/Assets`, {
      params,
    });
    return response.data;
  }

  async getAssetStockFolders(
    params: GetAssetStockFoldersParams = {}
  ): Promise<AssetStockFolderPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetStock/Folders`, {
      params,
    });
    return response.data;
  }

  // ============================================================================
  // WRITE OPERATIONS - Phase 2
  // ============================================================================

  /**
   * Create a new asset
   */
  async createAsset(data: AssetForCreation): Promise<Asset> {
    const response = await this.httpClient.post<Asset>(`${this.basePath}/Assets`, data);
    return response.data;
  }

  /**
   * Update an existing asset
   */
  async updateAsset(id: string, data: AssetForUpdate): Promise<void> {
    await this.httpClient.patch(`${this.basePath}/Assets/${id}`, data);
  }

  /**
   * Delete an asset by ID
   */
  async deleteAsset(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/Assets/${id}`);
  }

  /**
   * Create a new asset type
   */
  async createAssetType(data: AssetTypeForCreation): Promise<AssetType> {
    const response = await this.httpClient.post<AssetType>(
      `${this.basePath}/AssetTypes`,
      data
    );
    return response.data;
  }

  /**
   * Delete an asset type by ID
   */
  async deleteAssetType(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetTypes/${id}`);
  }

  /**
   * Create a new asset stock folder
   */
  async createAssetStockFolder(data: AssetStockFolderForCreation): Promise<any> {
    const response = await this.httpClient.post(
      `${this.basePath}/AssetStock/Folders`,
      data
    );
    return response.data;
  }

  /**
   * Update an existing asset stock folder
   */
  async updateAssetStockFolder(id: string, data: AssetStockFolderForUpdate): Promise<void> {
    await this.httpClient.patch(`${this.basePath}/AssetStock/Folders/${id}`, data);
  }

  /**
   * Delete an asset stock folder by ID
   */
  async deleteAssetStockFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetStock/Folders/${id}`);
  }

  /**
   * Create a new asset type folder
   */
  async createAssetTypeFolder(data: AssetTypeFolderForCreation): Promise<any> {
    const response = await this.httpClient.post(
      `${this.basePath}/AssetTypes/Folders`,
      data
    );
    return response.data;
  }

  /**
   * Update an existing asset type folder
   */
  async updateAssetTypeFolder(id: string, data: AssetTypeFolderForUpdate): Promise<void> {
    await this.httpClient.patch(`${this.basePath}/AssetTypes/Folders/${id}`, data);
  }

  /**
   * Delete an asset type folder by ID
   */
  async deleteAssetTypeFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetTypes/Folders/${id}`);
  }
}
