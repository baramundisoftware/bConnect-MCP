/**
 * One source for the bMS release (REQ-SRV-028 AC 4, #159, ADR-0014).
 *
 * Every release-dependent decision asks the core's `selectedRelease()`, which
 * knows the detected release. A server, the template or the gateway reading
 * BCONNECT_RELEASE itself would ignore detection, so this guard fails on any
 * such read in production code. Only the core's release selection and its
 * settings check (client-config.ts) read the variable. Text that merely names
 * the variable (a message, a comment) is not a read.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lib/exerciser.js';

const ALLOWED = new Set(['packages/mcp-core/src/release.ts', 'packages/mcp-core/src/client-config.ts']);

/** `.BCONNECT_RELEASE`, `["BCONNECT_RELEASE"]` or a destructured `{ BCONNECT_RELEASE }`: a read of the variable. */
function reads(source: string): number[] {
  const lines = source.split('\n');
  return lines.flatMap((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    const read = code.includes('.BCONNECT_RELEASE') || /\[\s*["'`]BCONNECT_RELEASE["'`]\s*\]/.test(code) || /\{[^}]*\bBCONNECT_RELEASE\b[^}]*\}\s*=/.test(code);
    return read ? [i + 1] : [];
  });
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {return entry.name === '__tests__' || entry.name === 'generated' ? [] : sources(path);}
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const PRODUCTION = [
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d) || d === 'bconnect-server-template').map((d) => join(ROOT, d, 'src')),
  join(ROOT, 'packages', 'mcp-core', 'src'),
  join(ROOT, 'bconnect-mcp-gateway', 'src'),
].flatMap(sources);

describe('BCONNECT_RELEASE is read only by the core release selection', () => {
  it('finds reads in known-bad code (the guard is not blind)', () => {
    expect(reads('const r = process.env.BCONNECT_RELEASE ?? "26R1";')).toEqual([1]);
    expect(reads('x\nconst r = env["BCONNECT_RELEASE"];')).toEqual([2]);
    expect(reads('const { BCONNECT_RELEASE } = process.env;')).toEqual([1]);
    expect(reads('// process.env.BCONNECT_RELEASE in a comment\nthrow new Error("Set BCONNECT_RELEASE=26R1");')).toEqual([]);
  });

  it('no production file outside the core release selection reads it', () => {
    expect(PRODUCTION.length).toBeGreaterThan(50);
    const found = PRODUCTION.filter((file) => !ALLOWED.has(relative(ROOT, file).split('\\').join('/')))
      .flatMap((file) => reads(readFileSync(file, 'utf8')).map((line) => `${relative(ROOT, file)}:${line}`));
    expect(found).toEqual([]);
  });
});
