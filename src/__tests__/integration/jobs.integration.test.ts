/**
 * Integration Tests for Jobs Module
 *
 * These tests verify that the Jobs module works correctly
 * with the bConnect API using MSW to mock HTTP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Jobs Module - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('Job Definitions', () => {
    it('should list all job definitions', async () => {
      // Act
      const result = await client.jobs.getJobDefinitions({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].name).toBe('Windows Update');
      expect(result.data![1].name).toBe('Software Installation');
    });

    it('should handle pagination parameters for job definitions', async () => {
      // Act
      const result = await client.jobs.getJobDefinitions({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific job definition by ID', async () => {
      // Arrange
      const jobId = 'job-123-456-789';

      // Act
      const result = await client.jobs.getJobDefinition(jobId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(jobId);
      expect(result.name).toBeDefined();
    });
  });

  describe('Job Instances', () => {
    it('should list job instances for a specific endpoint', async () => {
      // Arrange
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';

      // Act
      const result = await client.jobs.getEndpointJobInstances(endpointId, {});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].endpointId).toBe(endpointId);
      expect(result.data![0].jobDefinitionId).toBeDefined();
    });

    it('should handle empty job instance list', async () => {
      // Arrange
      const endpointId = 'endpoint-with-no-jobs';

      // Act
      const result = await client.jobs.getEndpointJobInstances(endpointId, {});

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });
  });

  describe('Job Workflows', () => {
    it('should perform complete job discovery workflow', async () => {
      // Step 1: List all job definitions
      const jobDefs = await client.jobs.getJobDefinitions({});
      expect(jobDefs.totalItems).toBeGreaterThan(0);
      expect(jobDefs.data!.length).toBeGreaterThan(0);

      // Step 2: Get first job definition details
      const firstJobId = jobDefs.data![0].id!;
      const jobDetails = await client.jobs.getJobDefinition(firstJobId);
      expect(jobDetails.id).toBe(firstJobId);
      expect(jobDetails.name).toBeDefined();

      // Step 3: List job instances for an endpoint
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';
      const jobInstances = await client.jobs.getEndpointJobInstances(endpointId, {});
      expect(jobInstances).toBeDefined();
      expect(jobInstances.data).toBeInstanceOf(Array);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors for invalid job ID', async () => {
      // Arrange
      const invalidJobId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.jobs.getJobDefinition(invalidJobId))
        .rejects.toThrow();
    });
  });

  describe('Data Validation', () => {
    it('should return job definitions with required properties', async () => {
      const result = await client.jobs.getJobDefinitions({});

      result.data!.forEach(job => {
        expect(job).toHaveProperty('id');
        expect(job).toHaveProperty('name');
        expect(job).toHaveProperty('jobType');
        expect(job).toHaveProperty('enabled');
      });
    });

    it('should return job instances with required properties', async () => {
      const endpointId = '98cdf559-1733-42b4-ae1f-42eabf7f9281';
      const result = await client.jobs.getEndpointJobInstances(endpointId, {});

      result.data!.forEach(instance => {
        expect(instance).toHaveProperty('id');
        expect(instance).toHaveProperty('jobDefinitionId');
        expect(instance).toHaveProperty('endpointId');
        expect(instance).toHaveProperty('status');
        expect(instance.endpointId).toBe(endpointId);
      });
    });
  });
});
