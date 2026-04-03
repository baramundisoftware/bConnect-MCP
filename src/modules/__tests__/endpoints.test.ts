/**
 * Unit tests for EndpointsModule
 *
 * Phase 1: Unit tests with in-memory mocks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EndpointsModule } from '../endpoints.js';
import type { AxiosInstance } from 'axios';

describe('EndpointsModule', () => {
  let module: EndpointsModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    // Create fresh mock for each test
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as any;

    module = new EndpointsModule(mockClient);
  });

  describe('getEndpoints', () => {
    it('should fetch endpoints with pagination params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 10,
          currentPage: 0,
          pageSize: 10,
          data: [
            { id: '1', displayName: 'Endpoint 1' }
          ]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getEndpoints({ PageSize: 10, Page: 0 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints',
        { params: { PageSize: 10, Page: 0 } }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should fetch endpoints without params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 20,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getEndpoints();

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints',
        { params: undefined }
      );
    });
  });

  describe('getEndpoint', () => {
    it('should fetch specific endpoint by id', async () => {
      // Arrange
      const mockResponse = {
        data: {
          id: '123',
          displayName: 'Test Endpoint'
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getEndpoint('123');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints/123'
      );
      expect(result.id).toBe('123');
    });
  });

  describe('searchEndpoints', () => {
    it('should search with query and default page size', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 5,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.searchEndpoints('BMS');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints',
        { params: { SearchQuery: 'BMS', PageSize: 50 } }
      );
    });

    it('should search with custom page size', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 5,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.searchEndpoints('WIN', 100);

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints',
        { params: { SearchQuery: 'WIN', PageSize: 100 } }
      );
    });
  });

  describe('getEndpointsByName', () => {
    it('should fetch endpoints by display name', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 1,
          data: [{ id: '456', displayName: 'BMS-WIN22SRV' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getEndpointsByName('BMS-WIN22SRV');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints',
        { params: { DisplayName: 'BMS-WIN22SRV' } }
      );
    });
  });

  describe('getWindowsEndpoints', () => {
    it('should fetch all Windows endpoints with params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 15,
          data: [{ id: '789', displayName: 'WIN-PC-01' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getWindowsEndpoints({ PageSize: 20 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/WindowsEndpoints',
        { params: { PageSize: 20 } }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should fetch all Windows endpoints without params', async () => {
      // Arrange
      const mockResponse = {
        data: { totalItems: 15, data: [] }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getWindowsEndpoints();

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/WindowsEndpoints',
        { params: undefined }
      );
    });
  });

  describe('getWindowsEndpoint', () => {
    it('should fetch specific Windows endpoint by id', async () => {
      // Arrange
      const mockResponse = {
        data: {
          id: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
          displayName: 'BMS-WIN22SRV',
          hostName: 'BMS-WIN22SRV'
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getWindowsEndpoint('98cdf559-1733-42b4-ae1f-42eabf7f9281');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/WindowsEndpoints/98cdf559-1733-42b4-ae1f-42eabf7f9281'
      );
      expect(result.id).toBe('98cdf559-1733-42b4-ae1f-42eabf7f9281');
    });
  });

  describe('getLogicalGroupEndpoints', () => {
    it('should fetch endpoints from logical group with params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 5,
          data: [{ id: '111', displayName: 'Group-Endpoint' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getLogicalGroupEndpoints('group-123', { PageSize: 10 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/LogicalGroups/group-123/Endpoints',
        { params: { PageSize: 10 } }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should fetch endpoints from logical group without params', async () => {
      // Arrange
      const mockResponse = {
        data: { totalItems: 5, data: [] }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getLogicalGroupEndpoints('group-456');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/LogicalGroups/group-456/Endpoints',
        { params: undefined }
      );
    });
  });

  describe('getLogicalGroups', () => {
    it('should fetch all logical groups', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 3,
          data: [
            { id: 'group-1', name: 'Production' },
            { id: 'group-2', name: 'Development' }
          ]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getLogicalGroups();

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith('/endpoints/v2.0/LogicalGroups');
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getLogicalGroup', () => {
    it('should fetch specific logical group by id', async () => {
      // Arrange
      const mockResponse = {
        data: {
          id: 'group-789',
          name: 'Test Group',
          description: 'Test logical group'
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getLogicalGroup('group-789');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith('/endpoints/v2.0/LogicalGroups/group-789');
      expect(result.id).toBe('group-789');
    });
  });

  describe('getLinuxEndpoints', () => {
    it('should fetch all Linux endpoints with params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 8,
          data: [{ id: 'linux-1', displayName: 'Ubuntu-Server' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getLinuxEndpoints({ PageSize: 15 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/LinuxEndpoints',
        { params: { PageSize: 15 } }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getMacEndpoints', () => {
    it('should fetch all Mac endpoints with params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 4,
          data: [{ id: 'mac-1', displayName: 'MacBook-Pro' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getMacEndpoints({ PageSize: 10 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/MacEndpoints',
        { params: { PageSize: 10 } }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getAndroidEndpoints', () => {
    it('should fetch all Android endpoints with params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 12,
          data: [{ id: 'android-1', displayName: 'Samsung-Tablet' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getAndroidEndpoints({ PageSize: 20 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/AndroidEndpoints',
        { params: { PageSize: 20 } }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getIosEndpoints', () => {
    it('should fetch all iOS endpoints with params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 6,
          data: [{ id: 'ios-1', displayName: 'iPhone-12' }]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getIosEndpoints({ PageSize: 10 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/IosEndpoints',
        { params: { PageSize: 10 } }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  // WRITE OPERATIONS - Android Endpoints
  describe('createAndroidEndpoint', () => {
    it('should create a new Android endpoint', async () => {
      // Arrange
      const endpointData = {
        displayName: 'Test-Android-Device',
        comment: 'Test device for unit tests'
      };
      const mockResponse = {
        data: {
          id: 'android-new-123',
          displayName: 'Test-Android-Device',
          comment: 'Test device for unit tests'
        }
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.createAndroidEndpoint(endpointData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/AndroidEndpoints',
        endpointData
      );
      expect(result.id).toBe('android-new-123');
    });
  });

  describe('updateAndroidEndpoint', () => {
    it('should update an existing Android endpoint', async () => {
      // Arrange
      const endpointId = 'android-123';
      const updateData = [
        { op: 'replace', path: '/comment', value: 'Updated comment' }
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      // Act
      await module.updateAndroidEndpoint(endpointId, updateData as any);

      // Assert
      expect(mockClient.patch).toHaveBeenCalledWith(
        '/endpoints/v2.0/AndroidEndpoints/android-123',
        updateData
      );
    });
  });

  describe('deleteAndroidEndpoint', () => {
    it('should delete an Android endpoint by id', async () => {
      // Arrange
      const endpointId = 'android-456';
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      // Act
      await module.deleteAndroidEndpoint(endpointId);

      // Assert
      expect(mockClient.delete).toHaveBeenCalledWith(
        '/endpoints/v2.0/AndroidEndpoints/android-456'
      );
    });
  });

  describe('startAndroidEnrollment', () => {
    it('should start enrollment for Android endpoint with email', async () => {
      // Arrange
      const endpointId = 'android-789';
      const enrollmentData = {
        enrollmentMailAddress: 'user@example.com',
        emailLanguageId: 'en-US',
        forceMobileDataOnEnrollment: false,
        includeWifiInQrCode: true
      };
      const mockResponse = {
        data: {
          fqdn: 'bms.example.com',
          token: 'enrollment-token-123'
        }
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.startAndroidEnrollment(endpointId, enrollmentData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/AndroidEndpoints/android-789/StartEnrollment',
        enrollmentData
      );
      expect(result.token).toBe('enrollment-token-123');
    });

    it('should start enrollment for Android endpoint without email', async () => {
      // Arrange
      const endpointId = 'android-999';
      mockClient.post = vi.fn().mockResolvedValue({ data: { success: true } });

      // Act
      await module.startAndroidEnrollment(endpointId);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/AndroidEndpoints/android-999/StartEnrollment',
        undefined
      );
    });
  });

  // WRITE OPERATIONS - iOS Endpoints
  describe('createIosEndpoint', () => {
    it('should create a new iOS endpoint', async () => {
      // Arrange
      const endpointData = {
        displayName: 'Test-iOS-Device',
        comment: 'Test iPhone'
      };
      const mockResponse = {
        data: {
          id: 'ios-new-123',
          displayName: 'Test-iOS-Device'
        }
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.createIosEndpoint(endpointData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/IosEndpoints',
        endpointData
      );
      expect(result.id).toBe('ios-new-123');
    });
  });

  describe('updateIosEndpoint', () => {
    it('should update an existing iOS endpoint', async () => {
      // Arrange
      const endpointId = 'ios-456';
      const updateData = [
        { op: 'replace', path: '/comment', value: 'Updated iOS device' }
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      // Act
      await module.updateIosEndpoint(endpointId, updateData as any);

      // Assert
      expect(mockClient.patch).toHaveBeenCalledWith(
        '/endpoints/v2.0/IosEndpoints/ios-456',
        updateData
      );
    });
  });

  describe('deleteIosEndpoint', () => {
    it('should delete an iOS endpoint by id', async () => {
      // Arrange
      const endpointId = 'ios-789';
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      // Act
      await module.deleteIosEndpoint(endpointId);

      // Assert
      expect(mockClient.delete).toHaveBeenCalledWith(
        '/endpoints/v2.0/IosEndpoints/ios-789'
      );
    });
  });

  describe('startIosEnrollment', () => {
    it('should start enrollment for iOS endpoint', async () => {
      // Arrange
      const endpointId = 'ios-999';
      const enrollmentData = {
        enrollmentMailAddress: 'user@test.com',
        emailLanguageId: 'de-DE',
        forceMobileDataOnEnrollment: false,
        includeWifiInQrCode: true
      };
      const mockResponse = {
        data: {
          fqdn: 'bms.example.com',
          token: 'ios-enrollment-token'
        }
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.startIosEnrollment(endpointId, enrollmentData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/IosEndpoints/ios-999/StartEnrollment',
        enrollmentData
      );
      expect(result.token).toBe('ios-enrollment-token');
    });
  });

  // ============================================================================
  // WINDOWS ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  describe('createWindowsEndpoint', () => {
    it('should create a Windows endpoint', async () => {
      const createData = { displayName: 'WIN-PC-001', logicalGroupId: 'group-123' };
      const mockResponse = { data: { id: 'endpoint-new', displayName: 'WIN-PC-001', type: 'WindowsEndpoint' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createWindowsEndpoint(createData);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/WindowsEndpoints', createData);
      expect(result.id).toBe('endpoint-new');
      expect(result.displayName).toBe('WIN-PC-001');
    });
  });

  describe('updateWindowsEndpoint', () => {
    it('should update a Windows endpoint', async () => {
      const updateData = { displayName: 'WIN-PC-001-Updated' };
      const mockResponse = { data: { id: 'endpoint-123', displayName: 'WIN-PC-001-Updated' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.updateWindowsEndpoint('endpoint-123', updateData);

      expect(mockClient.patch).toHaveBeenCalledWith('/endpoints/v2.0/WindowsEndpoints/endpoint-123', updateData);
      expect(result.displayName).toBe('WIN-PC-001-Updated');
    });
  });

  describe('deleteWindowsEndpoint', () => {
    it('should delete a Windows endpoint', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteWindowsEndpoint('endpoint-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/WindowsEndpoints/endpoint-456');
    });
  });

  describe('startWindowsEndpointEnrollment', () => {
    it('should start Windows endpoint enrollment', async () => {
      const enrollData = { emailRecipient: 'user@example.com' };
      const mockResponse = { data: null, status: 200 };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      await module.startWindowsEndpointEnrollment('endpoint-789', enrollData);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/WindowsEndpoints/endpoint-789/StartEnrollment', enrollData);
    });
  });

  describe('triggerInstallationViaIntune', () => {
    it('should trigger installation via Intune', async () => {
      const mockResponse = { data: null, status: 200 };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      await module.triggerInstallationViaIntune('endpoint-999');

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/WindowsEndpoints/endpoint-999/TriggerInstallationViaIntune');
    });
  });

  // ============================================================================
  // LINUX ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  describe('createLinuxEndpoint', () => {
    it('should create a Linux endpoint', async () => {
      const createData = { displayName: 'LINUX-001', logicalGroupId: 'group-456' };
      const mockResponse = { data: { id: 'linux-new', displayName: 'LINUX-001', type: 'LinuxEndpoint' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createLinuxEndpoint(createData);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/LinuxEndpoints', createData);
      expect(result.id).toBe('linux-new');
    });
  });

  describe('updateLinuxEndpoint', () => {
    it('should update a Linux endpoint', async () => {
      const updateData = { displayName: 'LINUX-001-Updated' };
      const mockResponse = { data: { id: 'linux-123', displayName: 'LINUX-001-Updated' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.updateLinuxEndpoint('linux-123', updateData);

      expect(mockClient.patch).toHaveBeenCalledWith('/endpoints/v2.0/LinuxEndpoints/linux-123', updateData);
      expect(result.displayName).toBe('LINUX-001-Updated');
    });
  });

  describe('deleteLinuxEndpoint', () => {
    it('should delete a Linux endpoint', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteLinuxEndpoint('linux-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/LinuxEndpoints/linux-456');
    });
  });

  // ============================================================================
  // MAC ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  describe('createMacEndpoint', () => {
    it('should create a Mac endpoint', async () => {
      const createData = { displayName: 'MAC-001', logicalGroupId: 'group-789' };
      const mockResponse = { data: { id: 'mac-new', displayName: 'MAC-001', type: 'MacEndpoint' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createMacEndpoint(createData);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/MacEndpoints', createData);
      expect(result.id).toBe('mac-new');
    });
  });

  describe('updateMacEndpoint', () => {
    it('should update a Mac endpoint', async () => {
      const updateData = { displayName: 'MAC-001-Updated' };
      const mockResponse = { data: { id: 'mac-123', displayName: 'MAC-001-Updated' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.updateMacEndpoint('mac-123', updateData);

      expect(mockClient.patch).toHaveBeenCalledWith('/endpoints/v2.0/MacEndpoints/mac-123', updateData);
      expect(result.displayName).toBe('MAC-001-Updated');
    });
  });

  describe('deleteMacEndpoint', () => {
    it('should delete a Mac endpoint', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteMacEndpoint('mac-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/MacEndpoints/mac-456');
    });
  });

  describe('startMacEndpointEnrollment', () => {
    it('should start Mac endpoint enrollment', async () => {
      const enrollData = { emailRecipient: 'user@example.com' };
      const mockResponse = { data: null, status: 200 };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      await module.startMacEndpointEnrollment('mac-789', enrollData);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/MacEndpoints/mac-789/StartEnrollment', enrollData);
    });
  });

  // ============================================================================
  // LOGICAL GROUP WRITE OPERATIONS - Phase 1
  // ============================================================================

  describe('createLogicalGroup', () => {
    it('should create a logical group', async () => {
      const createData = { name: 'Test Group', parentId: 'parent-123' };
      const mockResponse = { data: { id: 'group-new', name: 'Test Group' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createLogicalGroup(createData);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/LogicalGroups', createData);
      expect(result.id).toBe('group-new');
      expect(result.name).toBe('Test Group');
    });
  });

  describe('updateLogicalGroup', () => {
    it('should update a logical group', async () => {
      const updateData = { name: 'Updated Group Name' };
      const mockResponse = { data: { id: 'group-123', name: 'Updated Group Name' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.updateLogicalGroup('group-123', updateData);

      expect(mockClient.patch).toHaveBeenCalledWith('/endpoints/v2.0/LogicalGroups/group-123', updateData);
      expect(result.name).toBe('Updated Group Name');
    });
  });

  describe('deleteLogicalGroup', () => {
    it('should delete a logical group', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteLogicalGroup('group-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/LogicalGroups/group-456');
    });
  });

  // ============================================================================
  // MAINTENANCE WINDOW WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('createMaintenanceWindowForEndpoint', () => {
    it('should create a maintenance window for an endpoint', async () => {
      const maintenanceWindowData = {
        maintenanceWindowDefinitionType: 'WorkdayWeekend' as const,
        intervals: [
          { maintenancePeriod: 'Workdays' as const, start: { hour: 0, minute: 0 }, end: { hour: 7, minute: 45 } }
        ]
      };
      const mockResponse = { data: maintenanceWindowData };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createMaintenanceWindowForEndpoint('endpoint-123', maintenanceWindowData as any);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints/endpoint-123/MaintenanceWindow',
        maintenanceWindowData
      );
      expect(result.maintenanceWindowDefinitionType).toBe('WorkdayWeekend');
    });
  });

  describe('updateMaintenanceWindowForEndpoint', () => {
    it('should update a maintenance window for an endpoint', async () => {
      const maintenanceWindowData = {
        maintenanceWindowDefinitionType: 'WorkdayWeekend' as const,
        intervals: [
          { maintenancePeriod: 'Workdays' as const, start: { hour: 8, minute: 0 }, end: { hour: 17, minute: 0 } }
        ]
      };
      mockClient.put = vi.fn().mockResolvedValue({ data: {} });

      await module.updateMaintenanceWindowForEndpoint('endpoint-123', maintenanceWindowData as any);

      expect(mockClient.put).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints/endpoint-123/MaintenanceWindow',
        maintenanceWindowData
      );
    });
  });

  describe('deleteMaintenanceWindowForEndpoint', () => {
    it('should delete a maintenance window for an endpoint', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {}, status: 204 });

      await module.deleteMaintenanceWindowForEndpoint('endpoint-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/Endpoints/endpoint-123/MaintenanceWindow');
    });
  });

  describe('createMaintenanceWindowForLogicalGroup', () => {
    it('should create a maintenance window for a logical group', async () => {
      const maintenanceWindowData = {
        maintenanceWindowDefinitionType: 'WorkdayWeekend' as const,
        intervals: [
          { maintenancePeriod: 'Weekends' as const, start: { hour: 0, minute: 0 }, end: { hour: 24, minute: 0 } }
        ]
      };
      const mockResponse = { data: maintenanceWindowData };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createMaintenanceWindowForLogicalGroup('group-123', maintenanceWindowData as any);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/endpoints/v2.0/LogicalGroups/group-123/MaintenanceWindow',
        maintenanceWindowData
      );
      expect(result.maintenanceWindowDefinitionType).toBe('WorkdayWeekend');
    });
  });

  describe('updateMaintenanceWindowForLogicalGroup', () => {
    it('should update a maintenance window for a logical group', async () => {
      const maintenanceWindowData = {
        maintenanceWindowDefinitionType: 'WorkdayWeekend' as const,
        intervals: [
          { maintenancePeriod: 'Workdays' as const, start: { hour: 9, minute: 0 }, end: { hour: 18, minute: 0 } }
        ]
      };
      mockClient.put = vi.fn().mockResolvedValue({ data: {} });

      await module.updateMaintenanceWindowForLogicalGroup('group-123', maintenanceWindowData as any);

      expect(mockClient.put).toHaveBeenCalledWith(
        '/endpoints/v2.0/LogicalGroups/group-123/MaintenanceWindow',
        maintenanceWindowData
      );
    });
  });

  describe('deleteMaintenanceWindowForLogicalGroup', () => {
    it('should delete a maintenance window for a logical group', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {}, status: 204 });

      await module.deleteMaintenanceWindowForLogicalGroup('group-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/LogicalGroups/group-123/MaintenanceWindow');
    });
  });

  // ============================================================================
  // INDUSTRIAL ENDPOINT WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('createIndustrialEndpoint', () => {
    it('should create an industrial endpoint', async () => {
      const createData = {
        displayName: 'Siemens-PLC-001',
        logicalGroupId: 'group-123',
        hostName: 'PLC-001',
        port: 161,
        primaryIP: '10.10.5.100',
        snmpConfiguration: {
          version: 'V3' as const,
          username: 'admin',
          authentication: 'SHA' as const,
          authenticationPassword: 'password',
          encryption: 'AES256' as const,
          encryptionPassword: 'password'
        }
      };
      const mockResponse = { data: { id: 'industrial-new', displayName: 'Siemens-PLC-001', type: 'IndustrialEndpoint' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createIndustrialEndpoint(createData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/IndustrialEndpoints', createData);
      expect(result.id).toBe('industrial-new');
    });
  });

  describe('updateIndustrialEndpoint', () => {
    it('should update an industrial endpoint', async () => {
      const updateData = [{ op: 'replace', path: '/displayName', value: 'Siemens-PLC-001-Updated' }];
      const mockResponse = { data: { id: 'industrial-123', displayName: 'Siemens-PLC-001-Updated' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.updateIndustrialEndpoint('industrial-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith('/endpoints/v2.0/IndustrialEndpoints/industrial-123', updateData);
      expect(result.displayName).toBe('Siemens-PLC-001-Updated');
    });
  });

  describe('deleteIndustrialEndpoint', () => {
    it('should delete an industrial endpoint', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteIndustrialEndpoint('industrial-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/IndustrialEndpoints/industrial-456');
    });
  });

  // ============================================================================
  // NETWORK ENDPOINT WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('createNetworkEndpoint', () => {
    it('should create a network endpoint', async () => {
      const createData = {
        displayName: 'Network-Switch-001',
        logicalGroupId: 'group-456',
        hostName: 'SW-001',
        primaryIP: '192.168.1.100'
      };
      const mockResponse = { data: { id: 'network-new', displayName: 'Network-Switch-001', type: 'NetworkEndpoint' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.createNetworkEndpoint(createData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/endpoints/v2.0/NetworkEndpoints', createData);
      expect(result.id).toBe('network-new');
    });
  });

  describe('updateNetworkEndpoint', () => {
    it('should update a network endpoint', async () => {
      const updateData = [{ op: 'replace', path: '/displayName', value: 'Network-Switch-001-Updated' }];
      const mockResponse = { data: { id: 'network-123', displayName: 'Network-Switch-001-Updated' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await module.updateNetworkEndpoint('network-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith('/endpoints/v2.0/NetworkEndpoints/network-123', updateData);
      expect(result.displayName).toBe('Network-Switch-001-Updated');
    });
  });

  describe('deleteNetworkEndpoint', () => {
    it('should delete a network endpoint', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteNetworkEndpoint('network-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/NetworkEndpoints/network-456');
    });
  });

  // ============================================================================
  // GENERIC ENDPOINT DELETE OPERATION - Phase 3
  // ============================================================================

  describe('deleteEndpoint', () => {
    it('should delete any endpoint by id (generic delete)', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await module.deleteEndpoint('endpoint-generic-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/endpoints/v2.0/Endpoints/endpoint-generic-123');
    });
  });
});
