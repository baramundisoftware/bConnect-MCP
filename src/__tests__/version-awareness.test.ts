/**
 * version-awareness.test.ts
 *
 * Phase 7 — REQ-SRV-011: BCONNECT_RELEASE env var awareness
 *
 * 🔴 RED assertions:
 *  - src/index.ts must read BCONNECT_RELEASE env var
 *  - Server name in index.ts must include the release string (e.g. "bconnect-mcp-server/26R1")
 *  - .env.example must document BCONNECT_RELEASE with default value 26R1
 *  - src/index.ts must conditionally load compliance and universaldynamicgroups
 *    only when BCONNECT_RELEASE=26R1 (they are absent from 25R2 spec)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');
const srcRoot = resolve(projectRoot, 'src');

function readFile(relPath: string): string {
  return readFileSync(resolve(projectRoot, relPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// REQ-SRV-011: index.ts reads BCONNECT_RELEASE
// ---------------------------------------------------------------------------

describe('REQ-SRV-011 — BCONNECT_RELEASE env var in src/index.ts', () => {
  it('src/index.ts reads the BCONNECT_RELEASE environment variable', () => {
    const indexTs = readFile('src/index.ts');

    expect(indexTs).toContain('BCONNECT_RELEASE');
  });

  it('src/index.ts defaults BCONNECT_RELEASE to "26R1" when env var is absent', () => {
    const indexTs = readFile('src/index.ts');

    // Default assignment must reference '26R1' as the fallback
    expect(indexTs).toContain('26R1');
    // Pattern: process.env.BCONNECT_RELEASE ?? '26R1'  OR  || '26R1'  OR  = '26R1'
    expect(indexTs).toMatch(/BCONNECT_RELEASE.*26R1|26R1.*BCONNECT_RELEASE/s);
  });

  it('src/index.ts embeds the release in the server name string', () => {
    const indexTs = readFile('src/index.ts');

    // Server name must include the release — e.g. "bconnect-mcp-server/26R1"
    // The name property must be a template literal containing a release variable,
    // NOT the plain string "bconnect-mcp-server" without a release suffix
    // Pattern: name: `bconnect-mcp-server/${...release...}`
    // Negative: should NOT be just name: "bconnect-mcp-server" with no release
    expect(indexTs).toMatch(/name:\s*`bconnect-mcp-server\/\$\{/);
  });

  it('src/index.ts conditionally loads compliance module only for 26R1', () => {
    const indexTs = readFile('src/index.ts');

    // compliance module/tools must be gated on the release variable
    // Acceptable patterns: if (release === '26R1') or release !== '25R2'
    expect(indexTs).toMatch(/compliance.*26R1|26R1.*compliance/si);
  });

  it('src/index.ts conditionally loads universaldynamicgroups module only for 26R1', () => {
    const indexTs = readFile('src/index.ts');

    // universaldynamicgroups tools must be gated on the release variable
    expect(indexTs).toMatch(/universaldynamic.*26R1|26R1.*universaldynamic/si);
  });
});

// ---------------------------------------------------------------------------
// REQ-SRV-011: .env.example documents BCONNECT_RELEASE
// ---------------------------------------------------------------------------

describe('REQ-SRV-011 — .env.example documents BCONNECT_RELEASE', () => {
  it('.env.example contains BCONNECT_RELEASE entry', () => {
    const envExample = readFile('.env.example');

    expect(envExample).toContain('BCONNECT_RELEASE');
  });

  it('.env.example sets BCONNECT_RELEASE default to 26R1', () => {
    const envExample = readFile('.env.example');

    // Must document the default: BCONNECT_RELEASE=26R1
    expect(envExample).toContain('BCONNECT_RELEASE=26R1');
  });

  it('.env.example documents 25R2 as the alternative value (in a comment)', () => {
    const envExample = readFile('.env.example');

    // Users on 25R2 need to know to change this
    expect(envExample).toMatch(/25R2/);
  });
});

// ---------------------------------------------------------------------------
// REQ-SRV-011: server version in index.ts matches package.json version
// ---------------------------------------------------------------------------

describe('REQ-SRV-011 — Server version matches package.json', () => {
  it('server version constant in index.ts matches package.json version', () => {
    const indexTs = readFile('src/index.ts');
    const pkg = JSON.parse(readFile('package.json')) as { version: string };

    // The version advertised in the MCP handshake must match package.json
    // This is checked by asserting the package.json version appears in index.ts
    // (either hardcoded or imported)
    expect(indexTs).toContain(pkg.version);
  });
});
