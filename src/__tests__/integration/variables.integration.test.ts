/**
 * Integration Tests for Variables Module
 *
 * These tests verify that the Variables module works correctly
 * with the bConnect API using MSW to mock HTTP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Variables Module - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('Variable Definitions', () => {
    it('should list all variable definitions', async () => {
      // Act
      const result = await client.variables.getVariableDefinitions({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(3);
      expect(result.data![0].name).toBe('Department');
      expect(result.data![1].name).toBe('InstallDate');
      expect(result.data![2].name).toBe('CostCenter');
    });

    it('should handle pagination parameters for variable definitions', async () => {
      // Act
      const result = await client.variables.getVariableDefinitions({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific variable definition by ID', async () => {
      // Arrange
      const variableId = 'var-001';

      // Act
      const result = await client.variables.getVariableDefinition(variableId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(variableId);
      expect(result.name).toBe('Department');
      expect(result.type).toBe('String');
    });

    it('should return 404 for non-existent variable definition', async () => {
      // Arrange
      const invalidVariableId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.variables.getVariableDefinition(invalidVariableId))
        .rejects.toThrow();
    });
  });

  describe('Variable Instances', () => {
    it('should list variable instances for a specific endpoint', async () => {
      // Arrange
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';

      // Act
      const result = await client.variables.getVariableInstancesByEndpoint(endpointId, {});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].ownerId).toBe(endpointId);
      expect(result.data![0].name).toBe('Department');
      expect(result.data![0].value).toBe('IT');
    });

    it('should handle empty variable instance list', async () => {
      // Arrange
      const endpointId = 'endpoint-with-no-variables';

      // Act
      const result = await client.variables.getVariableInstancesByEndpoint(endpointId, {});

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });
  });

  describe('Variable Workflows', () => {
    it('should perform complete variable discovery workflow', async () => {
      // Step 1: List all variable definitions
      const variableDefs = await client.variables.getVariableDefinitions({});
      expect(variableDefs.totalItems).toBeGreaterThan(0);
      expect(variableDefs.data!.length).toBeGreaterThan(0);

      // Step 2: Get first variable definition details
      const firstVariableId = variableDefs.data![0].id!;
      const variableDetails = await client.variables.getVariableDefinition(firstVariableId);
      expect(variableDetails.id).toBe(firstVariableId);
      expect(variableDetails.name).toBeDefined();

      // Step 3: List variable instances for an endpoint
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';
      const variableInstances = await client.variables.getVariableInstancesByEndpoint(endpointId, {});
      expect(variableInstances).toBeDefined();
      expect(variableInstances.data).toBeInstanceOf(Array);
    });
  });

  describe('Data Validation', () => {
    it('should return variable definitions with required properties', async () => {
      const result = await client.variables.getVariableDefinitions({});

      result.data!.forEach(variable => {
        expect(variable).toHaveProperty('id');
        expect(variable).toHaveProperty('name');
        expect(variable).toHaveProperty('type');
        expect(variable).toHaveProperty('category');
        expect(variable).toHaveProperty('scopes');
      });
    });

    it('should return variable instances with required properties', async () => {
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';
      const result = await client.variables.getVariableInstancesByEndpoint(endpointId, {});

      result.data!.forEach(instance => {
        expect(instance).toHaveProperty('id');
        expect(instance).toHaveProperty('variableDefinitionId');
        expect(instance).toHaveProperty('name');
        expect(instance).toHaveProperty('value');
        expect(instance).toHaveProperty('ownerId');
        expect(instance.ownerId).toBe(endpointId);
      });
    });
  });
});
