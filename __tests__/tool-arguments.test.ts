/**
 * Typed tool arguments (REQ-QA-002, cast ban): objects and JSON Patch lists
 * are checked at runtime and refused with InvalidParams when malformed.
 */
import { describe, expect, it } from 'vitest';
import { jsonPatchArgument, objectArgument } from '../packages/mcp-core/src/tool-arguments.js';

describe('objectArgument', () => {
  it('returns a plain object as is', () => {
    expect(objectArgument({ name: 'x' }, 'data')).toEqual({ name: 'x' });
  });
  it.each([[null], [[]], ['x'], [1], [undefined]])('refuses %j, naming the argument', (value) => {
    expect(() => objectArgument(value, 'maintenanceWindowData')).toThrow(/maintenanceWindowData must be an object/);
  });
});

describe('jsonPatchArgument', () => {
  it('keeps op, path, value and from', () => {
    expect(jsonPatchArgument([
      { op: 'replace', path: '/name', value: 'x' },
      { op: 'move', path: '/a', from: '/b' },
      { op: 'remove', path: '/c' },
    ], 'patchOperations')).toEqual([
      { op: 'replace', path: '/name', value: 'x' },
      { op: 'move', path: '/a', from: '/b' },
      { op: 'remove', path: '/c' },
    ]);
  });
  it('keeps an explicit null value', () => {
    expect(jsonPatchArgument([{ op: 'replace', path: '/comment', value: null }], 'p')).toEqual([{ op: 'replace', path: '/comment', value: null }]);
  });
  it('drops fields RFC 6902 does not define', () => {
    expect(jsonPatchArgument([{ op: 'add', path: '/x', value: 1, extra: true }], 'p')).toEqual([{ op: 'add', path: '/x', value: 1 }]);
  });
  it.each([
    ['not a list', { op: 'replace', path: '/x' }],
    ['an empty list', []],
    ['an unknown op', [{ op: 'merge', path: '/x' }]],
    ['a missing path', [{ op: 'replace', value: 1 }]],
    ['a non-object entry', ['replace /x']],
  ])('refuses %s', (_label, value) => {
    expect(() => jsonPatchArgument(value, 'patchOperations')).toThrow(/patchOperations/);
  });
  it('does not inherit op names from Object.prototype', () => {
    expect(() => jsonPatchArgument([{ op: 'constructor', path: '/x' }], 'p')).toThrow();
  });
});
