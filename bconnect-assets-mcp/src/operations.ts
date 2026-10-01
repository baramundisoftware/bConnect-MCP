/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `assets` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_assets: ['GetAssets'],
  create_asset: ['CreateAsset'],
  get_asset: ['GetAsset'],
  update_asset: ['UpdateAsset'],
  delete_asset: ['DeleteAsset'],
  list_assets_in_asset_stock: ['GetAssetsAssetStock'],
  list_assets_by_logical_group: ['GetAssetsByLogicalGroup'],
  list_assets_by_windows_endpoint: ['GetAssetsByWindowsEndpoint'],
  list_asset_stock_folders: ['GetAssetStockFolders'],
  create_asset_stock_folder: ['CreateAssetStockFolder'],
  get_asset_stock_folder: ['GetAssetStockFolder'],
  update_asset_stock_folder: ['UpdateAssetStockFolder'],
  delete_asset_stock_folder: ['DeleteAssetStockFolder'],
  list_asset_stock_subfolders: ['GetAssetStockFoldersByParentId'],
  list_asset_type_folders: ['GetAssetTypeFolders'],
  create_asset_type_folder: ['CreateAssetTypeFolder'],
  get_asset_type_folder: ['GetAssetTypeFolder'],
  update_asset_type_folder: ['UpdateAssetTypeFolder'],
  delete_asset_type_folder: ['DeleteAssetTypeFolder'],
  list_asset_type_subfolders: ['GetAssetTypeFoldersByParentId'],
  list_asset_types: ['GetAssetTypes'],
  create_asset_type: ['CreateAssetType'],
  get_asset_type: ['GetAssetType'],
  delete_asset_type: ['DeleteAssetType'],
  list_assets_by_org_unit: ['GetAssetsByOrgUnit'],
  list_assets_by_ad_object: ['GetAssetsByADObject'],
};
