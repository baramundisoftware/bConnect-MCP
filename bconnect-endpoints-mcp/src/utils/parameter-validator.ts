/**
 * Parameter Validation Utility
 *
 * Comprehensive input validation for all MCP tool parameters.
 * Validates types, formats, ranges, and required fields.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Validation rule definition
 */
export interface ValidationRule {
  /** Parameter name */
  name: string;
  /** Is parameter required? */
  required?: boolean;
  /** Expected type */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Minimum value (for numbers) */
  min?: number;
  /** Maximum value (for numbers) */
  max?: number;
  /** Minimum length (for strings) */
  minLength?: number;
  /** Maximum length (for strings) */
  maxLength?: number;
  /** Allowed enum values */
  enum?: string[];
  /** Regex pattern */
  pattern?: RegExp;
  /** Custom format validator */
  format?: 'guid' | 'email' | 'url' | 'json-patch' | 'iso-date';
  /** Custom error message */
  message?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Common regex patterns
 */
const PATTERNS = {
  // GUID/UUID pattern (with or without hyphens)
  guid: /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/,
  // Email pattern (basic validation)
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // URL pattern (basic validation)
  url: /^https?:\/\/.+/,
  // ISO 8601 date pattern
  isoDate: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/,
};

/**
 * Validate a single parameter
 */
function validateParameter(value: any, rule: ValidationRule): string[] {
  const errors: string[] = [];
  const { name, required, type, min, max, minLength, maxLength, enum: enumValues, pattern, format } = rule;

  // Check if required
  if (required && (value === undefined || value === null || value === '')) {
    errors.push(`${name} is required`);
    return errors; // Don't check other rules if required param is missing
  }

  // If value is not provided and not required, skip validation
  if (value === undefined || value === null) {
    return errors;
  }

  // Type validation
  if (type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== type) {
      errors.push(`${name} must be of type ${type}, got ${actualType}`);
      return errors; // Don't check other rules if type is wrong
    }
  }

  // Number validations
  if (type === 'number' && typeof value === 'number') {
    if (min !== undefined && value < min) {
      errors.push(`${name} must be at least ${min}`);
    }
    if (max !== undefined && value > max) {
      errors.push(`${name} must be at most ${max}`);
    }
    if (!Number.isFinite(value)) {
      errors.push(`${name} must be a finite number`);
    }
  }

  // String validations
  if (type === 'string' && typeof value === 'string') {
    if (minLength !== undefined && value.length < minLength) {
      errors.push(`${name} must be at least ${minLength} characters`);
    }
    if (maxLength !== undefined && value.length > maxLength) {
      errors.push(`${name} must be at most ${maxLength} characters`);
    }

    // Enum validation
    if (enumValues && !enumValues.includes(value)) {
      errors.push(`${name} must be one of: ${enumValues.join(', ')}`);
    }

    // Pattern validation
    if (pattern && !pattern.test(value)) {
      errors.push(rule.message || `${name} has invalid format`);
    }

    // Format validation (string formats only)
    if (format && format !== 'json-patch') {
      switch (format) {
        case 'guid':
          if (!PATTERNS.guid.test(value)) {
            errors.push(`${name} must be a valid GUID (e.g., 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')`);
          }
          break;
        case 'email':
          if (!PATTERNS.email.test(value)) {
            errors.push(`${name} must be a valid email address`);
          }
          break;
        case 'url':
          if (!PATTERNS.url.test(value)) {
            errors.push(`${name} must be a valid URL starting with http:// or https://`);
          }
          break;
        case 'iso-date':
          if (!PATTERNS.isoDate.test(value)) {
            errors.push(`${name} must be a valid ISO 8601 date (e.g., '2025-01-01' or '2025-01-01T12:00:00Z')`);
          }
          break;
      }
    }
  }

  // Array validations
  if (type === 'array' && Array.isArray(value)) {
    if (minLength !== undefined && value.length < minLength) {
      errors.push(`${name} must contain at least ${minLength} items`);
    }
    if (maxLength !== undefined && value.length > maxLength) {
      errors.push(`${name} must contain at most ${maxLength} items`);
    }

    // JSON Patch validation (for arrays)
    if (format === 'json-patch') {
      value.forEach((op: any, index: number) => {
        if (!op.op || !['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(op.op)) {
          errors.push(`${name}[${index}].op must be one of: add, remove, replace, move, copy, test`);
        }
        if (!op.path) {
          errors.push(`${name}[${index}].path is required`);
        }
      });
    }
  }

  // Object validation
  if (type === 'object' && typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      errors.push(`${name} must be an object, not an array`);
    }
  }

  return errors;
}

/**
 * Validate all parameters against rules
 */
export function validateParameters(args: Record<string, any> | undefined, rules: ValidationRule[]): ValidationResult {
  const errors: string[] = [];

  // Check each rule
  rules.forEach(rule => {
    const value = args?.[rule.name];
    const paramErrors = validateParameter(value, rule);
    errors.push(...paramErrors);
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate and throw McpError if validation fails
 */
export function validateOrThrow(args: Record<string, any> | undefined, rules: ValidationRule[]): void {
  const result = validateParameters(args, rules);
  if (!result.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid parameters: ${result.errors.join('; ')}`
    );
  }
}

/**
 * Common validation rule presets
 */
export const CommonRules = {
  // GUID parameter (required)
  guid: (name: string = 'id'): ValidationRule => ({
    name,
    required: true,
    type: 'string',
    format: 'guid',
    message: `${name} must be a valid GUID`
  }),

  // Optional GUID parameter
  guidOptional: (name: string = 'id'): ValidationRule => ({
    name,
    required: false,
    type: 'string',
    format: 'guid',
    message: `${name} must be a valid GUID`
  }),

  // Page number (zero-indexed, non-negative)
  page: (): ValidationRule => ({
    name: 'Page',
    required: false,
    type: 'number',
    min: 0,
    message: 'Page must be a non-negative integer'
  }),

  // Page size (1-1000, default 20)
  pageSize: (): ValidationRule => ({
    name: 'PageSize',
    required: false,
    type: 'number',
    min: 1,
    max: 1000,
    message: 'PageSize must be between 1 and 1000'
  }),

  // Search query (non-empty string)
  searchQuery: (): ValidationRule => ({
    name: 'SearchQuery',
    required: false,
    type: 'string',
    minLength: 1,
    maxLength: 1000,
    message: 'SearchQuery must be between 1 and 1000 characters'
  }),

  // Order by clause
  orderBy: (): ValidationRule => ({
    name: 'OrderBy',
    required: false,
    type: 'string',
    minLength: 1,
    maxLength: 200,
    message: 'OrderBy must be a valid sort expression (e.g., "DisplayName asc")'
  }),

  // JSON Patch document (must be array, not object)
  jsonPatch: (): ValidationRule => ({
    name: 'patchDocument',
    required: true,
    type: 'array',
    format: 'json-patch',
    message: 'patchDocument must be a valid JSON Patch document'
  }),

  // Display name (common endpoint parameter)
  displayName: (required: boolean = true): ValidationRule => ({
    name: 'DisplayName',
    required,
    type: 'string',
    minLength: 1,
    maxLength: 255,
    message: 'DisplayName must be between 1 and 255 characters'
  }),

  // Comment field
  comment: (): ValidationRule => ({
    name: 'Comment',
    required: false,
    type: 'string',
    maxLength: 4000,
    message: 'Comment must be at most 4000 characters'
  }),
};
