import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActiveDirectoryModule } from '../activedirectory.js';
import type { AxiosInstance } from 'axios';

describe('ActiveDirectoryModule', () => {
  let adModule: ActiveDirectoryModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
    } as any;
    adModule = new ActiveDirectoryModule(mockClient);
  });

  describe('getADGroups', () => {
    it('should list all AD groups', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [
            { id: 'group-1', name: 'Domain Admins' },
            { id: 'group-2', name: 'Domain Users' },
          ],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADGroups();

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/ADGroups', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });
  });

  describe('getADGroup', () => {
    it('should get a single AD group by ID', async () => {
      const mockResponse = {
        data: {
          id: 'group-1',
          name: 'Domain Admins',
          distinguishedName: 'CN=Domain Admins,CN=Users,DC=domain,DC=local',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADGroup('group-1');

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/ADGroups/group-1');
      expect(result.id).toBe('group-1');
      expect(result.name).toBe('Domain Admins');
    });
  });

  describe('getADUsers', () => {
    it('should list all AD users', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 10,
          data: [{ id: 'user-1', name: 'Administrator' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADUsers();

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/ADUsers', {
        params: {},
      });
      expect(result.totalItems).toBe(10);
    });
  });

  describe('getADUser', () => {
    it('should get a single AD user by ID', async () => {
      const mockResponse = {
        data: {
          id: 'user-1',
          name: 'Administrator',
          distinguishedName: 'CN=Administrator,CN=Users,DC=domain,DC=local',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADUser('user-1');

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/ADUsers/user-1');
      expect(result.id).toBe('user-1');
      expect(result.name).toBe('Administrator');
    });
  });

  describe('getADObjects', () => {
    it('should list all AD objects', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 15,
          data: [{ id: 'obj-1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADObjects();

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/ADObjects', {
        params: {},
      });
      expect(result.totalItems).toBe(15);
    });
  });

  describe('getADObject', () => {
    it('should get a single AD object by ID', async () => {
      const mockResponse = {
        data: {
          id: 'obj-1',
          name: 'Computer1',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADObject('obj-1');

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/ADObjects/obj-1');
      expect(result.id).toBe('obj-1');
    });
  });

  describe('getOrgUnits', () => {
    it('should list all organizational units', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [{ id: 'ou-1', name: 'Finance' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getOrgUnits();

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/OrgUnits', {
        params: {},
      });
      expect(result.totalItems).toBe(3);
    });
  });

  describe('getOrgUnit', () => {
    it('should get a single organizational unit by ID', async () => {
      const mockResponse = {
        data: {
          id: 'ou-1',
          name: 'Finance',
          distinguishedName: 'OU=Finance,DC=domain,DC=local',
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getOrgUnit('ou-1');

      expect(mockClient.get).toHaveBeenCalledWith('/activedirectory/v2.0/OrgUnits/ou-1');
      expect(result.id).toBe('ou-1');
      expect(result.name).toBe('Finance');
    });
  });

  describe('getADUsersByGroup', () => {
    it('should get all users in an AD group', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [{ id: 'user-1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADUsersByGroup('group-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/activedirectory/v2.0/ADGroups/group-1/ADUsers',
        { params: {} }
      );
      expect(result.totalItems).toBe(5);
    });
  });

  describe('getADGroupsByOrgUnit', () => {
    it('should get all groups in an organizational unit', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [{ id: 'group-1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await adModule.getADGroupsByOrgUnit('ou-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/activedirectory/v2.0/OrgUnits/ou-1/ADGroups',
        { params: {} }
      );
      expect(result.totalItems).toBe(3);
    });
  });
});
