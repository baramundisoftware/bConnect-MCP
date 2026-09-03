import type { AxiosInstance } from 'axios';
import { readSubResource, notOverloaded404 } from '@bconnect/mcp-core';
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
  // Regenerated 26R1 types name this `Operation` (the OpenAPI schema name);
  // the hand-written assets-types.ts it replaced called it JsonPatchOperation.
  Operation as JsonPatchOperation,
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

/**
 * The ONLY content type any bConnect PATCH route accepts.
 *
 * Measured 2026-08-19 across all 26R1 specs: 25 PATCH operations, every one
 * declaring `application/json-patch+json` and nothing else. This module sent no
 * content type at all, so axios defaulted to `application/json` (also measured,
 * against a capturing adapter) — which those routes answer with 415. All three
 * `update*` methods below were affected, and this module was the only one in the
 * repository making PATCH calls without it; the four others all set it.
 *
 * One constant rather than three literals: three copies is how two of them stay
 * right and the third drifts.
 */
const JSON_PATCH_REQUEST = { headers: { 'Content-Type': 'application/json-patch+json' } } as const;

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
    const response = await this.httpClient.patch(`${this.basePath}/Assets/${id}`, operations, JSON_PATCH_REQUEST);
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
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/LogicalGroups/${logicalGroupId}/Assets`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (9 with totalItems 0, 10 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAssetsByOrgUnit(orgUnitId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/OrgUnits/${orgUnitId}/Assets`, { params });
        return response.data;
      },
      orgUnitId,
      notOverloaded404(
        "Measured 2026-08-14: 133 of 133 parents answer 200 (129 with totalItems 0, 4 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAssetsByWindowsEndpoint(endpointId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/WindowsEndpoint/${endpointId}/Assets`, { params });
        return response.data;
      },
      endpointId,
      notOverloaded404(
        "Measured 2026-08-14: 23 of 23 parents answer 200 (7 with totalItems 0, 16 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAssetsByADObject(adObjectId: string, params: GetAssetsParams = {}): Promise<AssetPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/ADObjects/${adObjectId}/Assets`, { params });
        return response.data;
      },
      adObjectId,
      notOverloaded404(
        "Measured 2026-08-14: 60 of 60 parents answer 200 (59 with totalItems 0, 1 with rows); a well-formed nonexistent id answers 404."
      )
    );
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
    const response = await this.httpClient.patch(`${this.basePath}/AssetStock/Folders/${id}`, operations, JSON_PATCH_REQUEST);
    return response.data;
  }

  async deleteAssetStockFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetStock/Folders/${id}`);
  }

  async getAssetStockFoldersByParent(folderId: string, params: GetSubFoldersParams = {}): Promise<AssetStockFolderPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/AssetStock/Folders/${folderId}/Folders`, { params });
        return response.data;
      },
      folderId,
      notOverloaded404(
        "Measured 2026-08-14: 1 of 1 parents answer 200 (1 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
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
    const response = await this.httpClient.patch(`${this.basePath}/AssetTypes/Folders/${id}`, operations, JSON_PATCH_REQUEST);
    return response.data;
  }

  async deleteAssetTypeFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/AssetTypes/Folders/${id}`);
  }

  async getAssetTypeFoldersByParent(folderId: string, params: GetSubFoldersParams = {}): Promise<AssetTypeFolderPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(`${this.basePath}/AssetTypes/Folders/${folderId}/Folders`, { params });
        return response.data;
      },
      folderId,
      notOverloaded404(
        "Measured 2026-08-14: 3 of 3 parents answer 200 (2 with totalItems 0, 1 with rows); a well-formed nonexistent id answers 404."
      )
    );
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
