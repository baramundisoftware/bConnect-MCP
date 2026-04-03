/**
 * Tests for Parameter Validation Utility
 */

import { describe, it, expect } from 'vitest';
import { validateParameters, validateOrThrow, CommonRules, ValidationRule } from '../parameter-validator.js';
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

describe('Parameter Validator', () => {
  describe('Required Parameter Validation', () => {
    it('should fail when required parameter is missing', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' }
      ];

      const result = validateParameters({}, rules);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
    });

    it('should fail when required parameter is null', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' }
      ];

      const result = validateParameters({ id: null }, rules);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
    });

    it('should fail when required parameter is empty string', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' }
      ];

      const result = validateParameters({ id: '' }, rules);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
    });

    it('should pass when required parameter is provided', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' }
      ];

      const result = validateParameters({ id: 'test-id' }, rules);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass when optional parameter is missing', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: false, type: 'string' }
      ];

      const result = validateParameters({}, rules);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Type Validation', () => {
    it('should validate string type', () => {
      const rules: ValidationRule[] = [
        { name: 'name', type: 'string' }
      ];

      expect(validateParameters({ name: 'test' }, rules).valid).toBe(true);
      expect(validateParameters({ name: 123 }, rules).valid).toBe(false);
      expect(validateParameters({ name: true }, rules).valid).toBe(false);
      expect(validateParameters({ name: {} }, rules).valid).toBe(false);
    });

    it('should validate number type', () => {
      const rules: ValidationRule[] = [
        { name: 'count', type: 'number' }
      ];

      expect(validateParameters({ count: 123 }, rules).valid).toBe(true);
      expect(validateParameters({ count: 0 }, rules).valid).toBe(true);
      expect(validateParameters({ count: -1 }, rules).valid).toBe(true);
      expect(validateParameters({ count: 'test' }, rules).valid).toBe(false);
      expect(validateParameters({ count: true }, rules).valid).toBe(false);
    });

    it('should validate boolean type', () => {
      const rules: ValidationRule[] = [
        { name: 'enabled', type: 'boolean' }
      ];

      expect(validateParameters({ enabled: true }, rules).valid).toBe(true);
      expect(validateParameters({ enabled: false }, rules).valid).toBe(true);
      expect(validateParameters({ enabled: 'true' }, rules).valid).toBe(false);
      expect(validateParameters({ enabled: 1 }, rules).valid).toBe(false);
    });

    it('should validate object type', () => {
      const rules: ValidationRule[] = [
        { name: 'data', type: 'object' }
      ];

      expect(validateParameters({ data: {} }, rules).valid).toBe(true);
      expect(validateParameters({ data: { key: 'value' } }, rules).valid).toBe(true);
      expect(validateParameters({ data: [] }, rules).valid).toBe(false);
      expect(validateParameters({ data: 'test' }, rules).valid).toBe(false);
    });

    it('should validate array type', () => {
      const rules: ValidationRule[] = [
        { name: 'items', type: 'array' }
      ];

      expect(validateParameters({ items: [] }, rules).valid).toBe(true);
      expect(validateParameters({ items: [1, 2, 3] }, rules).valid).toBe(true);
      expect(validateParameters({ items: {} }, rules).valid).toBe(false);
      expect(validateParameters({ items: 'test' }, rules).valid).toBe(false);
    });
  });

  describe('Number Range Validation', () => {
    it('should validate minimum value', () => {
      const rules: ValidationRule[] = [
        { name: 'age', type: 'number', min: 0 }
      ];

      expect(validateParameters({ age: 0 }, rules).valid).toBe(true);
      expect(validateParameters({ age: 10 }, rules).valid).toBe(true);
      expect(validateParameters({ age: -1 }, rules).valid).toBe(false);
    });

    it('should validate maximum value', () => {
      const rules: ValidationRule[] = [
        { name: 'age', type: 'number', max: 100 }
      ];

      expect(validateParameters({ age: 100 }, rules).valid).toBe(true);
      expect(validateParameters({ age: 50 }, rules).valid).toBe(true);
      expect(validateParameters({ age: 101 }, rules).valid).toBe(false);
    });

    it('should validate min and max together', () => {
      const rules: ValidationRule[] = [
        { name: 'PageSize', type: 'number', min: 1, max: 1000 }
      ];

      expect(validateParameters({ PageSize: 1 }, rules).valid).toBe(true);
      expect(validateParameters({ PageSize: 500 }, rules).valid).toBe(true);
      expect(validateParameters({ PageSize: 1000 }, rules).valid).toBe(true);
      expect(validateParameters({ PageSize: 0 }, rules).valid).toBe(false);
      expect(validateParameters({ PageSize: 1001 }, rules).valid).toBe(false);
    });

    it('should reject infinite numbers', () => {
      const rules: ValidationRule[] = [
        { name: 'value', type: 'number' }
      ];

      expect(validateParameters({ value: Infinity }, rules).valid).toBe(false);
      expect(validateParameters({ value: -Infinity }, rules).valid).toBe(false);
    });
  });

  describe('String Length Validation', () => {
    it('should validate minimum length', () => {
      const rules: ValidationRule[] = [
        { name: 'name', type: 'string', minLength: 3 }
      ];

      expect(validateParameters({ name: 'abc' }, rules).valid).toBe(true);
      expect(validateParameters({ name: 'abcd' }, rules).valid).toBe(true);
      expect(validateParameters({ name: 'ab' }, rules).valid).toBe(false);
    });

    it('should validate maximum length', () => {
      const rules: ValidationRule[] = [
        { name: 'name', type: 'string', maxLength: 10 }
      ];

      expect(validateParameters({ name: '1234567890' }, rules).valid).toBe(true);
      expect(validateParameters({ name: '123' }, rules).valid).toBe(true);
      expect(validateParameters({ name: '12345678901' }, rules).valid).toBe(false);
    });
  });

  describe('Enum Validation', () => {
    it('should validate enum values', () => {
      const rules: ValidationRule[] = [
        { name: 'status', type: 'string', enum: ['active', 'inactive', 'pending'] }
      ];

      expect(validateParameters({ status: 'active' }, rules).valid).toBe(true);
      expect(validateParameters({ status: 'inactive' }, rules).valid).toBe(true);
      expect(validateParameters({ status: 'pending' }, rules).valid).toBe(true);
      expect(validateParameters({ status: 'invalid' }, rules).valid).toBe(false);
    });
  });

  describe('Format Validation', () => {
    describe('GUID Format', () => {
      it('should validate standard GUID format', () => {
        const rules: ValidationRule[] = [
          { name: 'id', type: 'string', format: 'guid' }
        ];

        expect(validateParameters({ id: '123e4567-e89b-12d3-a456-426614174000' }, rules).valid).toBe(true);
        expect(validateParameters({ id: '00000000-0000-0000-0000-000000000000' }, rules).valid).toBe(true);
        expect(validateParameters({ id: 'not-a-guid' }, rules).valid).toBe(false);
        expect(validateParameters({ id: '123' }, rules).valid).toBe(false);
      });

      it('should validate GUID without hyphens', () => {
        const rules: ValidationRule[] = [
          { name: 'id', type: 'string', format: 'guid' }
        ];

        expect(validateParameters({ id: '123e4567e89b12d3a456426614174000' }, rules).valid).toBe(true);
      });
    });

    describe('Email Format', () => {
      it('should validate email format', () => {
        const rules: ValidationRule[] = [
          { name: 'email', type: 'string', format: 'email' }
        ];

        expect(validateParameters({ email: 'test@example.com' }, rules).valid).toBe(true);
        expect(validateParameters({ email: 'user.name@domain.co.uk' }, rules).valid).toBe(true);
        expect(validateParameters({ email: 'invalid-email' }, rules).valid).toBe(false);
        expect(validateParameters({ email: '@example.com' }, rules).valid).toBe(false);
      });
    });

    describe('URL Format', () => {
      it('should validate URL format', () => {
        const rules: ValidationRule[] = [
          { name: 'url', type: 'string', format: 'url' }
        ];

        expect(validateParameters({ url: 'https://example.com' }, rules).valid).toBe(true);
        expect(validateParameters({ url: 'http://example.com/path' }, rules).valid).toBe(true);
        expect(validateParameters({ url: 'ftp://example.com' }, rules).valid).toBe(false);
        expect(validateParameters({ url: 'not-a-url' }, rules).valid).toBe(false);
      });
    });

    describe('ISO Date Format', () => {
      it('should validate ISO 8601 date format', () => {
        const rules: ValidationRule[] = [
          { name: 'date', type: 'string', format: 'iso-date' }
        ];

        expect(validateParameters({ date: '2025-01-01' }, rules).valid).toBe(true);
        expect(validateParameters({ date: '2025-01-01T12:00:00Z' }, rules).valid).toBe(true);
        expect(validateParameters({ date: '2025-01-01T12:00:00.123Z' }, rules).valid).toBe(true);
        expect(validateParameters({ date: '2025-01-01T12:00:00+02:00' }, rules).valid).toBe(true);
        expect(validateParameters({ date: '01/01/2025' }, rules).valid).toBe(false);
        expect(validateParameters({ date: 'not-a-date' }, rules).valid).toBe(false);
      });
    });

    describe('JSON Patch Format', () => {
      it('should validate JSON Patch operations', () => {
        const rules: ValidationRule[] = [
          { name: 'patch', type: 'array', format: 'json-patch' }
        ];

        const validPatch = [
          { op: 'add', path: '/name', value: 'test' },
          { op: 'remove', path: '/old' },
          { op: 'replace', path: '/status', value: 'active' }
        ];

        expect(validateParameters({ patch: validPatch }, rules).valid).toBe(true);
      });

      it('should reject invalid JSON Patch operations', () => {
        const rules: ValidationRule[] = [
          { name: 'patch', type: 'array', format: 'json-patch' }
        ];

        const invalidPatch = [
          { op: 'invalid', path: '/name' }
        ];

        expect(validateParameters({ patch: invalidPatch }, rules).valid).toBe(false);
      });

      it('should reject JSON Patch without path', () => {
        const rules: ValidationRule[] = [
          { name: 'patch', type: 'array', format: 'json-patch' }
        ];

        const invalidPatch = [
          { op: 'add', value: 'test' }
        ];

        expect(validateParameters({ patch: invalidPatch }, rules).valid).toBe(false);
      });
    });
  });

  describe('Pattern Validation', () => {
    it('should validate custom regex patterns', () => {
      const rules: ValidationRule[] = [
        { name: 'code', type: 'string', pattern: /^[A-Z]{3}-\d{3}$/ }
      ];

      expect(validateParameters({ code: 'ABC-123' }, rules).valid).toBe(true);
      expect(validateParameters({ code: 'XYZ-999' }, rules).valid).toBe(true);
      expect(validateParameters({ code: 'abc-123' }, rules).valid).toBe(false);
      expect(validateParameters({ code: 'ABC-12' }, rules).valid).toBe(false);
    });
  });

  describe('Array Length Validation', () => {
    it('should validate array minimum length', () => {
      const rules: ValidationRule[] = [
        { name: 'items', type: 'array', minLength: 2 }
      ];

      expect(validateParameters({ items: [1, 2] }, rules).valid).toBe(true);
      expect(validateParameters({ items: [1, 2, 3] }, rules).valid).toBe(true);
      expect(validateParameters({ items: [1] }, rules).valid).toBe(false);
    });

    it('should validate array maximum length', () => {
      const rules: ValidationRule[] = [
        { name: 'items', type: 'array', maxLength: 5 }
      ];

      expect(validateParameters({ items: [1, 2, 3, 4, 5] }, rules).valid).toBe(true);
      expect(validateParameters({ items: [1, 2] }, rules).valid).toBe(true);
      expect(validateParameters({ items: [1, 2, 3, 4, 5, 6] }, rules).valid).toBe(false);
    });
  });

  describe('Multiple Parameters', () => {
    it('should validate multiple parameters', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string', format: 'guid' },
        { name: 'PageSize', type: 'number', min: 1, max: 1000 },
        { name: 'SearchQuery', type: 'string', maxLength: 1000 }
      ];

      const validArgs = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        PageSize: 50,
        SearchQuery: 'test query'
      };

      expect(validateParameters(validArgs, rules).valid).toBe(true);
    });

    it('should collect all errors', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' },
        { name: 'PageSize', type: 'number', min: 1, max: 1000 },
        { name: 'email', type: 'string', format: 'email' }
      ];

      const invalidArgs = {
        PageSize: 2000,
        email: 'not-an-email'
      };

      const result = validateParameters(invalidArgs, rules);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toContain('id is required');
      expect(result.errors.some(e => e.includes('PageSize'))).toBe(true);
      expect(result.errors.some(e => e.includes('email'))).toBe(true);
    });
  });

  describe('validateOrThrow', () => {
    it('should not throw for valid parameters', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' }
      ];

      expect(() => validateOrThrow({ id: 'test' }, rules)).not.toThrow();
    });

    it('should throw McpError for invalid parameters', () => {
      const rules: ValidationRule[] = [
        { name: 'id', required: true, type: 'string' }
      ];

      expect(() => validateOrThrow({}, rules)).toThrow(McpError);

      try {
        validateOrThrow({}, rules);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
        expect((error as McpError).message).toContain('Invalid parameters');
        expect((error as McpError).message).toContain('id is required');
      }
    });
  });

  describe('CommonRules Presets', () => {
    it('should validate GUID with CommonRules.guid', () => {
      const rules = [CommonRules.guid('endpointId')];

      expect(validateParameters({ endpointId: '123e4567-e89b-12d3-a456-426614174000' }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(false);
      expect(validateParameters({ endpointId: 'not-a-guid' }, rules).valid).toBe(false);
    });

    it('should validate optional GUID with CommonRules.guidOptional', () => {
      const rules = [CommonRules.guidOptional('endpointId')];

      expect(validateParameters({ endpointId: '123e4567-e89b-12d3-a456-426614174000' }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(true);
      expect(validateParameters({ endpointId: 'not-a-guid' }, rules).valid).toBe(false);
    });

    it('should validate Page with CommonRules.page', () => {
      const rules = [CommonRules.page()];

      expect(validateParameters({ Page: 0 }, rules).valid).toBe(true);
      expect(validateParameters({ Page: 10 }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(true);
      expect(validateParameters({ Page: -1 }, rules).valid).toBe(false);
    });

    it('should validate PageSize with CommonRules.pageSize', () => {
      const rules = [CommonRules.pageSize()];

      expect(validateParameters({ PageSize: 1 }, rules).valid).toBe(true);
      expect(validateParameters({ PageSize: 500 }, rules).valid).toBe(true);
      expect(validateParameters({ PageSize: 1000 }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(true);
      expect(validateParameters({ PageSize: 0 }, rules).valid).toBe(false);
      expect(validateParameters({ PageSize: 1001 }, rules).valid).toBe(false);
    });

    it('should validate SearchQuery with CommonRules.searchQuery', () => {
      const rules = [CommonRules.searchQuery()];

      expect(validateParameters({ SearchQuery: 'test' }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(true);
      expect(validateParameters({ SearchQuery: '' }, rules).valid).toBe(false);
      expect(validateParameters({ SearchQuery: 'a'.repeat(1001) }, rules).valid).toBe(false);
    });

    it('should validate DisplayName with CommonRules.displayName', () => {
      const rules = [CommonRules.displayName(true)];

      expect(validateParameters({ DisplayName: 'Test Name' }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(false);
      expect(validateParameters({ DisplayName: '' }, rules).valid).toBe(false);
      expect(validateParameters({ DisplayName: 'a'.repeat(256) }, rules).valid).toBe(false);
    });

    it('should validate optional DisplayName', () => {
      const rules = [CommonRules.displayName(false)];

      expect(validateParameters({ DisplayName: 'Test Name' }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(true);
      expect(validateParameters({ DisplayName: '' }, rules).valid).toBe(false);
    });

    it('should validate Comment with CommonRules.comment', () => {
      const rules = [CommonRules.comment()];

      expect(validateParameters({ Comment: 'Test comment' }, rules).valid).toBe(true);
      expect(validateParameters({}, rules).valid).toBe(true);
      expect(validateParameters({ Comment: 'a'.repeat(4000) }, rules).valid).toBe(true);
      expect(validateParameters({ Comment: 'a'.repeat(4001) }, rules).valid).toBe(false);
    });
  });
});
