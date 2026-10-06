/**
 * The root build script builds the shared core first (#273). The servers import
 * @bconnect/mcp-core from packages/mcp-core/build; without it in the script, a
 * plain `npm run build` left an outdated core in place and nothing noticed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVERS } from './lib/exerciser.js';

const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

describe('root build script', () => {
  it('builds @bconnect/mcp-core first and builds no server if that fails', () => {
    expect(scripts.build).toMatch(/^npm run build -w @bconnect\/mcp-core && /);
  });

  it('then builds every server and the template, stopping at the first failure', () => {
    expect(scripts.build).toContain('for d in bconnect-*-mcp bconnect-server-template; do (cd "$d" && npm run build) || exit 1; done');
  });
});

describe('builds that fail leave no output behind', () => {
  // tsc writes its output even when there are type errors. A failed build would
  // then look current to the live tier's freshness check; with noEmitOnError
  // the old output stays and the newer sources mark it outdated.
  it.each(['packages/mcp-core', ...SERVERS, 'bconnect-server-template'])('%s compiles with noEmitOnError', (pkg) => {
    const config = JSON.parse(readFileSync(join(ROOT, pkg, 'tsconfig.json'), 'utf8')) as { compilerOptions?: Record<string, unknown> };
    expect(config.compilerOptions?.noEmitOnError).toBe(true);
  });
});

describe('other build paths use the root build script', () => {
  it.each([
    ['bconnect-mcp-gateway/Dockerfile'],
    ['scripts/release.sh'],
  ])('%s builds the core once, through `npm run build`', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).toMatch(/npm run build/);
    expect(text).not.toMatch(/npm run build -w @bconnect\/mcp-core/);
  });
});
