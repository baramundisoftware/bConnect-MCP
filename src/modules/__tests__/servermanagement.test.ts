import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServerManagementModule } from '../servermanagement.js';
import type { AxiosInstance } from 'axios';

describe('ServerManagementModule', () => {
  let serverManagementModule: ServerManagementModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as any;
    serverManagementModule = new ServerManagementModule(mockClient);
  });

  describe('Server Info', () => {
    it('should get management server info', async () => {
      const mockResponse = {
        data: { name: 'BMS Server', version: '2025.1', state: 'Running' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getManagementServer();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/ManagementServer');
      expect(result.name).toBe('BMS Server');
    });

    it('should get gateway info', async () => {
      const mockResponse = {
        data: { configurationStatus: 'Enrolled', availability: 'Up' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getGateway();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/Gateway');
      expect(result.availability).toBe('Up');
    });

    it('should get DIP status', async () => {
      const mockResponse = {
        data: [{ id: 'dip-1', hostName: 'DIP01', state: 'Idle' }],
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getDipStatus();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/Dips');
      expect(result[0].hostName).toBe('DIP01');
    });

    it('should get VPN appliance info', async () => {
      const mockResponse = {
        data: { name: 'VPN Appliance', status: 'Ok' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getVpnAppliance();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/VpnAppliance');
      expect(result.status).toBe('Ok');
    });
  });

  describe('Microservices', () => {
    it('should list all microservices', async () => {
      const mockResponse = {
        data: [
          { id: 'ms-1', name: 'Authentication Service', state: 'Running' },
          { id: 'ms-2', name: 'Job Scheduler', state: 'Running' },
        ],
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getMicroservices();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/Microservices');
      expect(result).toHaveLength(2);
    });

    it('should get specific microservice', async () => {
      const mockResponse = {
        data: { id: 'ms-1', name: 'Auth Service', state: 'Running' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getMicroservice('ms-1');

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/Microservices/ms-1');
      expect(result.id).toBe('ms-1');
    });
  });

  describe('Infrastructure Components', () => {
    it('should get all cloud connectors', async () => {
      const mockResponse = {
        data: [{ name: 'CloudConnector01', state: 'Running' }],
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getCloudConnectors();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/CloudConnectors');
      expect(result[0].name).toBe('CloudConnector01');
    });

    it('should get all PxE relays', async () => {
      const mockResponse = {
        data: [{ name: 'PxERelay01', state: 'Running' }],
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getPxeRelays();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/PxeRelays');
      expect(result[0].name).toBe('PxERelay01');
    });
  });

  describe('Security Groups', () => {
    it('should list all security groups', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [{ id: 'sg-1', groupName: 'Admins' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getSecurityGroups();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityGroups', {
        params: {},
      });
      expect(result.totalItems).toBe(3);
    });

    it('should get specific security group', async () => {
      const mockResponse = {
        data: { id: 'sg-1', groupName: 'Administrators' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getSecurityGroup('sg-1');

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityGroups/sg-1');
      expect(result.id).toBe('sg-1');
    });
  });

  describe('Security Profiles', () => {
    it('should list all security profiles', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [{ id: 'sp-1', name: 'Full Access' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getSecurityProfiles();

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityProfiles', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });

    it('should get specific security profile', async () => {
      const mockResponse = {
        data: { id: 'sp-1', name: 'Read Only', comment: 'Read-only access' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getSecurityProfile('sp-1');

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityProfiles/sp-1');
      expect(result.id).toBe('sp-1');
    });
  });

  describe('Object Permissions', () => {
    it('should get access rights for an object', async () => {
      const mockResponse = {
        data: {
          objectId: 'obj-1',
          objectName: 'Test Object',
          inheritRights: false,
          securityProfilePermissions: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.getAccessRights('obj-1');

      expect(mockClient.get).toHaveBeenCalledWith('/servermanagement/v2.0/Objects/obj-1/Rights');
      expect(result.objectId).toBe('obj-1');
    });
  });

  // ============================================================================
  // WRITE OPERATIONS - Phase 2
  // ============================================================================

  describe('restartManagementServer', () => {
    it('should trigger management server restart', async () => {
      mockClient.post = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.restartManagementServer();

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/Restart');
    });
  });

  describe('cancelScheduledRestart', () => {
    it('should cancel scheduled server restart', async () => {
      mockClient.post = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.cancelScheduledRestart();

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/CancelScheduledRestart');
    });
  });

  describe('startMicroservice', () => {
    it('should start a microservice by ID', async () => {
      mockClient.post = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.startMicroservice('ms-123');

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/Microservices/ms-123/Start');
    });
  });

  describe('stopMicroservice', () => {
    it('should stop a microservice by ID', async () => {
      mockClient.post = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.stopMicroservice('ms-123');

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/Microservices/ms-123/Stop');
    });
  });

  describe('restartMicroservice', () => {
    it('should restart a microservice by ID', async () => {
      mockClient.post = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.restartMicroservice('ms-123');

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/Microservices/ms-123/Restart');
    });
  });

  describe('createSecurityGroup', () => {
    it('should create a new security group', async () => {
      const createData = { name: 'New Group', profiles: [] };
      const mockResponse = { data: { id: 'sg-new', groupName: 'New Group' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.createSecurityGroup(createData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityGroups', createData);
      expect(result.id).toBe('sg-new');
    });
  });

  describe('updateSecurityGroup', () => {
    it('should update an existing security group', async () => {
      const updateData = [
        { op: 'replace', path: '/groupName', value: 'Updated Group' },
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.updateSecurityGroup('sg-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/servermanagement/v2.0/SecurityGroups/sg-123',
        updateData
      );
    });
  });

  describe('deleteSecurityGroup', () => {
    it('should delete a security group by ID', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.deleteSecurityGroup('sg-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityGroups/sg-123');
    });
  });

  describe('createSecurityProfile', () => {
    it('should create a new security profile', async () => {
      const createData = { name: 'New Profile', comment: 'Test profile' };
      const mockResponse = { data: { id: 'sp-new', name: 'New Profile' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await serverManagementModule.createSecurityProfile(createData);

      expect(mockClient.post).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityProfiles', createData);
      expect(result.id).toBe('sp-new');
    });
  });

  describe('updateSecurityProfile', () => {
    it('should update an existing security profile', async () => {
      const updateData = [
        { op: 'replace', path: '/name', value: 'Updated Profile' },
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.updateSecurityProfile('sp-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/servermanagement/v2.0/SecurityProfiles/sp-123',
        updateData
      );
    });
  });

  describe('deleteSecurityProfile', () => {
    it('should delete a security profile by ID', async () => {
      mockClient.delete = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.deleteSecurityProfile('sp-123');

      expect(mockClient.delete).toHaveBeenCalledWith('/servermanagement/v2.0/SecurityProfiles/sp-123');
    });
  });

  describe('updateObjectPermission', () => {
    it('should update object permission', async () => {
      const updateData = [
        { op: 'replace', path: '/inheritRights', value: true },
      ];
      mockClient.patch = vi.fn().mockResolvedValue({ data: {} });

      await serverManagementModule.updateObjectPermission('obj-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/servermanagement/v2.0/Objects/obj-123',
        updateData
      );
    });
  });
});
