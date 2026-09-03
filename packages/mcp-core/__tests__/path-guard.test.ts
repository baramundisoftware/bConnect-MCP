/**
 * Path traversal in tool ID parameters (SEC-0 / upstream C1).
 *
 * The live reproduction these tests stand in for, read-only against the
 * labcorp.local bMS 26R1 estate:
 *
 *   get_endpoint       { id: "../LogicalGroups" }                       -> 19 logical groups
 *   get_endpoint       { id: "../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints" }
 *                                                                       -> 23 BitLocker records
 *   get_job_definition { id: "../../../servermanagement/v2.0/ApiKeys" } -> the API-key inventory
 *
 * Imported from the built package rather than from src/, because that is what
 * the thirteen servers resolve `@bconnect/mcp-core` to.
 */

import { describe, it, expect } from 'vitest';
import {
  assertSafePathSegment,
  encodePathSegment,
  findPathEscape,
  assertRequestPathContained,
  UnsafePathSegmentError,
  PathContainmentError,
  RequestBlockedError,
} from '@bconnect/mcp-core';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

describe('assertSafePathSegment', () => {
  it('accepts the ids the API actually issues', () => {
    for (const id of [
      'e57a7e00-0000-4000-8000-000000000009',
      '2f1a3f5e4b6c4d7e8f901a2b3c4d5e6f',
      'WORKSTATION1',
      'Standard Software Bundle',
      'a.b.c',
    ]) {
      expect(assertSafePathSegment(id)).toBe(id);
    }
  });

  it('rejects the three payloads that worked live', () => {
    for (const payload of [
      '../LogicalGroups',
      '../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints',
      '../../../servermanagement/v2.0/ApiKeys',
    ]) {
      expect(() => assertSafePathSegment(payload)).toThrow(UnsafePathSegmentError);
    }
  });

  it('rejects separators, backslashes and bare traversal', () => {
    for (const payload of ['a/b', 'a\\b', '..', 'x..y', '/etc/passwd']) {
      expect(() => assertSafePathSegment(payload)).toThrow(UnsafePathSegmentError);
    }
  });

  it('rejects percent-encoded and double-encoded traversal', () => {
    for (const payload of [
      '%2e%2e%2fLogicalGroups',
      '%2E%2E/LogicalGroups',
      '..%2fLogicalGroups',
      '%252e%252e%252fLogicalGroups',
      '%5c..%5c',
    ]) {
      expect(() => assertSafePathSegment(payload)).toThrow(UnsafePathSegmentError);
    }
  });

  it('rejects empty, non-string and control-character values', () => {
    expect(() => assertSafePathSegment('')).toThrow(UnsafePathSegmentError);
    expect(() => assertSafePathSegment(undefined)).toThrow(UnsafePathSegmentError);
    expect(() => assertSafePathSegment(null)).toThrow(UnsafePathSegmentError);
    expect(() => assertSafePathSegment(42)).toThrow(UnsafePathSegmentError);
    expect(() => assertSafePathSegment({ id: 'x' })).toThrow(UnsafePathSegmentError);
    expect(() => assertSafePathSegment('a\nb')).toThrow(UnsafePathSegmentError);
  });

  it('reports InvalidParams (-32602), matching the servers that do validate', () => {
    // defensecontrol's get_bitlocker_windows_endpoint already answers the same
    // payload with "MCP error -32602: endpointId must be a valid GUID". A tool
    // that only has this guard must land in the same channel.
    try {
      assertSafePathSegment('../LogicalGroups', 'endpointId');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RequestBlockedError);
      expect((err as { code: number }).code).toBe(ErrorCode.InvalidParams);
      expect((err as Error).message).toContain('endpointId');
    }
  });

  it('does not echo control characters back into the error message', () => {
    const bell = String.fromCharCode(7);
    try {
      assertSafePathSegment(`a${bell}/b`);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(bell);
    }
  });
});

describe('encodePathSegment', () => {
  it('encodes what it accepts', () => {
    expect(encodePathSegment('Standard Software Bundle')).toBe('Standard%20Software%20Bundle');
    expect(encodePathSegment('a+b')).toBe('a%2Bb');
  });

  it('still refuses what assertSafePathSegment refuses', () => {
    expect(() => encodePathSegment('../LogicalGroups')).toThrow(UnsafePathSegmentError);
  });
});

describe('request path containment', () => {
  it('permits the real routes, including legitimate cross-module traffic', () => {
    for (const url of [
      '/endpoints/v2.0/Endpoints',
      '/endpoints/v2.0/Endpoints/e57a7e00-0000-4000-8000-000000000009',
      // stale-endpoints.ts calls this from the *endpoints* server on purpose.
      '/jobs/v2.0/JobInstances',
      '/compliance/v2.0/Vulnerabilities',
      '/endpoints/v2.0/Endpoints/Standard%20Software%20Bundle',
    ]) {
      expect(findPathEscape(url)).toBeNull();
      expect(() => assertRequestPathContained(url)).not.toThrow();
    }
  });

  it('blocks a path that escapes the module it was written against', () => {
    for (const url of [
      '/endpoints/v2.0/Endpoints/../LogicalGroups',
      '/endpoints/v2.0/Endpoints/../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints',
      '/jobs/v2.0/JobDefinitions/%2e%2e%2f%2e%2e%2fservermanagement/v2.0/ApiKeys',
      '/endpoints/v2.0/Endpoints/..\\..\\LogicalGroups',
    ]) {
      expect(findPathEscape(url)).toBe('..');
      expect(() => assertRequestPathContained(url)).toThrow(PathContainmentError);
    }
  });

  it('ignores the query string, which cannot change the addressed resource', () => {
    expect(() => assertRequestPathContained('/endpoints/v2.0/Endpoints?SearchQuery=..')).not.toThrow();
  });
});
