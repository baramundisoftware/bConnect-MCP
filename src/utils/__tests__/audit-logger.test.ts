/**
 * Audit Logger Tests
 *
 * Comprehensive unit tests for audit logging functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditLogger, AuditLogEntry } from '../audit-logger.js';

describe('AuditLogger', () => {
  describe('Audit Level: none', () => {
    it('should not log when level is none', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'none',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      const startTime = logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      logger.logResponse('GET', '/endpoints/v2.0/WindowsEndpoints', 200, startTime);

      // Assert
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('Audit Level: all', () => {
    it('should log all operations when level is all', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act - Test GET, POST, PATCH, DELETE
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      logger.logRequest('POST', '/jobs/v2.0/JobInstances');
      logger.logRequest('PATCH', '/assets/v2.0/Assets/asset-001');
      logger.logRequest('DELETE', '/endpoints/v2.0/WindowsEndpoints/endpoint-001');

      // Assert
      expect(mockHandler).toHaveBeenCalledTimes(4);
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/endpoints/v2.0/WindowsEndpoints',
          user: 'testuser',
        })
      );
    });
  });

  describe('Audit Level: write', () => {
    it('should log only write operations (POST, PATCH, DELETE)', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'write',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      logger.logRequest('POST', '/jobs/v2.0/JobInstances');
      logger.logRequest('PATCH', '/assets/v2.0/Assets/asset-001');
      logger.logRequest('DELETE', '/endpoints/v2.0/WindowsEndpoints/endpoint-001');

      // Assert - GET should not be logged, POST/PATCH/DELETE should
      expect(mockHandler).toHaveBeenCalledTimes(3);
      expect(mockHandler).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Audit Level: security', () => {
    it('should log only security-sensitive operations', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'security',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints'); // Not security-sensitive
      logger.logRequest('GET', '/bConnect/V1.1/BitLockerSecrets'); // Security-sensitive
      logger.logRequest('POST', '/jobs/v2.0/JobInstances'); // Not security-sensitive
      logger.logRequest('GET', '/bConnect/V1.1/TpmOwnerPasswords'); // Security-sensitive

      // Assert - Only security-sensitive operations logged
      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/bConnect/V1.1/BitLockerSecrets',
          securitySensitive: true,
        })
      );
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/bConnect/V1.1/TpmOwnerPasswords',
          securitySensitive: true,
        })
      );
    });
  });

  describe('Security-Sensitive Detection', () => {
    it('should detect security-sensitive paths', () => {
      // Arrange
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
      });

      // Act & Assert
      expect(logger.isSecuritySensitive('/bConnect/V1.1/BitLockerSecrets')).toBe(true);
      expect(logger.isSecuritySensitive('/bConnect/V1.1/TpmOwnerPasswords')).toBe(true);
      expect(logger.isSecuritySensitive('/bConnect/V1.1/BitLockerPINs')).toBe(true);
      expect(logger.isSecuritySensitive('/api/v1/Credentials')).toBe(true);
      expect(logger.isSecuritySensitive('/endpoints/v2.0/WindowsEndpoints')).toBe(false);
      expect(logger.isSecuritySensitive('/jobs/v2.0/JobInstances')).toBe(false);
    });
  });

  describe('Log Entry Structure', () => {
    it('should create log entry with all required fields', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints', { PageSize: 10 });

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          level: 'info',
          operation: 'GET /endpoints/v2.0/WindowsEndpoints',
          user: 'testuser',
          method: 'GET',
          path: '/endpoints/v2.0/WindowsEndpoints',
          securitySensitive: false,
        })
      );
    });

    it('should include parameters when includeParameters is true', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
        includeParameters: true,
      });

      // Act
      const params = { PageSize: 10, Page: 0 };
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints', params);

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: params,
        })
      );
    });

    it('should not include parameters when includeParameters is false', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
        includeParameters: false,
      });

      // Act
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints', { PageSize: 10 });

      // Assert
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: undefined,
        })
      );
    });
  });

  describe('Response Logging', () => {
    it('should log response with status code and duration', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      const startTime = logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      logger.logResponse('GET', '/endpoints/v2.0/WindowsEndpoints', 200, startTime);

      // Assert - Second call is logResponse
      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          statusCode: 200,
          duration: expect.any(Number),
          level: 'info',
        })
      );
    });

    it('should set level to error for 4xx status codes', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      const startTime = logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      logger.logResponse('GET', '/endpoints/v2.0/WindowsEndpoints', 404, startTime);

      // Assert
      expect(mockHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          level: 'error',
          statusCode: 404,
        })
      );
    });

    it('should set level to warn for 3xx status codes', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      const startTime = logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      logger.logResponse('GET', '/endpoints/v2.0/WindowsEndpoints', 301, startTime);

      // Assert
      expect(mockHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          level: 'warn',
          statusCode: 301,
        })
      );
    });
  });

  describe('Error Logging', () => {
    it('should log errors with error message and duration', () => {
      // Arrange
      const mockHandler = vi.fn();
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
        logHandler: mockHandler,
      });

      // Act
      const startTime = logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');
      const error = new Error('Network timeout');
      logger.logError('GET', '/endpoints/v2.0/WindowsEndpoints', error, startTime);

      // Assert - Second call is logError
      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          level: 'error',
          error: 'Network timeout',
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('Default Console Log Handler', () => {
    it('should log to console when no custom handler provided', () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'log');
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
      });

      // Act
      logger.logRequest('GET', '/endpoints/v2.0/WindowsEndpoints');

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('testuser')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET /endpoints/v2.0/WindowsEndpoints')
      );

      // Cleanup
      consoleSpy.mockRestore();
    });

    it('should log to console.error for errors', () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'error');
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
      });

      // Act
      const startTime = Date.now();
      logger.logError('GET', '/endpoints/v2.0/WindowsEndpoints', new Error('Test error'), startTime);

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AUDIT]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ERROR: Test error')
      );

      // Cleanup
      consoleSpy.mockRestore();
    });

    it('should prefix security-sensitive logs with [SECURITY AUDIT]', () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'log');
      const logger = new AuditLogger({
        level: 'all',
        username: 'testuser',
      });

      // Act
      logger.logRequest('GET', '/bConnect/V1.1/BitLockerSecrets');

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SECURITY AUDIT]')
      );

      // Cleanup
      consoleSpy.mockRestore();
    });
  });

  describe('Configuration', () => {
    it('should return configuration via getConfig()', () => {
      // Arrange
      const logger = new AuditLogger({
        level: 'write',
        username: 'testuser',
        includeParameters: true,
      });

      // Act
      const config = logger.getConfig();

      // Assert
      expect(config.level).toBe('write');
      expect(config.username).toBe('testuser');
      expect(config.includeParameters).toBe(true);
      expect(config.logHandler).toBeDefined();
    });
  });
});
