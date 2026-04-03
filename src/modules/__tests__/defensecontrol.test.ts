import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DefenseControlModule } from '../defensecontrol.js';
import type { AxiosInstance } from 'axios';

describe('DefenseControlModule', () => {
  let defenseControlModule: DefenseControlModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    } as any;
    defenseControlModule = new DefenseControlModule(mockClient);
  });

  describe('BitLocker', () => {
    it('should list BitLocker info for all Windows endpoints', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [{ endpointId: '1', endpointName: 'WS001' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getBitLockerWindowsEndpoints();

      expect(mockClient.get).toHaveBeenCalledWith('/defensecontrol/v2.0/BitLocker/WindowsEndpoints', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });

    it('should get BitLocker info for specific endpoint', async () => {
      const mockResponse = {
        data: { endpointId: 'endpoint-1', endpointName: 'WS001', bitLockerStatus: 'Encrypted' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getBitLockerWindowsEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith('/defensecontrol/v2.0/BitLocker/WindowsEndpoints/endpoint-1');
      expect(result.endpointId).toBe('endpoint-1');
    });
  });

  describe('Local Administrative Accounts', () => {
    it('should get local admin accounts for specific endpoint', async () => {
      const mockResponse = {
        data: { endpointId: 'endpoint-1', accounts: [] },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getLocalAdministrativeAccounts('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/endpoint-1'
      );
      expect(result.endpointId).toBe('endpoint-1');
    });

    it('should trigger update on client for local admin accounts', async () => {
      const mockResponse = { data: { success: true } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.triggerLocalAdminAccountsUpdate('endpoint-1');

      expect(mockClient.post).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/endpoint-1/TriggerUpdateOnClient'
      );
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // LOCAL ADMIN ACCOUNTS WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('triggerUpdateOnClient', () => {
    it('should trigger immediate update on client', async () => {
      const mockResponse = { data: true };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.triggerUpdateOnClient('endpoint-123');

      expect(mockClient.post).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/endpoint-123/TriggerUpdateOnClient',
        null,
        { params: {} }
      );
      expect(result).toBe(true);
    });

    it('should trigger immediate update with timeout parameter', async () => {
      const mockResponse = { data: false };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.triggerUpdateOnClient('endpoint-456', 45);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/endpoint-456/TriggerUpdateOnClient',
        null,
        { params: { timeout: 45 } }
      );
      expect(result).toBe(false);
    });
  });

  describe('patchLocalAdminUserCredentials', () => {
    it('should update local admin account expiration date', async () => {
      const updateData = [
        { op: 'replace', path: '/LocalAdminAccount/RequestedExpirationDate', value: '2025-12-31T23:59:59Z' }
      ];
      const mockResponse = {
        data: {
          endpointId: 'endpoint-789',
          localAdminAccount: {
            requestedExpirationDate: '2025-12-31T23:59:59Z'
          }
        }
      };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.patchLocalAdminUserCredentials('endpoint-789', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/endpoint-789',
        updateData
      );
      expect(result.endpointId).toBe('endpoint-789');
    });
  });

  describe('Microsoft Defender Threats', () => {
    it('should list all Microsoft Defender threats', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [{ threatId: '1', threatName: 'Trojan' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getMicrosoftDefenderThreats();

      expect(mockClient.get).toHaveBeenCalledWith('/defensecontrol/v2.0/MicrosoftDefender/Threats', {
        params: {},
      });
      expect(result.totalItems).toBe(3);
    });

    it('should get specific Microsoft Defender threat', async () => {
      const mockResponse = {
        data: { id: 'threat-1', name: 'Trojan', severity: 'High' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getMicrosoftDefenderThreat('threat-1');

      expect(mockClient.get).toHaveBeenCalledWith('/defensecontrol/v2.0/MicrosoftDefender/Threats/threat-1');
      expect(result.id).toBe('threat-1');
    });

    it('should list threats for specific endpoint', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 2,
          data: [{ threatId: '1', threatName: 'Malware' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getMicrosoftDefenderThreatsByEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/endpoint-1/Threats',
        { params: {} }
      );
      expect(result.totalItems).toBe(2);
    });

    it('should list threats for specific logical group', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 4,
          data: [{ threatId: '1', threatName: 'Spyware' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getMicrosoftDefenderThreatsByLogicalGroup('group-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/defensecontrol/v2.0/MicrosoftDefender/LogicalGroups/group-1/Threats',
        { params: {} }
      );
      expect(result.totalItems).toBe(4);
    });
  });

  describe('Microsoft Defender Endpoints', () => {
    it('should list Microsoft Defender info for all Windows endpoints', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 8,
          data: [{ endpointId: '1', endpointName: 'WS001' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getMicrosoftDefenderWindowsEndpoints();

      expect(mockClient.get).toHaveBeenCalledWith('/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints', {
        params: {},
      });
      expect(result.totalItems).toBe(8);
    });

    it('should get Microsoft Defender info for specific endpoint', async () => {
      const mockResponse = {
        data: { antimalware: { engineVersion: '4.18' }, isRealTimeProtectionActive: true },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await defenseControlModule.getMicrosoftDefenderWindowsEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith('/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/endpoint-1');
      expect(result.antimalware?.engineVersion).toBe('4.18');
    });
  });
});
