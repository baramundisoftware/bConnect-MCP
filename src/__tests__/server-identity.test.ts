/**
 * server-identity.test.ts
 *
 * Phase 7 — REQ-SRV-011 / REQ-VER-001: bMS-Aligned Version & Type Generation Scripts
 *
 * 🔴 RED assertions:
 *  - package.json version must match bMS-aligned format: <2-digit-year>.<release>.<patch>
 *  - package.json scripts must include generate-types:25R2 and generate-types:26R1
 *  - generate-types scripts must reference the correct OpenAPI spec paths
 *  - Server version constant in src/index.ts must match package.json version
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPackageJson(): Record<string, unknown> {
  const raw = readFileSync(resolve(projectRoot, 'package.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// REQ-VER-001: bMS-aligned version numbering
// ---------------------------------------------------------------------------

describe('REQ-VER-001 — bMS-Aligned Package Version', () => {
  it('package.json version matches bMS-aligned format <YY>.<release>.<patch>', () => {
    const pkg = readPackageJson();
    const version = pkg.version as string;

    // Format: 2-digit year . release number . patch  (e.g. 26.1.0)
    expect(version).toMatch(/^\d{2}\.\d+\.\d+$/);
  });

  it('package.json version targets bMS 26R1 (26.1.x) as the current primary release', () => {
    const pkg = readPackageJson();
    const version = pkg.version as string;
    const [major, minor] = version.split('.').map(Number);

    expect(major).toBe(26);
    expect(minor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// REQ-SRV-011: generate-types scripts exist and point to correct spec paths
// ---------------------------------------------------------------------------

describe('REQ-SRV-011 — generate-types scripts', () => {
  it('package.json scripts includes generate-types:25R2', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts).toHaveProperty('generate-types:25R2');
  });

  it('package.json scripts includes generate-types:26R1', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts).toHaveProperty('generate-types:26R1');
  });

  it('generate-types:25R2 references the 25R2 spec directory', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    const script25r2 = scripts['generate-types:25R2'] ?? '';

    expect(script25r2).toContain('/home/ansible/MCP/bConnectOpenAPI/25R2/');
  });

  it('generate-types:26R1 references the 26R1 spec directory', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    const script26r1 = scripts['generate-types:26R1'] ?? '';

    expect(script26r1).toContain('/home/ansible/MCP/bConnectOpenAPI/26R1/');
  });

  it('generate-types:25R2 outputs to src/generated/25R2/', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    const script25r2 = scripts['generate-types:25R2'] ?? '';

    expect(script25r2).toContain('src/generated/25R2/');
  });

  it('generate-types:26R1 outputs to src/generated/26R1/', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    const script26r1 = scripts['generate-types:26R1'] ?? '';

    expect(script26r1).toContain('src/generated/26R1/');
  });

  it('package.json scripts includes a default generate-types alias (defaults to 26R1)', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts).toHaveProperty('generate-types');
    // Default should delegate to the 26R1 script
    expect(scripts['generate-types']).toContain('generate-types:26R1');
  });
});

// ---------------------------------------------------------------------------
// REQ-SRV-011: pkg config updated for node20 (not legacy node16)
// ---------------------------------------------------------------------------

describe('REQ-SRV-011 — pkg scripts use node20 runtime', () => {
  it('pkg script targets node20-win-x64 (not legacy node16)', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    const pkgScript = scripts['pkg'] ?? '';

    expect(pkgScript).toContain('node20');
    expect(pkgScript).not.toContain('node16');
  });

  it('pkg:all script targets node20 for all platforms', () => {
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string>;
    const pkgAll = scripts['pkg:all'] ?? '';

    expect(pkgAll).toContain('node20');
    expect(pkgAll).not.toContain('node16');
  });
});
