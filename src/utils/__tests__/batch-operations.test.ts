/**
 * Batch Operations Tests
 *
 * Comprehensive unit tests for batch operations functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BatchOperations,
  createBatchOperations,
  getSuccessfulResults,
  getFailedResults,
} from '../batch-operations.js';

describe('BatchOperations', () => {
  describe('Basic Batch Execution', () => {
    it('should execute all operations successfully', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const mockOperation = vi.fn((input: number) => Promise.resolve(input * 2));

      const operations = createBatchOperations([1, 2, 3, 4, 5], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.results).toHaveLength(5);
      expect(result.summary.succeeded).toBe(5);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.successRate).toBe(1);
      expect(mockOperation).toHaveBeenCalledTimes(5);
    });

    it('should return correct results', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const mockOperation = (input: number) => Promise.resolve(input * 2);

      const operations = createBatchOperations([1, 2, 3], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.results[0].result).toBe(2);
      expect(result.results[1].result).toBe(4);
      expect(result.results[2].result).toBe(6);
    });
  });

  describe('Concurrency Control', () => {
    it('should respect concurrency limit', async () => {
      // Arrange
      const concurrency = 2;
      const batchOps = new BatchOperations({ concurrency });

      let activeCount = 0;
      let maxActiveCount = 0;

      const mockOperation = async (input: number) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise(resolve => setTimeout(resolve, 50));
        activeCount--;
        return input * 2;
      };

      const operations = createBatchOperations([1, 2, 3, 4, 5], mockOperation);

      // Act
      await batchOps.execute(operations);

      // Assert
      expect(maxActiveCount).toBeLessThanOrEqual(concurrency);
    });

    it('should execute operations in batches', async () => {
      // Arrange
      const batchOps = new BatchOperations({ concurrency: 2 });
      const executionOrder: number[] = [];

      const mockOperation = async (input: number) => {
        executionOrder.push(input);
        await new Promise(resolve => setTimeout(resolve, 10));
        return input;
      };

      const operations = createBatchOperations([1, 2, 3, 4], mockOperation);

      // Act
      await batchOps.execute(operations);

      // Assert
      expect(executionOrder).toHaveLength(4);
      // First 2 operations start immediately
      expect(executionOrder.slice(0, 2)).toEqual(expect.arrayContaining([1, 2]));
    });
  });

  describe('Error Handling', () => {
    it('should handle errors and continue by default', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const mockOperation = (input: number) => {
        if (input === 2) {
          return Promise.reject(new Error('Operation failed'));
        }
        return Promise.resolve(input * 2);
      };

      const operations = createBatchOperations([1, 2, 3], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.summary.succeeded).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.successRate).toBeCloseTo(0.666, 2);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error?.message).toBe('Operation failed');
    });

    it('should stop on error when stopOnError is true', async () => {
      // Arrange
      const batchOps = new BatchOperations({ stopOnError: true, concurrency: 1 });
      const mockOperation = vi.fn((input: number) => {
        if (input === 2) {
          return Promise.reject(new Error('Operation failed'));
        }
        return Promise.resolve(input * 2);
      });

      const operations = createBatchOperations([1, 2, 3, 4, 5], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.summary.failed).toBeGreaterThan(0);
      expect(mockOperation).not.toHaveBeenCalledTimes(5); // Should stop early
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed operations', async () => {
      // Arrange
      const batchOps = new BatchOperations({ retries: 2, retryDelay: 10 });
      let attemptCount = 0;

      const mockOperation = (input: number) => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve(input * 2);
      };

      const operations = createBatchOperations([1], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.summary.succeeded).toBe(1);
      expect(result.results[0].attempts).toBe(3); // Initial + 2 retries
      expect(attemptCount).toBe(3);
    });

    it('should fail after exhausting retries', async () => {
      // Arrange
      const batchOps = new BatchOperations({ retries: 2, retryDelay: 10 });
      const mockOperation = () => Promise.reject(new Error('Persistent failure'));

      const operations = createBatchOperations([1], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.summary.failed).toBe(1);
      expect(result.results[0].attempts).toBe(3); // Initial + 2 retries
      expect(result.results[0].error?.message).toBe('Persistent failure');
    });
  });

  describe('Progress Tracking', () => {
    it('should call progress callback', async () => {
      // Arrange
      const progressCallback = vi.fn();
      const batchOps = new BatchOperations({ onProgress: progressCallback });
      const mockOperation = (input: number) => Promise.resolve(input * 2);

      const operations = createBatchOperations([1, 2, 3], mockOperation);

      // Act
      await batchOps.execute(operations);

      // Assert
      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenCalledWith({
        total: 3,
        completed: 1,
        succeeded: 1,
        failed: 0,
        percentage: expect.closeTo(33.33, 1),
      });
    });

    it('should track progress with failures', async () => {
      // Arrange
      const progressUpdates: any[] = [];
      const batchOps = new BatchOperations({
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      });

      const mockOperation = (input: number) => {
        if (input === 2) {
          return Promise.reject(new Error('Failed'));
        }
        return Promise.resolve(input * 2);
      };

      const operations = createBatchOperations([1, 2, 3], mockOperation);

      // Act
      await batchOps.execute(operations);

      // Assert
      expect(progressUpdates).toHaveLength(3);
      expect(progressUpdates[2]).toEqual({
        total: 3,
        completed: 3,
        succeeded: 2,
        failed: 1,
        percentage: 100,
      });
    });
  });

  describe('Helper Functions', () => {
    it('should create batch operations from inputs', () => {
      // Arrange
      const inputs = [1, 2, 3];
      const operation = (input: number) => Promise.resolve(input * 2);

      // Act
      const operations = createBatchOperations(inputs, operation, 'test');

      // Assert
      expect(operations).toHaveLength(3);
      expect(operations[0].id).toBe('test-0');
      expect(operations[1].id).toBe('test-1');
      expect(operations[2].id).toBe('test-2');
      expect(operations[0].input).toBe(1);
    });

    it('should filter successful results', () => {
      // Arrange
      const results = [
        { id: '1', input: 1, result: 2, success: true, attempts: 1 },
        { id: '2', input: 2, error: new Error('Failed'), success: false, attempts: 1 },
        { id: '3', input: 3, result: 6, success: true, attempts: 1 },
      ];

      // Act
      const successful = getSuccessfulResults(results);

      // Assert
      expect(successful).toHaveLength(2);
      expect(successful[0].result).toBe(2);
      expect(successful[1].result).toBe(6);
    });

    it('should filter failed results', () => {
      // Arrange
      const results = [
        { id: '1', input: 1, result: 2, success: true, attempts: 1 },
        { id: '2', input: 2, error: new Error('Failed'), success: false, attempts: 1 },
        { id: '3', input: 3, result: 6, success: true, attempts: 1 },
      ];

      // Act
      const failed = getFailedResults(results);

      // Assert
      expect(failed).toHaveLength(1);
      expect(failed[0].error.message).toBe('Failed');
    });
  });

  describe('Configuration', () => {
    it('should return configuration via getConfig()', () => {
      // Arrange
      const batchOps = new BatchOperations({
        concurrency: 10,
        stopOnError: true,
        retries: 3,
        retryDelay: 2000,
      });

      // Act
      const config = batchOps.getConfig();

      // Assert
      expect(config.concurrency).toBe(10);
      expect(config.stopOnError).toBe(true);
      expect(config.retries).toBe(3);
      expect(config.retryDelay).toBe(2000);
    });

    it('should use default values when not provided', () => {
      // Arrange
      const batchOps = new BatchOperations({});

      // Act
      const config = batchOps.getConfig();

      // Assert
      expect(config.concurrency).toBe(5);
      expect(config.stopOnError).toBe(false);
      expect(config.retries).toBe(0);
      expect(config.retryDelay).toBe(1000);
    });
  });

  describe('Performance', () => {
    it('should execute operations in parallel', async () => {
      // Arrange
      const batchOps = new BatchOperations({ concurrency: 5 });
      const startTime = Date.now();

      const mockOperation = async (input: number) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return input * 2;
      };

      const operations = createBatchOperations([1, 2, 3, 4, 5], mockOperation);

      // Act
      await batchOps.execute(operations);
      const duration = Date.now() - startTime;

      // Assert
      // With concurrency 5, all operations run in parallel
      // Should take ~100ms, not ~500ms (sequential)
      expect(duration).toBeLessThan(200); // Allow some overhead
    });

    it('should track total duration', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const mockOperation = async (input: number) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return input * 2;
      };

      const operations = createBatchOperations([1, 2, 3], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.summary.totalDuration).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty operations array', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const operations: any[] = [];

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.results).toHaveLength(0);
      expect(result.summary.total).toBe(0);
      expect(result.summary.succeeded).toBe(0);
      expect(result.summary.failed).toBe(0);
    });

    it('should handle single operation', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const mockOperation = (input: number) => Promise.resolve(input * 2);
      const operations = createBatchOperations([42], mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.results).toHaveLength(1);
      expect(result.results[0].result).toBe(84);
      expect(result.summary.succeeded).toBe(1);
    });

    it('should handle operations with complex data', async () => {
      // Arrange
      const batchOps = new BatchOperations();
      const mockOperation = (input: { id: number; name: string }) =>
        Promise.resolve({ ...input, processed: true });

      const inputs = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const operations = createBatchOperations(inputs, mockOperation);

      // Act
      const result = await batchOps.execute(operations);

      // Assert
      expect(result.results[0].result).toEqual({ id: 1, name: 'Alice', processed: true });
      expect(result.results[1].result).toEqual({ id: 2, name: 'Bob', processed: true });
    });
  });
});
