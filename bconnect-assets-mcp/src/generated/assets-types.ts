/**
 * Auto-generated types for bConnect Assets API (26R1)
 */

export interface components {
  schemas: {
    Asset: {
      assetId?: string;
      assetTypeId?: string;
      assetTypeName?: string | null;
      ownerId?: string | null;
      ownerName?: string | null;
      ownerType?: string | null;
      name?: string | null;
      comments?: string | null;
      contact?: string | null;
      inventoryNumber?: string | null;
      url?: string | null;
      costCenter?: string | null;
      purchaseDate?: string | null;
      purchasePrice?: number | null;
      operatingCost?: number | null;
      energyOff?: number | null;
      energyOn?: number | null;
      additionalProperties?: AssetProperty[] | null;
      assetReferenceList?: AssetReference[] | null;
    };
    AssetForCreation: {
      assetTypeId: string;
      ownerId: string;
      ownerType: string;
      name: string;
      comments?: string | null;
      contact?: string | null;
      inventoryNumber?: string | null;
      url?: string | null;
      costCenter?: string | null;
      purchaseDate?: string | null;
      purchasePrice?: number | null;
      operatingCost?: number | null;
      energyOff?: number | null;
      energyOn?: number | null;
      additionalProperties?: AssetPropertyForSet[] | null;
      assetReferenceList?: AssetReference[] | null;
    };
    AssetPagedList: {
      currentPage?: number;
      pageSize?: number;
      totalPages?: number;
      totalItems?: number;
      hasPreviousPage?: boolean;
      hasNextPage?: boolean;
      data?: Asset[] | null;
    };
    AssetProperty: {
      name?: string | null;
      type?: string | null;
      value?: string | null;
    };
    AssetPropertyForSet: {
      name?: string | null;
      value?: string | null;
    };
    AssetReference: {
      assetReferenceType?: string | null;
      ownerReferenceId?: string | null;
    };
    AssetStockFolder: {
      id?: string;
      name?: string | null;
      comment?: string | null;
      parentId?: string | null;
      parent?: string | null;
    };
    AssetStockFolderForCreation: {
      name: string;
      parentId?: string | null;
      comment?: string | null;
    };
    AssetStockFolderPagedList: {
      currentPage?: number;
      pageSize?: number;
      totalPages?: number;
      totalItems?: number;
      hasPreviousPage?: boolean;
      hasNextPage?: boolean;
      data?: AssetStockFolder[] | null;
    };
    AssetType: {
      guid?: string;
      name?: string | null;
      comments?: string | null;
      contact?: string | null;
      inventoryNumber?: string | null;
      url?: string | null;
      costCenter?: string | null;
      purchasePrice?: number | null;
      purchaseDate?: string | null;
      operatingCost?: number | null;
      icon?: string | null;
      energyOff?: number | null;
      energyOn?: number | null;
      additionalProperties?: AssetTypeProperty[] | null;
      summary?: AssetTypeSummary | null;
    };
    AssetTypeFolder: {
      id?: string;
      name?: string | null;
      comment?: string | null;
      parentId?: string | null;
      parent?: string | null;
    };
    AssetTypeFolderForCreation: {
      name: string;
      parentId?: string | null;
      comment?: string | null;
    };
    AssetTypeFolderPagedList: {
      currentPage?: number;
      pageSize?: number;
      totalPages?: number;
      totalItems?: number;
      hasPreviousPage?: boolean;
      hasNextPage?: boolean;
      data?: AssetTypeFolder[] | null;
    };
    AssetTypeForCreation: {
      ownerId: string;
      name: string;
      comments?: string | null;
      contact?: string | null;
      inventoryNumber?: string | null;
      url?: string | null;
      costCenter?: string | null;
      purchaseDate?: string | null;
      purchasePrice?: number | null;
      operatingCost?: number | null;
      icon?: string | null;
      energyOff?: number | null;
      energyOn?: number | null;
      additionalProperties?: AssetTypeProperty[] | null;
    };
    AssetTypePagedList: {
      currentPage?: number;
      pageSize?: number;
      totalPages?: number;
      totalItems?: number;
      hasPreviousPage?: boolean;
      hasNextPage?: boolean;
      data?: AssetType[] | null;
    };
    AssetTypeProperty: {
      name?: string | null;
      type?: string | null;
      data?: string | null;
      comments?: string | null;
    };
    AssetTypeSummary: {
      stockCount?: number;
      assetCount?: number;
      totalPurchasePrice?: number;
      totalOperatingCost?: number;
    };
    JsonPatchOperation: {
      op: string;
      path: string;
      value?: unknown;
    };
    ProblemDetails: {
      type?: string | null;
      title?: string | null;
      status?: number | null;
      detail?: string | null;
      instance?: string | null;
    };
  };
}

// Re-export for convenience
export type Asset = components['schemas']['Asset'];
export type AssetForCreation = components['schemas']['AssetForCreation'];
export type AssetPagedList = components['schemas']['AssetPagedList'];
export type AssetProperty = components['schemas']['AssetProperty'];
export type AssetPropertyForSet = components['schemas']['AssetPropertyForSet'];
export type AssetReference = components['schemas']['AssetReference'];
export type AssetStockFolder = components['schemas']['AssetStockFolder'];
export type AssetStockFolderForCreation = components['schemas']['AssetStockFolderForCreation'];
export type AssetStockFolderPagedList = components['schemas']['AssetStockFolderPagedList'];
export type AssetType = components['schemas']['AssetType'];
export type AssetTypeFolder = components['schemas']['AssetTypeFolder'];
export type AssetTypeFolderForCreation = components['schemas']['AssetTypeFolderForCreation'];
export type AssetTypeFolderPagedList = components['schemas']['AssetTypeFolderPagedList'];
export type AssetTypeForCreation = components['schemas']['AssetTypeForCreation'];
export type AssetTypePagedList = components['schemas']['AssetTypePagedList'];
export type AssetTypeProperty = components['schemas']['AssetTypeProperty'];
export type AssetTypeSummary = components['schemas']['AssetTypeSummary'];
export type JsonPatchOperation = components['schemas']['JsonPatchOperation'];
