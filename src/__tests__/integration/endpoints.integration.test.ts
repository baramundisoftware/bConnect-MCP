/**
 * Integration Tests for Endpoints Module
 *
 * These tests verify the full request/response cycle using MSW to mock the API.
 * Unlike unit tests that mock the axios client, these tests make real HTTP requests
 * that are intercepted by MSW and return realistic mock data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Endpoints Module - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('getWindowsEndpoints', () => {
    it('should fetch Windows endpoints from mocked API', async () => {
      // Act
      const result = await client.endpoints.getWindowsEndpoints({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(3);
      expect(result.data![0].displayName).toBe('bms-win22srv');
      expect(result.data![0].id).toBe('98cdf559-1733-42b4-ae1f-42eabf7f9281');
    });

    it('should handle pagination parameters', async () => {
      // Act
      const result = await client.endpoints.getWindowsEndpoints({
        PageSize: 10,
        Page: 0,
      });

      // Assert - MSW returns mocked data
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });
  });

  describe('getWindowsEndpoint', () => {
    it('should fetch specific endpoint by ID', async () => {
      // Arrange
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';

      // Act
      const result = await client.endpoints.getWindowsEndpoint(endpointId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(endpointId);
      expect(result.displayName).toBe('bms-win22srv');
      expect(result.operatingSystem).toBe('Microsoft Windows Server 2022 Standard');
      expect(result.primaryIP).toBe('172.21.165.56');
    });

    it('should return 404 for non-existent endpoint', async () => {
      // Arrange
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.endpoints.getWindowsEndpoint(nonExistentId))
        .rejects.toThrow();
    });
  });

  describe('getLogicalGroups', () => {
    it('should fetch logical groups from mocked API', async () => {
      // Act
      const result = await client.endpoints.getLogicalGroups();

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('Servers');
      expect(result.data[1].name).toBe('Workstations');
    });
  });
});
