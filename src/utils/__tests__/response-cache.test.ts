/**
 * Response Cache Tests
 *
 * Comprehensive unit tests for response caching functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseCache } from '../response-cache.js';

describe('ResponseCache', () => {
  describe('Basic Caching', () => {
    it('should cache and retrieve responses', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      const responseData = { id: '1', name: 'Test' };

      // Act
      cache.set('GET', '/api/test', responseData);
      const result = cache.get('GET', '/api/test');

      // Assert
      expect(result).toEqual(responseData);
    });

    it('should return null for cache miss', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });

      // Act
      const result = cache.get('GET', '/api/nonexistent');

      // Assert
      expect(result).toBeNull();
    });

    it('should cache with parameters', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      const params = { PageSize: 10, Page: 0 };
      const responseData = { data: [1, 2, 3] };

      // Act
      cache.set('GET', '/api/test', responseData, params);
      const result = cache.get('GET', '/api/test', params);

      // Assert
      expect(result).toEqual(responseData);
    });

    it('should differentiate between different parameters', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      const response1 = { data: [1, 2, 3] };
      const response2 = { data: [4, 5, 6] };

      // Act
      cache.set('GET', '/api/test', response1, { page: 1 });
      cache.set('GET', '/api/test', response2, { page: 2 });

      // Assert
      expect(cache.get('GET', '/api/test', { page: 1 })).toEqual(response1);
      expect(cache.get('GET', '/api/test', { page: 2 })).toEqual(response2);
    });

    it('should not cache when disabled', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: false });
      const responseData = { id: '1' };

      // Act
      cache.set('GET', '/api/test', responseData);
      const result = cache.get('GET', '/api/test');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, ttl: 100 }); // 100ms TTL
      const responseData = { id: '1' };

      // Act
      cache.set('GET', '/api/test', responseData);
      const beforeExpiration = cache.get('GET', '/api/test');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      const afterExpiration = cache.get('GET', '/api/test');

      // Assert
      expect(beforeExpiration).toEqual(responseData);
      expect(afterExpiration).toBeNull();
    });

    it('should not expire when TTL is 0', async () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, ttl: 0 }); // No expiration
      const responseData = { id: '1' };

      // Act
      cache.set('GET', '/api/test', responseData);
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = cache.get('GET', '/api/test');

      // Assert
      expect(result).toEqual(responseData);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entry when cache is full', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, maxSize: 3 });

      // Act - Add 4 entries (exceeds maxSize)
      cache.set('GET', '/api/1', { id: '1' });
      cache.set('GET', '/api/2', { id: '2' });
      cache.set('GET', '/api/3', { id: '3' });
      cache.set('GET', '/api/4', { id: '4' }); // Should evict /api/1

      // Assert
      expect(cache.get('GET', '/api/1')).toBeNull(); // Evicted
      expect(cache.get('GET', '/api/2')).toEqual({ id: '2' });
      expect(cache.get('GET', '/api/3')).toEqual({ id: '3' });
      expect(cache.get('GET', '/api/4')).toEqual({ id: '4' });
    });

    it('should mark entry as recently used on get', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, maxSize: 3 });

      // Act
      cache.set('GET', '/api/1', { id: '1' });
      cache.set('GET', '/api/2', { id: '2' });
      cache.set('GET', '/api/3', { id: '3' });

      // Access /api/1 to make it recently used
      cache.get('GET', '/api/1');

      // Add new entry (should evict /api/2, not /api/1)
      cache.set('GET', '/api/4', { id: '4' });

      // Assert
      expect(cache.get('GET', '/api/1')).toEqual({ id: '1' }); // Still in cache
      expect(cache.get('GET', '/api/2')).toBeNull(); // Evicted (oldest)
      expect(cache.get('GET', '/api/3')).toEqual({ id: '3' });
      expect(cache.get('GET', '/api/4')).toEqual({ id: '4' });
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate specific entry', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      cache.set('GET', '/api/test', { id: '1' });

      // Act
      const deleted = cache.invalidate('GET', '/api/test');
      const result = cache.get('GET', '/api/test');

      // Assert
      expect(deleted).toBe(true);
      expect(result).toBeNull();
    });

    it('should return false when invalidating non-existent entry', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });

      // Act
      const deleted = cache.invalidate('GET', '/api/nonexistent');

      // Assert
      expect(deleted).toBe(false);
    });

    it('should invalidate by URL pattern', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      cache.set('GET', '/api/users/1', { id: '1' });
      cache.set('GET', '/api/users/2', { id: '2' });
      cache.set('GET', '/api/posts/1', { id: '1' });

      // Act
      const count = cache.invalidateByPattern(/\/users\//);

      // Assert
      expect(count).toBe(2);
      expect(cache.get('GET', '/api/users/1')).toBeNull();
      expect(cache.get('GET', '/api/users/2')).toBeNull();
      expect(cache.get('GET', '/api/posts/1')).toEqual({ id: '1' }); // Not invalidated
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits and misses', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      cache.set('GET', '/api/test', { id: '1' });

      // Act
      cache.get('GET', '/api/test');      // Hit
      cache.get('GET', '/api/test');      // Hit
      cache.get('GET', '/api/nonexistent'); // Miss

      // Assert
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should track cache size', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, maxSize: 10 });

      // Act
      cache.set('GET', '/api/1', { id: '1' });
      cache.set('GET', '/api/2', { id: '2' });
      cache.set('GET', '/api/3', { id: '3' });

      // Assert
      const stats = cache.getStats();
      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(10);
    });

    it('should calculate hit rate', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      cache.set('GET', '/api/test', { id: '1' });

      // Act
      cache.get('GET', '/api/test');      // Hit
      cache.get('GET', '/api/test');      // Hit
      cache.get('GET', '/api/nonexistent'); // Miss
      cache.get('GET', '/api/nonexistent'); // Miss

      // Assert
      const hitRate = cache.getHitRate();
      expect(hitRate).toBe(0.5); // 2 hits out of 4 total
    });

    it('should return 0 hit rate when no requests', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });

      // Assert
      expect(cache.getHitRate()).toBe(0);
    });
  });

  describe('Clear Cache', () => {
    it('should clear all cache entries', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      cache.set('GET', '/api/1', { id: '1' });
      cache.set('GET', '/api/2', { id: '2' });

      // Act
      cache.clear();

      // Assert - Check stats first (before get() calls which increment misses)
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);

      // Verify entries are gone
      expect(cache.get('GET', '/api/1')).toBeNull();
      expect(cache.get('GET', '/api/2')).toBeNull();
    });
  });

  describe('GET-Only Mode', () => {
    it('should only cache GET requests when getOnly is true', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, getOnly: true });

      // Act
      cache.set('GET', '/api/test', { id: '1' });
      cache.set('POST', '/api/test', { id: '2' });
      cache.set('PATCH', '/api/test', { id: '3' });

      // Assert
      expect(cache.get('GET', '/api/test')).toEqual({ id: '1' }); // Cached
      expect(cache.get('POST', '/api/test')).toBeNull(); // Not cached
      expect(cache.get('PATCH', '/api/test')).toBeNull(); // Not cached
    });

    it('should cache all methods when getOnly is false', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true, getOnly: false });

      // Act
      cache.set('GET', '/api/test', { id: '1' });
      cache.set('POST', '/api/test', { id: '2' });
      cache.set('PATCH', '/api/test', { id: '3' });

      // Assert
      expect(cache.get('GET', '/api/test')).toEqual({ id: '1' });
      expect(cache.get('POST', '/api/test')).toEqual({ id: '2' });
      expect(cache.get('PATCH', '/api/test')).toEqual({ id: '3' });
    });
  });

  describe('Configuration', () => {
    it('should return configuration via getConfig()', () => {
      // Arrange
      const cache = new ResponseCache({
        enabled: true,
        maxSize: 50,
        ttl: 60000,
        getOnly: false,
      });

      // Act
      const config = cache.getConfig();

      // Assert
      expect(config.enabled).toBe(true);
      expect(config.maxSize).toBe(50);
      expect(config.ttl).toBe(60000);
      expect(config.getOnly).toBe(false);
    });

    it('should use default values when not provided', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });

      // Act
      const config = cache.getConfig();

      // Assert
      expect(config.maxSize).toBe(100);
      expect(config.ttl).toBe(300000); // 5 minutes
      expect(config.getOnly).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle updating existing cache entry', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      cache.set('GET', '/api/test', { id: '1', version: 1 });

      // Act - Update same key
      cache.set('GET', '/api/test', { id: '1', version: 2 });
      const result = cache.get('GET', '/api/test');

      // Assert
      expect(result).toEqual({ id: '1', version: 2 });
      expect(cache.getStats().size).toBe(1); // Still only 1 entry
    });

    it('should handle complex objects', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      const complexObject = {
        data: [{ id: 1, nested: { value: 'test' } }],
        meta: { total: 1, page: 0 },
      };

      // Act
      cache.set('GET', '/api/test', complexObject);
      const result = cache.get('GET', '/api/test');

      // Assert
      expect(result).toEqual(complexObject);
    });

    it('should handle empty parameters', () => {
      // Arrange
      const cache = new ResponseCache({ enabled: true });
      const responseData = { id: '1' };

      // Act
      cache.set('GET', '/api/test', responseData, {});
      const result = cache.get('GET', '/api/test', {});

      // Assert
      expect(result).toEqual(responseData);
    });
  });
});
