/**
 * Audit-log parameter redaction must redact credentials and nothing else (A4).
 *
 * The defect: one unanchored alternation,
 *
 *   /(pass|pwd|secret|credential|token|apikey|api[-_]?key|authorization|pin)/i
 *
 * tested against the raw key name, so any parameter whose name merely contained
 * one of those letter runs was replaced with `[redacted]` — `mapping`,
 * `spinner`, `pinned`, `passenger`, `compass`, `tokenizer`. `BCONNECT_AUDIT_INCLUDE_PARAMS`
 * exists so a write record can say what was changed; a record where `mapping`
 * reads `[redacted]` cannot, and teaches operators to ignore the marker.
 *
 * Both halves matter and are asserted separately: over-redaction is the bug,
 * under-redaction would be a security regression.
 */

import { describe, it, expect } from 'vitest';
import { redactSensitiveParameters, isSensitiveParameterName } from '@bconnect/mcp-core';

/** Names that must survive. Every one of these was redacted before A4. */
const INNOCENT = [
  'mapping',
  'Mapping',
  'spinner',
  'pinned',
  'unpinned',
  'passenger',
  'compass',
  'tokenizer',
  'passed',
  'bypass',
  'surpassed',
  'displayName',
  'PageSize',
];

/** Names that must be redacted. */
const CREDENTIAL_SHAPED = [
  'password',
  'Password',
  'newPassword',
  'passwords',
  'passphrase',
  'pwd',
  'pin',
  'Pin',
  'PIN',
  'startupPin',
  'bitlockerPin',
  'secret',
  'clientSecret',
  'credential',
  'credentials',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'ApiKey',
  'APIKey',
  'api_key',
  'x-api-key',
  'authorization',
  'Authorization',
];

describe('isSensitiveParameterName', () => {
  it.each(INNOCENT)('leaves %s alone', (name) => {
    expect(isSensitiveParameterName(name)).toBe(false);
  });

  it.each(CREDENTIAL_SHAPED)('flags %s', (name) => {
    expect(isSensitiveParameterName(name)).toBe(true);
  });

  it('matches inside a JSON-Pointer path as well as a bare key', () => {
    expect(isSensitiveParameterName('/password')).toBe(true);
    expect(isSensitiveParameterName('/localAdministrator/password')).toBe(true);
    expect(isSensitiveParameterName('/Pin')).toBe(true);
    expect(isSensitiveParameterName('/mapping')).toBe(false);
    expect(isSensitiveParameterName('/displayName')).toBe(false);
  });
});

describe('redactSensitiveParameters', () => {
  it('keeps the values of innocently named parameters', () => {
    const input = {
      mapping: 'group-to-ou',
      spinner: 'off',
      pinned: true,
      passenger: 'seat 12A',
      tokenizer: 'whitespace',
      compass: 'north',
    };

    expect(redactSensitiveParameters(input)).toEqual(input);
  });

  it('still redacts every credential-shaped key', () => {
    const redacted = redactSensitiveParameters({
      password: 'hunter2',
      newPassword: 'hunter3',
      apiKey: 'ak-1',
      accessToken: 'tk-1',
      clientSecret: 'cs-1',
      startupPin: '123456',
      Authorization: 'Basic abc',
    }) as Record<string, unknown>;

    for (const value of Object.values(redacted)) {
      expect(value).toBe('[redacted]');
    }
  });

  it('redacts nested credentials without flattening their innocent siblings', () => {
    const redacted = redactSensitiveParameters({
      mapping: 'keep-me',
      nested: { pinned: false, bitlockerPin: '654321' },
    }) as { mapping: unknown; nested: Record<string, unknown> };

    expect(redacted.mapping).toBe('keep-me');
    expect(redacted.nested.pinned).toBe(false);
    expect(redacted.nested.bitlockerPin).toBe('[redacted]');
  });

  it('still redacts a JSON Patch that names the secret in `path`', () => {
    const patched = redactSensitiveParameters([
      { op: 'replace', path: '/displayName', value: 'WORKSTATION1' },
      { op: 'replace', path: '/mapping', value: 'group-to-ou' },
      { op: 'replace', path: '/password', value: 'hunter2' },
      { op: 'replace', path: '/Pin', value: '123456' },
    ]) as Array<Record<string, unknown>>;

    expect(patched[0].value).toBe('WORKSTATION1');
    expect(patched[1].value).toBe('group-to-ou');
    expect(patched[2].value).toBe('[redacted]');
    expect(patched[3].value).toBe('[redacted]');
  });
});
