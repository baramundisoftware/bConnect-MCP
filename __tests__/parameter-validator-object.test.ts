/**
 * Object parameters in the shared argument validator: what a caller gets for
 * null, an array and an object. Pinned before a CodeQL quality fix removed an
 * object check that can't be reached: the type check answers first (#291).
 */
import { describe, expect, it } from 'vitest';
import { validateParameters, type ValidationRule } from '../packages/mcp-core/src/parameter-validator.js';

const optional: ValidationRule[] = [{ name: 'filter', type: 'object' }];
const required: ValidationRule[] = [{ name: 'filter', type: 'object', required: true }];

describe('validateParameters — object parameters', () => {
  it('an optional object given null or nothing is valid', () => {
    expect(validateParameters({ filter: null }, optional)).toEqual({ valid: true, errors: [] });
    expect(validateParameters({}, optional)).toEqual({ valid: true, errors: [] });
  });

  it('a required object given null or nothing is missing', () => {
    expect(validateParameters({ filter: null }, required)).toEqual({ valid: false, errors: ['filter is required'] });
    expect(validateParameters({}, required)).toEqual({ valid: false, errors: ['filter is required'] });
  });

  it('an array is not an object: the type check says so, once', () => {
    expect(validateParameters({ filter: [1] }, optional)).toEqual({ valid: false, errors: ['filter must be of type object, got array'] });
  });

  it('an object is valid', () => {
    expect(validateParameters({ filter: { a: 1 } }, optional)).toEqual({ valid: true, errors: [] });
  });
});
