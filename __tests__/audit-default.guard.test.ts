/**
 * Audit level `security` by default (#333): the code, every .env example, the
 * gateway compose file and the docs say the same. The servers' own default is
 * tested in client-config.test.ts and, per server, in client-config.guard.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';

/** The file with \n line ends: a Windows checkout has \r\n. */
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

/** The root and gateway examples, one per server, and the template's. */
const EXAMPLES = [
  '.env.example',
  '.env.gateway.example',
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-(mcp|template)$/.test(d)).map((d) => `${d}/.env.example`),
];

describe('audit level default', () => {
  it('covers the 16 examples', () => {
    expect(EXAMPLES).toHaveLength(16);
  });

  it.each(EXAMPLES)('%s sets security', (file) => {
    expect(read(file)).toMatch(/^BCONNECT_AUDIT_LEVEL=security$/m);
  });

  it('the gateway compose file falls back to security', () => {
    expect(read('docker-compose.gateway.yml')).toContain('BCONNECT_AUDIT_LEVEL: ${BCONNECT_AUDIT_LEVEL:-security}');
  });

  it('the gateway builds its clients from the environment, so it gets the same default', () => {
    expect(read('bconnect-mcp-gateway/src/gateway.ts')).toContain('new BConnectClientBase(clientConfigFromEnv(process.env))');
  });

  it('CONFIGURATION.md and AUDIT.md name security as the default', () => {
    expect(read('docs/CONFIGURATION.md')).toContain('### `BCONNECT_AUDIT_LEVEL`\n\n**Default:** `security`.');
    expect(read('docs/AUDIT.md')).toContain('| `security` (default) |');
    expect(read('docs/AUDIT.md')).not.toContain('`none` (default)');
  });
});
