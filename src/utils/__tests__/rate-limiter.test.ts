/**
 * Rate Limiter Tests
 *
 * Comprehensive unit tests for the token bucket rate limiter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter, RateLimitError } from '../rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    // Reset time mocks
    vi.clearAllMocks();
  });

  describe('Basic Rate Limiting', () => {
    it('should allow requests within the limit', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        enabled: true,
      });

      // Act & Assert - Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        const result = limiter.tryConsume();
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i); // 4, 3, 2, 1, 0
        expect(result.limit).toBe(5);
      }
    });

    it('should block requests exceeding the limit', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 3,
        windowMs: 1000,
        enabled: true,
      });

      // Act - Consume all tokens
      limiter.tryConsume(); // 2 remaining
      limiter.tryConsume(); // 1 remaining
      limiter.tryConsume(); // 0 remaining

      // Assert - Next request should be blocked
      const result = limiter.tryConsume();
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should allow all requests when disabled', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        enabled: false, // Disabled
      });

      // Act & Assert - Should allow more than maxRequests
      for (let i = 0; i < 10; i++) {
        const result = limiter.tryConsume();
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2); // Always max when disabled
      }
    });
  });

  describe('Token Refill Behavior', () => {
    it('should refill tokens over time', async () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000, // 10 tokens per second = 1 token per 100ms
        enabled: true,
      });

      // Act - Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryConsume();
      }

      // Assert - Should be blocked
      expect(limiter.tryConsume().allowed).toBe(false);

      // Wait for tokens to refill (200ms = 2 tokens)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Assert - Should allow 2 requests now
      expect(limiter.tryConsume().allowed).toBe(true);
      expect(limiter.tryConsume().allowed).toBe(true);
      expect(limiter.tryConsume().allowed).toBe(false); // Third should fail
    });

    it('should cap tokens at maxRequests (no overflow)', async () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        enabled: true,
      });

      // Act - Wait longer than windowMs
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      // Assert - Should still only have 5 tokens (not 10)
      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(limiter.tryConsume().allowed);
      }

      expect(results).toEqual([true, true, true, true, true, false]);
    });
  });

  describe('checkLimit() - Non-consuming check', () => {
    it('should check limit without consuming tokens', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 3,
        windowMs: 1000,
        enabled: true,
      });

      // Act - Check limit multiple times
      const check1 = limiter.checkLimit();
      const check2 = limiter.checkLimit();
      const check3 = limiter.checkLimit();

      // Assert - All checks should show same state (no tokens consumed)
      expect(check1.remaining).toBe(3);
      expect(check2.remaining).toBe(3);
      expect(check3.remaining).toBe(3);
      expect(check1.allowed).toBe(true);

      // Now consume a token
      limiter.tryConsume();

      // Check again
      const check4 = limiter.checkLimit();
      expect(check4.remaining).toBe(2); // One token consumed
    });
  });

  describe('reset()', () => {
    it('should reset tokens to full capacity', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        enabled: true,
      });

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume();
      }

      // Assert - Should be blocked
      expect(limiter.tryConsume().allowed).toBe(false);

      // Act - Reset
      limiter.reset();

      // Assert - Should have full capacity again
      const result = limiter.checkLimit();
      expect(result.remaining).toBe(5);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Rate Limit Info', () => {
    it('should provide accurate remaining count', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000,
        enabled: true,
      });

      // Act & Assert
      expect(limiter.tryConsume().remaining).toBe(9);
      expect(limiter.tryConsume().remaining).toBe(8);
      expect(limiter.tryConsume().remaining).toBe(7);
    });

    it('should calculate resetInMs when rate limited', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000, // 1 token per 100ms
        enabled: true,
      });

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryConsume();
      }

      // Act - Try to consume when no tokens available
      const result = limiter.tryConsume();

      // Assert - Should provide reset time
      expect(result.allowed).toBe(false);
      expect(result.resetInMs).toBeGreaterThan(0);
      expect(result.resetInMs).toBeLessThanOrEqual(100); // Next token in ~100ms
    });
  });

  describe('Configuration', () => {
    it('should use default message when not provided', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 1,
        windowMs: 1000,
        enabled: true,
      });

      // Act
      const config = limiter.getConfig();

      // Assert
      expect(config.message).toBe('Rate limit exceeded. Please try again later.');
    });

    it('should use custom message when provided', () => {
      // Arrange
      const customMessage = 'Too many requests!';
      const limiter = new RateLimiter({
        maxRequests: 1,
        windowMs: 1000,
        enabled: true,
        message: customMessage,
      });

      // Act
      const config = limiter.getConfig();

      // Assert
      expect(config.message).toBe(customMessage);
    });

    it('should expose configuration via getConfig()', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 50,
        windowMs: 60000,
        enabled: true,
        allowBurst: false,
      });

      // Act
      const config = limiter.getConfig();

      // Assert
      expect(config.maxRequests).toBe(50);
      expect(config.windowMs).toBe(60000);
      expect(config.enabled).toBe(true);
      expect(config.allowBurst).toBe(false);
    });
  });

  describe('RateLimitError', () => {
    it('should create error with rate limit info', () => {
      // Arrange
      const info = {
        remaining: 0,
        limit: 10,
        resetInMs: 5000,
        allowed: false,
      };

      // Act
      const error = new RateLimitError('Rate limit exceeded', info);

      // Assert
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.name).toBe('RateLimitError');
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.info).toEqual(info);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very low rate limits', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 1,
        windowMs: 10000, // 1 request per 10 seconds
        enabled: true,
      });

      // Act
      const first = limiter.tryConsume();
      const second = limiter.tryConsume();

      // Assert
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
      expect(second.resetInMs).toBeGreaterThan(9000); // ~10 seconds
    });

    it('should handle very high rate limits', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 1000,
        windowMs: 1000, // 1000 requests per second
        enabled: true,
      });

      // Act - Try to consume 1000 tokens quickly
      let successCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (limiter.tryConsume().allowed) {
          successCount++;
        }
      }

      // Assert
      expect(successCount).toBe(1000);
    });

    it('should handle concurrent requests', () => {
      // Arrange
      const limiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000,
        enabled: true,
      });

      // Act - Simulate concurrent requests
      const results = Array.from({ length: 15 }, () => limiter.tryConsume());

      // Assert
      const allowed = results.filter(r => r.allowed).length;
      const blocked = results.filter(r => !r.allowed).length;

      expect(allowed).toBe(10); // First 10 allowed
      expect(blocked).toBe(5);  // Last 5 blocked
    });
  });
});
