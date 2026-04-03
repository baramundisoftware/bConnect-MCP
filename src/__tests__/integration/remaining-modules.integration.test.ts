/**
 * Integration Tests for Remaining V2.0 Modules
 *
 * Defense Control, Operating Systems, Update Management, Software
 *
 * These tests verify that the remaining V2.0 modules work correctly
 * with the bConnect API using MSW to mock HTTP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Remaining V2.0 Modules - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('Defense Control Module', () => {
    describe('BitLocker', () => {
      it('should list BitLocker Windows endpoints', async () => {
        // Act
        const result = await client.defensecontrol.getBitLockerWindowsEndpoints({});

        // Assert
        expect(result).toBeDefined();
        expect(result.totalItems).toBe(2);
        expect(result.data).toHaveLength(2);
        expect(result.data![0].endpointName).toBe('bms-win22srv');
        expect(result.data![0].isSecureBootEnabled).toBeDefined();
      });

      it('should get specific BitLocker endpoint', async () => {
        // Arrange
        const endpointId = 'endpoint-001';

        // Act
        const result = await client.defensecontrol.getBitLockerWindowsEndpoint(endpointId);

        // Assert
        expect(result).toBeDefined();
        expect(result.endpointId).toBe(endpointId);
        expect(result.isSecureBootEnabled).toBeDefined();
        expect(result.storageMedia).toBeDefined();
        expect(result.storageMedia!.length).toBeGreaterThan(0);
      });

      it('should return 404 for non-existent BitLocker endpoint', async () => {
        // Arrange
        const invalidId = '00000000-0000-0000-0000-000000000000';

        // Act & Assert
        await expect(client.defensecontrol.getBitLockerWindowsEndpoint(invalidId))
          .rejects.toThrow();
      });
    });

    describe('Microsoft Defender', () => {
      it('should list Microsoft Defender threats', async () => {
        // Act
        const result = await client.defensecontrol.getMicrosoftDefenderThreats({});

        // Assert
        expect(result).toBeDefined();
        expect(result.totalItems).toBe(2);
        expect(result.data).toHaveLength(2);
        expect(result.data![0].name).toBe('Trojan.Generic');
        expect(result.data![0].severity).toBe('High');
      });

      it('should get specific Microsoft Defender threat', async () => {
        // Arrange
        const threatId = 'threat-001';

        // Act
        const result = await client.defensecontrol.getMicrosoftDefenderThreat(threatId);

        // Assert
        expect(result).toBeDefined();
        expect(result.id).toBe(threatId);
        expect(result.name).toBe('Trojan.Generic');
        expect(result.severity).toBe('High');
        expect(result.fileNames).toBeDefined();
      });

      it('should return 404 for non-existent threat', async () => {
        // Arrange
        const invalidId = '00000000-0000-0000-0000-000000000000';

        // Act & Assert
        await expect(client.defensecontrol.getMicrosoftDefenderThreat(invalidId))
          .rejects.toThrow();
      });

      it('should list Microsoft Defender Windows endpoints', async () => {
        // Act
        const result = await client.defensecontrol.getMicrosoftDefenderWindowsEndpoints({});

        // Assert
        expect(result).toBeDefined();
        expect(result.totalItems).toBe(2);
        expect(result.data).toHaveLength(2);
        expect(result.data![0].isMicrosoftDefenderActive).toBe(true);
        expect(result.data![0].microsoftDefenderState).toBeDefined();
      });
    });

    describe('Data Validation', () => {
      it('should return BitLocker endpoints with required properties', async () => {
        const result = await client.defensecontrol.getBitLockerWindowsEndpoints({});

        result.data!.forEach(endpoint => {
          expect(endpoint).toHaveProperty('endpointId');
          expect(endpoint).toHaveProperty('endpointName');
          expect(endpoint).toHaveProperty('isSecureBootEnabled');
          expect(endpoint).toHaveProperty('tpmData');
          expect(endpoint).toHaveProperty('storageMedia');
        });
      });

      it('should return threats with required properties', async () => {
        const result = await client.defensecontrol.getMicrosoftDefenderThreats({});

        result.data!.forEach(threat => {
          expect(threat).toHaveProperty('id');
          expect(threat).toHaveProperty('name');
          expect(threat).toHaveProperty('severity');
          expect(threat).toHaveProperty('status');
        });
      });
    });
  });

  describe('Operating Systems Module', () => {
    it('should list all Windows endpoints with OS info', async () => {
      // Act
      const result = await client.operatingsystems.getWindowsEndpoints({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.data![0].operatingSystem.name).toBe('Windows 11 Pro');
      expect(result.data![1].operatingSystem.name).toBe('Windows Server 2022');
    });

    it('should handle pagination for OS endpoints', async () => {
      // Act
      const result = await client.operatingsystems.getWindowsEndpoints({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific Windows endpoint OS info by ID', async () => {
      // Arrange
      const endpointId = 'os-001';

      // Act
      const result = await client.operatingsystems.getWindowsEndpoint(endpointId);

      // Assert
      expect(result).toBeDefined();
      expect(result.endpointId).toBe(endpointId);
      expect(result.operatingSystem).toBeDefined();
      expect(result.bootEnvironmentId).toBeDefined();
    });

    it('should return 404 for non-existent OS endpoint', async () => {
      // Arrange
      const invalidId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.operatingsystems.getWindowsEndpoint(invalidId))
        .rejects.toThrow();
    });

    it('should return OS endpoints with required properties', async () => {
      const result = await client.operatingsystems.getWindowsEndpoints({});

      result.data!.forEach(endpoint => {
        expect(endpoint).toHaveProperty('endpointId');
        expect(endpoint).toHaveProperty('endpointName');
        expect(endpoint).toHaveProperty('operatingSystem');
        expect(endpoint.operatingSystem).toHaveProperty('name');
        expect(endpoint.operatingSystem).toHaveProperty('version');
      });
    });
  });

  describe('Update Management Module', () => {
    it('should list all Windows endpoints with update info', async () => {
      // Act
      const result = await client.updatemanagement.getWindowsEndpoints({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].endpointName).toBe('bms-win22srv');
      expect(result.data![1].endpointName).toBe('WIN-CLIENT-01');
    });

    it('should handle pagination for update management endpoints', async () => {
      // Act
      const result = await client.updatemanagement.getWindowsEndpoints({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific endpoint update info by ID', async () => {
      // Arrange
      const endpointId = 'endpoint-001';

      // Act
      const result = await client.updatemanagement.getWindowsEndpoint(endpointId);

      // Assert
      expect(result).toBeDefined();
      expect(result.endpointId).toBe(endpointId);
      expect(result.endpointName).toBe('bms-win22srv');
      expect(result.missingCriticalUpdates).toBeGreaterThanOrEqual(0);
    });

    it('should return 404 for non-existent update management endpoint', async () => {
      // Arrange
      const invalidId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.updatemanagement.getWindowsEndpoint(invalidId))
        .rejects.toThrow();
    });

    it('should return update endpoints with required properties', async () => {
      const result = await client.updatemanagement.getWindowsEndpoints({});

      result.data!.forEach(endpoint => {
        expect(endpoint).toHaveProperty('endpointId');
        expect(endpoint).toHaveProperty('endpointName');
        expect(endpoint).toHaveProperty('updateProfileId');
        expect(endpoint).toHaveProperty('updateProfileName');
        expect(endpoint).toHaveProperty('missingCriticalUpdates');
        expect(endpoint).toHaveProperty('missingSecurityUpdates');
        expect(endpoint).toHaveProperty('missingOtherUpdates');
        expect(endpoint).toHaveProperty('updateDownloadMode');
        expect(endpoint).toHaveProperty('lastInventory');
        expect(endpoint).toHaveProperty('lastInventorySource');
        expect(endpoint).toHaveProperty('updateState');
      });
    });
  });

  describe('Software Module', () => {
    it('should list all installed Windows software', async () => {
      // Act
      const result = await client.software.getInstalledWindowsSoftware({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.data![0].name).toBe('Microsoft Office 2021');
      expect(result.data![1].name).toBe('Adobe Acrobat Reader');
    });

    it('should handle pagination for installed software', async () => {
      // Act
      const result = await client.software.getInstalledWindowsSoftware({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should return installed software with required properties', async () => {
      const result = await client.software.getInstalledWindowsSoftware({});

      result.data!.forEach(app => {
        expect(app).toHaveProperty('endpointId');
        expect(app).toHaveProperty('name');
        expect(app).toHaveProperty('version');
        expect(app).toHaveProperty('publisher');
      });
    });
  });
});
