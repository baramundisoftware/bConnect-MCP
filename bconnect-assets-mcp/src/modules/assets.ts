import type { AxiosInstance } from 'axios';
import type {
  Asset,
  AssetForCreation,
  AssetPagedList,
  AssetStockFolder,
  AssetStockFolderForCreation,
  AssetStockFolderPagedList,
  AssetType,
  AssetTypeFolder,
  AssetTypeFolderForCreation,
  AssetTypeFolderPagedList,
  AssetTypeForCreation,
  AssetTypePagedList,
  JsonPatchOperation,
} from '../generated/assets-types.js';

export interface GetAssetsParams {
  OrderBy?: string;
  SearchQuery?: string;
  DisplayName?: string;
  Page?: number;
  PageSize?: number;
}

export interface GetAssetTypesParams {
  OrderBy?: string;
  SearchQuery?: string;
  ShowSummary?: boolean;
  Icon?: boolean;
  AdditionalProperties?: boolean;
  Page?: number;
  PageSize?: number;
}

export interface GetFoldersParams {
  OrderBy?: string;
  SearchQuery?: string;
  Name?: string;
  Page?: number;
  PageSize?: number;
}

export interface GetSubFoldersParams extends GetFoldersParams {
  includeSubfolders?: boolean;
}

export class AssetsModule {
  private basePath = '/assets/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // ── Assets ────────────────────────────────────────────────────────────────

  async getAssets(params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/Assets`, { params });
    return response.data;
  }

  async createAsset(data: AssetForCreation): Promise<Asset> {
    const response = await this.httpClient.post(`${this.basePath}/Assets`, data);
    return response.data;
  }

  async getAsset(id: string): Promise<Asset> {
    const response = await this.httpClient.get(`${this.basePath}/Assets/${id}`);
    return response.data;
  }

  async updateAsset(id: string, operations: JsonPatchOperation[]): Promise<Asset> {
    const response = await this.httpClient.patch(`${this.basePath}/Assets/${id}`, operations);
    return response.data;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/Assets/${id}`);
  }

  async getAssetsAssetStock(params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetStock/Assets`, { params });
    return response.data;
  }

  async getAssetsByLogicalGroup(logicalGroupId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/LogicalGroups/${logicalGroupId}/Assets`, { params });
    return response.data;
  }

  async getAssetsByOrgUnit(orgUnitId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/OrgUnits/${orgUnitId}/Assets`, { params });
    return response.data;
  }

  async getAssetsByWindowsEndpoint(endpointId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/WindowsEndpoint/${endpointId}/Assets`, { params });
    return response.data;
  }

  async getAssetsByADObject(adObjectId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/ADObjects/${adObjectId}/Assets`, { params });
    return response.data;
  }

  // ── Asset Stock Folders ───────────────────────────────────────────────────

  async getAssetStockFolders(params: GetFoldersParams = {}): Promise<AssetStockFolderPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetStock/Folders`, { params });
    return response.data;
  }

  async createAssetStockFolder(data: AssetStockFolderForCreation): Promise<AssetStockFolder> {
    const response = await this.httpClient.post(`${this.basePath}/AssetStock/Folders`, data);
    return response.data;
  }

  async getAssetStockFolder(id: string): Promise<AssetStockFolder> {
    const response = await this.httpClient.get(`${this.basePath}/AssetStock/Folders/${id}`);
    return response.data;
  }

  async updateAssetStockFolder(id: string, operations: JsonPatchOperation[]): Promise<AssetStockFolder> {
    const response = await this.httpClient.patch(`${this.basePath}/AssetStock/Folders/${id}`, operations);
    return response.data;
  }

  async deleteAssetStockFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetStock/Folders/${id}`);
  }

  async getAssetStockFoldersByParent(folderId: string, params: GetSubFoldersParams = {}): Promise<AssetStockFolderPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetStock/Folders/${folderId}/Folders`, { params });
    return response.data;
  }

  // ── Asset Type Folders ────────────────────────────────────────────────────

  async getAssetTypeFolders(params: GetFoldersParams = {}): Promise<AssetTypeFolderPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes/Folders`, { params });
    return response.data;
  }

  async createAssetTypeFolder(data: AssetTypeFolderForCreation): Promise<AssetTypeFolder> {
    const response = await this.httpClient.post(`${this.basePath}/AssetTypes/Folders`, data);
    return response.data;
  }

  async getAssetTypeFolder(id: string): Promise<AssetTypeFolder> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes/Folders/${id}`);
    return response.data;
  }

  async updateAssetTypeFolder(id: string, operations: JsonPatchOperation[]): Promise<AssetTypeFolder> {
    const response = await this.httpClient.patch(`${this.basePath}/AssetTypes/Folders/${id}`, operations);
    return response.data;
  }

  async deleteAssetTypeFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetTypes/Folders/${id}`);
  }

  async getAssetTypeFoldersByParent(folderId: string, params: GetSubFoldersParams = {}): Promise<AssetTypeFolderPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes/Folders/${folderId}/Folders`, { params });
    return response.data;
  }

  // ── Asset Types ───────────────────────────────────────────────────────────

  async getAssetTypes(params: GetAssetTypesParams = {}): Promise<AssetTypePagedList> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes`, { params });
    return response.data;
  }

  async createAssetType(data: AssetTypeForCreation): Promise<AssetType> {
    const response = await this.httpClient.post(`${this.basePath}/AssetTypes`, data);
    return response.data;
  }

  async getAssetType(id: string): Promise<AssetType> {
    const response = await this.httpClient.get(`${this.basePath}/AssetTypes/${id}`);
    return response.data;
  }

  async deleteAssetType(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetTypes/${id}`);
  }
}
