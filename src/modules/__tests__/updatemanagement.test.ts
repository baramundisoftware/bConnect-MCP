import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UpdateManagementModule } from '../updatemanagement.js';
import type { AxiosInstance } from 'axios';

describe('UpdateManagementModule', () => {
  let updateManagementModule: UpdateManagementModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      patch: vi.fn(),
    } as any;
    updateManagementModule = new UpdateManagementModule(mockClient);
  });

  describe('getWindowsEndpoints', () => {
    it('should list all Windows endpoints with update management info', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          totalItems: 8,
          data: [
            { id: '1', endpointName: 'WS001' },
            { id: '2', endpointName: 'WS002' },
          ],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateManagementModule.getWindowsEndpoints();

      expect(mockClient.get).toHaveBeenCalledWith('/updatemanagement/v2.0/WindowsEndpoints', {
        params: {},
      });
      expect(result.totalItems).toBe(8);
    });
  });

  describe('getWindowsEndpoint', () => {
    it('should get specific Windows endpoint update management info', async () => {
      const mockResponse = {
        data: {
          endpointId: 'endpoint-1',
          endpointName: 'WS001',
          lastInventory: '2024-01-15',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateManagementModule.getWindowsEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith('/updatemanagement/v2.0/WindowsEndpoints/endpoint-1');
      expect(result.endpointId).toBe('endpoint-1');
    });
  });

  // ============================================================================
  // UPDATE MANAGEMENT WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('updateWindowsEndpoint', () => {
    it('should update Windows endpoint update profile', async () => {
      const updateData = [
        { op: 'replace', path: '/updateProfileId', value: '671BBBED-BF25-4FAA-83FF-F5ABFDFD3F95' }
      ];
      const mockResponse = {
        data: {
          endpointId: 'endpoint-123',
          endpointName: 'WS001',
          updateProfileId: '671BBBED-BF25-4FAA-83FF-F5ABFDFD3F95',
          updateProfileName: 'Standard Updates'
        }
      };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateManagementModule.updateWindowsEndpoint('endpoint-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/updatemanagement/v2.0/WindowsEndpoints/endpoint-123',
        updateData
      );
      expect(result.updateProfileId).toBe('671BBBED-BF25-4FAA-83FF-F5ABFDFD3F95');
    });

    it('should reset Windows endpoint update profile to null', async () => {
      const updateData = [
        { op: 'replace', path: '/updateProfileId', value: null }
      ];
      const mockResponse = {
        data: {
          endpointId: 'endpoint-456',
          endpointName: 'WS002',
          updateProfileId: null,
          updateProfileName: null
        }
      };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateManagementModule.updateWindowsEndpoint('endpoint-456', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/updatemanagement/v2.0/WindowsEndpoints/endpoint-456',
        updateData
      );
      expect(result.updateProfileId).toBeNull();
    });
  });
});
