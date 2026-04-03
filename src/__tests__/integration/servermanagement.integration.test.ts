/**
 * Integration Tests for Server Management Module
 *
 * These tests verify that the Server Management module works correctly
 * with the bConnect API using MSW to mock HTTP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Server Management Module - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('Server Information', () => {
    it('should get management server information', async () => {
      // Act
      const result = await client.servermanagement.getManagementServer();

      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBe('bms-win22srv');
      expect(result.version).toBe('25.2.29.0');
      expect(result.state).toBe('Running');
    });

    it('should get gateway information', async () => {
      // Act
      const result = await client.servermanagement.getGateway();

      // Assert
      expect(result).toBeDefined();
      expect(result.configurationStatus).toBeDefined();
      expect(result.availability).toBeDefined();
      expect(result.lastContact).toBeDefined();
    });

    it('should get DIP status', async () => {
      // Act
      const result = await client.servermanagement.getDipStatus();

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].hostName).toBeDefined();
    });

    it('should get VPN appliance information', async () => {
      // Act
      const result = await client.servermanagement.getVpnAppliance();

      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBe('VPN Appliance');
      expect(result.isActive).toBe(true);
    });
  });

  describe('Microservices', () => {
    it('should list all microservices', async () => {
      // Act
      const result = await client.servermanagement.getMicroservices();

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Inventory Service');
      expect(result[0].state).toBe('Running');
      expect(result[1].name).toBe('Deployment Service');
    });

    it('should get specific microservice by ID', async () => {
      // Arrange
      const microId = 'micro-001';

      // Act
      const result = await client.servermanagement.getMicroservice(microId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Inventory Service');
      expect(result.state).toBe('Running');
      expect(result.message).toBeDefined();
    });

    it('should return 404 for non-existent microservice', async () => {
      // Arrange
      const invalidMicroId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.servermanagement.getMicroservice(invalidMicroId))
        .rejects.toThrow();
    });
  });

  describe('Infrastructure Components', () => {
    it('should list cloud connectors', async () => {
      // Act
      const result = await client.servermanagement.getCloudConnectors();

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBeDefined();
    });

    it('should list PXE relays', async () => {
      // Act
      const result = await client.servermanagement.getPxeRelays();

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].hostName).toBeDefined();
    });
  });

  describe('Security Groups', () => {
    it('should list all security groups', async () => {
      // Act
      const result = await client.servermanagement.getSecurityGroups({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].groupName).toBe('Administrators');
      expect(result.data![1].groupName).toBe('Operators');
    });

    it('should handle pagination for security groups', async () => {
      // Act
      const result = await client.servermanagement.getSecurityGroups({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific security group by ID', async () => {
      // Arrange
      const groupId = 'secgroup-001';

      // Act
      const result = await client.servermanagement.getSecurityGroup(groupId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(groupId);
      expect(result.groupName).toBe('Administrators');
      expect(result.assignedSecurityProfiles).toBeDefined();
    });

    it('should return 404 for non-existent security group', async () => {
      // Arrange
      const invalidGroupId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.servermanagement.getSecurityGroup(invalidGroupId))
        .rejects.toThrow();
    });
  });

  describe('Security Profiles', () => {
    it('should list all security profiles', async () => {
      // Act
      const result = await client.servermanagement.getSecurityProfiles({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].name).toBe('Full Access Profile');
      expect(result.data![1].name).toBe('Read Only Profile');
    });

    it('should handle pagination for security profiles', async () => {
      // Act
      const result = await client.servermanagement.getSecurityProfiles({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific security profile by ID', async () => {
      // Arrange
      const profileId = 'profile-001';

      // Act
      const result = await client.servermanagement.getSecurityProfile(profileId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(profileId);
      expect(result.name).toBe('Full Access Profile');
      expect(result.comment).toBeDefined();
    });

    it('should return 404 for non-existent security profile', async () => {
      // Arrange
      const invalidProfileId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.servermanagement.getSecurityProfile(invalidProfileId))
        .rejects.toThrow();
    });
  });

  describe('Server Management Workflows', () => {
    it('should perform complete server discovery workflow', async () => {
      // Step 1: Get management server info
      const server = await client.servermanagement.getManagementServer();
      expect(server.name).toBeDefined();

      // Step 2: Get gateway info
      const gateway = await client.servermanagement.getGateway();
      expect(gateway.configurationStatus).toBeDefined();

      // Step 3: List microservices
      const microservices = await client.servermanagement.getMicroservices();
      expect(microservices.length).toBeGreaterThan(0);

      // Step 4: List security groups
      const securityGroups = await client.servermanagement.getSecurityGroups({});
      expect(securityGroups.totalItems).toBeGreaterThan(0);
    });
  });

  describe('Data Validation', () => {
    it('should return security groups with required properties', async () => {
      const result = await client.servermanagement.getSecurityGroups({});

      result.data!.forEach(group => {
        expect(group).toHaveProperty('id');
        expect(group).toHaveProperty('groupName');
        expect(group).toHaveProperty('assignedSecurityProfiles');
      });
    });

    it('should return security profiles with required properties', async () => {
      const result = await client.servermanagement.getSecurityProfiles({});

      result.data!.forEach(profile => {
        expect(profile).toHaveProperty('id');
        expect(profile).toHaveProperty('name');
        expect(profile).toHaveProperty('comment');
        expect(profile).toHaveProperty('displayAdministratorIdentities');
        expect(profile).toHaveProperty('displayEndpointUserIdentities');
      });
    });

    it('should return microservices with required properties', async () => {
      const result = await client.servermanagement.getMicroservices();

      result.forEach(micro => {
        expect(micro).toHaveProperty('id');
        expect(micro).toHaveProperty('name');
        expect(micro).toHaveProperty('state');
        expect(micro).toHaveProperty('message');
      });
    });
  });
});
