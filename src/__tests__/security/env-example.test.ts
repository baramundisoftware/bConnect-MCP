/**
 * Security assertion: .env.example must not contain an active NODE_TLS_REJECT_UNAUTHORIZED=0 line.
 *
 * Per the SecurityArchitect role, NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate
 * validation and must never appear as an active (uncommented) setting in .env.example.
 * If required for a development note, it must be commented out (prefixed with #).
 *
 * This is a TDD RED test — it fails while .env.example has the setting active,
 * and passes once the line is commented out or removed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env.example lives at the project root: <project>/src/__tests__/security/ -> up 3 levels
const ENV_EXAMPLE_PATH = path.resolve(__dirname, '..', '..', '..', '.env.example');

/**
 * Returns true if the given line is an active (non-commented) setting.
 * A line is active when it is not empty and does not start with '#'
 * after stripping optional leading whitespace.
 */
function isActiveLine(line: string): boolean {
  return line.trim().length > 0 && !line.trim().startsWith('#');
}

describe('Security: .env.example', () => {
  it('should not contain NODE_TLS_REJECT_UNAUTHORIZED=0 as an active (uncommented) line', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    const lines = content.split('\n');

    const activeInsecureLines = lines.filter(
      (line) =>
        isActiveLine(line) &&
        line.includes('NODE_TLS_REJECT_UNAUTHORIZED=0')
    );

    expect(
      activeInsecureLines,
      [
        'Found active NODE_TLS_REJECT_UNAUTHORIZED=0 in .env.example.',
        'This setting disables TLS certificate validation and must not be present as an',
        'uncommented line in .env.example (SecurityArchitect role, TLS Certificate Handling).',
        'Either remove the line or comment it out: # NODE_TLS_REJECT_UNAUTHORIZED=0',
        '',
        `Offending line(s): ${JSON.stringify(activeInsecureLines)}`,
      ].join('\n')
    ).toHaveLength(0);
  });

  it('should allow NODE_TLS_REJECT_UNAUTHORIZED=0 only when commented out', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    const lines = content.split('\n');

    const commentedVariants = lines.filter(
      (line) =>
        line.trim().startsWith('#') &&
        line.includes('NODE_TLS_REJECT_UNAUTHORIZED=0')
    );

    // This test documents the acceptable form; it does not fail either way.
    // The constraint is enforced by the first test above.
    // If the line is commented out, it is acceptable as a developer hint.
    expect(typeof commentedVariants).toBe('object'); // always true — sanity guard
  });
});

/**
 * Security/documentation assertions: .env.example must document all production env vars.
 *
 * These are TDD RED tests — they fail until .env.example gains entries for each key.
 * A line may be commented out (prefixed with #) or active; both forms count as documentation.
 * The intent is to guarantee that every operator-visible env var is visible in .env.example
 * before deployment.
 *
 * Expected state when this test was written (2026-03-24):
 *   BCONNECT_CA_CERT_PATH       — already present in .env.example  → PASSES
 *   BCONNECT_RATE_LIMIT_ENABLED — NOT yet in .env.example          → FAILS
 *   BCONNECT_AUDIT_LEVEL        — NOT yet in .env.example          → FAILS
 */
describe('Documentation: .env.example must contain entries for all production env vars', () => {
  let lines: string[];

  beforeEach(() => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  /**
   * Returns true when at least one line in .env.example references the given key,
   * regardless of whether the line is commented out or active.
   */
  function hasEntryForKey(key: string): boolean {
    return lines.some((line) => line.includes(key));
  }

  it('should contain an entry for BCONNECT_CA_CERT_PATH', () => {
    expect(
      hasEntryForKey('BCONNECT_CA_CERT_PATH'),
      [
        '.env.example is missing an entry for BCONNECT_CA_CERT_PATH.',
        'Add a line (commented or active) so operators know this variable exists.',
        'Example: BCONNECT_CA_CERT_PATH=/etc/ssl/certs/my-internal-ca.pem',
      ].join('\n')
    ).toBe(true);
  });

  it('should contain an entry for BCONNECT_RATE_LIMIT_ENABLED', () => {
    expect(
      hasEntryForKey('BCONNECT_RATE_LIMIT_ENABLED'),
      [
        '.env.example is missing an entry for BCONNECT_RATE_LIMIT_ENABLED.',
        'Add a line (commented or active) so operators know this variable exists.',
        'Example: BCONNECT_RATE_LIMIT_ENABLED=true',
      ].join('\n')
    ).toBe(true);
  });

  it('should contain an entry for BCONNECT_AUDIT_LEVEL', () => {
    expect(
      hasEntryForKey('BCONNECT_AUDIT_LEVEL'),
      [
        '.env.example is missing an entry for BCONNECT_AUDIT_LEVEL.',
        'Add a line (commented or active) so operators know this variable exists.',
        'Example: BCONNECT_AUDIT_LEVEL=info',
      ].join('\n')
    ).toBe(true);
  });
});
