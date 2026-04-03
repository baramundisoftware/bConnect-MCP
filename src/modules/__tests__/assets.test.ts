import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetsModule } from '../assets.js';
import type { AxiosInstance } from 'axios';

describe('AssetsModule', () => {
  let assetsModule: AssetsModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as any;
    assetsModule = new AssetsModule(mockClient);
  });

  describe('getAssets', () => {
    it('should list all assets with default parameters', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          totalItems: 5,
          data: [
            { id: '1', name: 'Asset 1' },
            { id: '2', name: 'Asset 2' },
          ],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssets();

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/Assets', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });

    it('should list assets with pagination parameters', async () => {
      const mockResponse = {
        data: {
          currentPage: 2,
          pageSize: 10,
          totalPages: 3,
          totalItems: 25,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssets({ Page: 2, PageSize: 10 });

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/Assets', {
        params: { Page: 2, PageSize: 10 },
      });
      expect(result.currentPage).toBe(2);
    });
  });

  describe('getAsset', () => {
    it('should get a single asset by ID', async () => {
      const mockResponse = {
        data: {
          assetId: 'asset-123',
          name: 'Server Asset',
          assetTypeId: 'type-1',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAsset('asset-123');

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/Assets/asset-123');
      expect(result.assetId).toBe('asset-123');
      expect(result.name).toBe('Server Asset');
    });
  });

  describe('getAssetTypes', () => {
    it('should list all asset types', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [
            { id: 'type-1', name: 'Server' },
            { id: 'type-2', name: 'Desktop' },
          ],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssetTypes();

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/AssetTypes', {
        params: {},
      });
      expect(result.totalItems).toBe(3);
    });
  });

  describe('getAssetType', () => {
    it('should get a single asset type by ID', async () => {
      const mockResponse = {
        data: {
          id: 'type-1',
          name: 'Server',
          description: 'Server assets',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssetType('type-1');

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/AssetTypes/type-1');
      expect(result.name).toBe('Server');
    });
  });

  describe('getAssetsByLogicalGroup', () => {
    it('should get all assets in a logical group', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 10,
          data: [{ id: 'asset-1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssetsByLogicalGroup('group-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/assets/v2.0/LogicalGroups/group-1/Assets',
        { params: {} }
      );
      expect(result.totalItems).toBe(10);
    });
  });

  describe('getAssetsByEndpoint', () => {
    it('should get all assets assigned to an endpoint', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 2,
          data: [{ id: 'asset-1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssetsByEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/assets/v2.0/WindowsEndpoint/endpoint-1/Assets',
        { params: {} }
      );
      expect(result.totalItems).toBe(2);
    });
  });

  describe('getAssetStockAssets', () => {
    it('should list all assets in stock', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 15,
          data: [{ id: 'stock-asset-1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssetStockAssets();

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/AssetStock/Assets', {
        params: {},
      });
      expect(result.totalItems).toBe(15);
    });
  });

  describe('getAssetStockFolders', () => {
    it('should list all asset stock folders', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [{ id: 'folder-1', name: 'Main Stock' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.getAssetStockFolders();

      expect(mockClient.get).toHaveBeenCalledWith('/assets/v2.0/AssetStock/Folders', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });
  });

  // ============================================================================
  // WRITE OPERATIONS - Phase 2
  // ============================================================================

  describe('createAsset', () => {
    it('should create a new asset', async () => {
      const createData = {
        name: 'New Server',
        assetTypeId: 'type-1',
        inventoryNumber: 'INV-12345',
        ownerId: 'owner-123',
        ownerType: 'LogicalGroup' as const,
      };
      const mockResponse = {
        data: {
          assetId: 'asset-new',
          name: 'New Server',
          assetTypeId: 'type-1',
        },
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.createAsset(createData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/assets/v2.0/Assets', createData);
      expect(result.assetId).toBe('asset-new');
      expect(result.name).toBe('New Server');
    });
  });

  describe('updateAsset', () => {
    it('should update an existing asset', async () => {
      const updateData = [
        { op: 'replace', path: '/name', value: 'Updated Server' },
        { op: 'replace', path: '/contact', value: 'john@example.com' },
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.updateAsset('asset-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/assets/v2.0/Assets/asset-123',
        updateData
      );
    });
  });

  describe('deleteAsset', () => {
    it('should delete an asset by ID', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.deleteAsset('asset-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/assets/v2.0/Assets/asset-123');
    });
  });

  describe('createAssetType', () => {
    it('should create a new asset type', async () => {
      const createData = {
        name: 'Laptop',
        comments: 'Portable computers',
        ownerId: 'owner-123',
      };
      const mockResponse = {
        data: {
          guid: 'type-new',
          name: 'Laptop',
          comments: 'Portable computers',
        },
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.createAssetType(createData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/assets/v2.0/AssetTypes', createData);
      expect(result.guid).toBe('type-new');
      expect(result.name).toBe('Laptop');
    });
  });

  describe('deleteAssetType', () => {
    it('should delete an asset type by ID', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.deleteAssetType('type-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/assets/v2.0/AssetTypes/type-123');
    });
  });

  describe('createAssetStockFolder', () => {
    it('should create a new asset stock folder', async () => {
      const createData = {
        name: 'Warehouse A',
        parentFolderId: 'folder-parent',
      };
      const mockResponse = {
        data: {
          id: 'folder-new',
          name: 'Warehouse A',
        },
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.createAssetStockFolder(createData);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/assets/v2.0/AssetStock/Folders',
        createData
      );
      expect(result.id).toBe('folder-new');
      expect(result.name).toBe('Warehouse A');
    });
  });

  describe('updateAssetStockFolder', () => {
    it('should update an existing asset stock folder', async () => {
      const updateData = [
        { op: 'replace', path: '/name', value: 'Warehouse A - Updated' },
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.updateAssetStockFolder('folder-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/assets/v2.0/AssetStock/Folders/folder-123',
        updateData
      );
    });
  });

  describe('deleteAssetStockFolder', () => {
    it('should delete an asset stock folder by ID', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.deleteAssetStockFolder('folder-123');

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/assets/v2.0/AssetStock/Folders/folder-123'
      );
    });
  });

  describe('createAssetTypeFolder', () => {
    it('should create a new asset type folder', async () => {
      const createData = {
        name: 'IT Equipment',
        parentFolderId: 'folder-parent',
      };
      const mockResponse = {
        data: {
          id: 'folder-new',
          name: 'IT Equipment',
        },
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await assetsModule.createAssetTypeFolder(createData);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/assets/v2.0/AssetTypes/Folders',
        createData
      );
      expect(result.id).toBe('folder-new');
      expect(result.name).toBe('IT Equipment');
    });
  });

  describe('updateAssetTypeFolder', () => {
    it('should update an existing asset type folder', async () => {
      const updateData = [
        { op: 'replace', path: '/name', value: 'IT Equipment - Updated' },
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.updateAssetTypeFolder('folder-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/assets/v2.0/AssetTypes/Folders/folder-123',
        updateData
      );
    });
  });

  describe('deleteAssetTypeFolder', () => {
    it('should delete an asset type folder by ID', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      await assetsModule.deleteAssetTypeFolder('folder-123');

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/assets/v2.0/AssetTypes/Folders/folder-123'
      );
    });
  });
});
