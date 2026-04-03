import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperatingSystemsModule } from '../operatingsystems.js';
import type { AxiosInstance } from 'axios';

describe('OperatingSystemsModule', () => {
  let operatingSystemsModule: OperatingSystemsModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as any;
    operatingSystemsModule = new OperatingSystemsModule(mockClient);
  });

  describe('Folders', () => {
    it('should list all OS folders', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [{ id: '1', name: 'Windows 10' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.getFolders();

      expect(mockClient.get).toHaveBeenCalledWith('/operatingsystems/v2.0/Folders', {
        params: {},
      });
      expect(result.totalItems).toBe(3);
    });

    it('should get specific folder by ID', async () => {
      const mockResponse = {
        data: { id: 'folder-1', name: 'Windows 11', comment: 'Latest OS' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.getFolder('folder-1');

      expect(mockClient.get).toHaveBeenCalledWith('/operatingsystems/v2.0/Folders/folder-1');
      expect(result.id).toBe('folder-1');
    });

    it('should get folders by parent folder ID', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 2,
          data: [{ id: '2', name: 'Subfolder' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.getFoldersByFolderId('parent-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/operatingsystems/v2.0/Folders/parent-1/Folders',
        { params: {} }
      );
      expect(result.totalItems).toBe(2);
    });
  });

  describe('Windows Endpoints OS Info', () => {
    it('should list all Windows endpoints with OS install info', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [{ endpointId: '1', endpointName: 'WS001' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.getWindowsEndpoints();

      expect(mockClient.get).toHaveBeenCalledWith('/operatingsystems/v2.0/WindowsEndpoints', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });

    it('should get OS install info for specific Windows endpoint', async () => {
      const mockResponse = {
        data: {
          endpointId: 'endpoint-1',
          endpointName: 'WS001',
          isOSInstallAllowed: true,
          operatingSystem: { name: 'Windows 11 Pro' },
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.getWindowsEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith('/operatingsystems/v2.0/WindowsEndpoints/endpoint-1');
      expect(result.endpointId).toBe('endpoint-1');
    });
  });

  // ============================================================================
  // OPERATING SYSTEMS WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('createFolder', () => {
    it('should create a new OS folder', async () => {
      const folderData = { name: 'Windows Server 2025', parentId: 'parent-123', comment: 'Latest server OS' };
      const mockResponse = { data: { id: 'folder-new', name: 'Windows Server 2025', parentId: 'parent-123' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.createFolder(folderData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/operatingsystems/v2.0/Folders', folderData);
      expect(result.id).toBe('folder-new');
      expect(result.name).toBe('Windows Server 2025');
    });
  });

  describe('updateFolder', () => {
    it('should update an OS folder', async () => {
      const updateData = [{ op: 'replace', path: '/name', value: 'Windows Server 2025 Updated' }];
      const mockResponse = { data: { id: 'folder-123', name: 'Windows Server 2025 Updated' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.updateFolder('folder-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith('/operatingsystems/v2.0/Folders/folder-123', updateData);
      expect(result.name).toBe('Windows Server 2025 Updated');
    });
  });

  describe('deleteFolder', () => {
    it('should delete an OS folder', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await operatingSystemsModule.deleteFolder('folder-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/operatingsystems/v2.0/Folders/folder-456');
    });
  });

  describe('updateWindowsEndpoint', () => {
    it('should update Windows endpoint OS install configuration', async () => {
      const updateData = [
        { op: 'replace', path: '/isOSInstallAllowed', value: true },
        { op: 'replace', path: '/bootEnvironmentId', value: '671BBBED-BF25-4FAA-83FF-F5ABFDFD3F95' }
      ];
      const mockResponse = {
        data: {
          endpointId: 'endpoint-789',
          endpointName: 'WS001',
          isOSInstallAllowed: true,
          bootEnvironmentId: '671BBBED-BF25-4FAA-83FF-F5ABFDFD3F95'
        }
      };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await operatingSystemsModule.updateWindowsEndpoint('endpoint-789', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith('/operatingsystems/v2.0/WindowsEndpoints/endpoint-789', updateData);
      expect(result.isOSInstallAllowed).toBe(true);
    });
  });
});
