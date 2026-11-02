/**
 * Production code builds protocol errors with the core's protocolError(), never
 * with the SDK's McpError directly (#326): a direct McpError reaches an SDK
 * client with the "MCP error <code>:" prefix twice.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib/exerciser.js';

/** The source trees that ship: the core, the 13 servers, the gateway, and the template new servers start from. */
const TREES = [
  'packages/mcp-core/src',
  'bconnect-server-template/src',
  'bconnect-mcp-gateway/src',
  ...readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d)).map((d) => `${d}/src`),
];
const HELPER = join('packages', 'mcp-core', 'src', 'protocol-errors.ts');

/** Lines that build an McpError directly. */
export function directMcpErrors(source: string): string[] {
  return source.split('\n').filter((line) => /\bnew McpError\s*\(|\bMcpError\.fromError\s*\(/.test(line)).map((line) => line.trim());
}

function productionFiles(): string[] {
  return TREES.flatMap((tree) => readdirSync(join(ROOT, tree), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.[mc]?ts$/.test(e.name) && !/\.d\.[mc]?ts$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)))
    .filter((f) => !/[\\/](__tests__|__mocks__)[\\/]/.test(f) && !/\.test\.ts$/.test(f)));
}

describe('protocol errors', () => {
  it('self-test: the scan finds a direct McpError and passes protocolError()', () => {
    expect(directMcpErrors('throw new McpError(ErrorCode.InvalidParams, "x");')).toHaveLength(1);
    expect(directMcpErrors('throw McpError.fromError(code, message);')).toHaveLength(1);
    expect(directMcpErrors('throw protocolError(ErrorCode.InvalidParams, "x");')).toEqual([]);
  });

  it('scans the core, every server, the gateway and the template', () => {
    const files = productionFiles();
    expect(files).toContain(HELPER);
    expect(files.filter((f) => /^bconnect-.+-mcp[\\/]src[\\/]index\.ts$/.test(f))).toHaveLength(13);
    expect(files.some((f) => f.startsWith('bconnect-mcp-gateway'))).toBe(true);
    expect(files.some((f) => f.startsWith('bconnect-server-template'))).toBe(true);
  });

  it('only the core helper constructs an McpError', () => {
    const offenders = productionFiles()
      .filter((f) => f !== HELPER)
      .flatMap((f) => directMcpErrors(readFileSync(join(ROOT, f), 'utf8')).map((line) => `${f}: ${line}`));
    expect(offenders, 'use protocolError() from @bconnect/mcp-core').toEqual([]);
  });

  it('the core helper is exported from @bconnect/mcp-core', () => {
    expect(readFileSync(join(ROOT, 'packages/mcp-core/src/index.ts'), 'utf8')).toContain('export * from "./protocol-errors.js";');
  });
});
