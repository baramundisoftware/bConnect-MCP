/**
 * The root build script builds the shared core first (#273). The servers import
 * @bconnect/mcp-core from packages/mcp-core/build; without it in the script, a
 * plain `npm run build` left an outdated core in place and nothing noticed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';

const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

describe('root build script', () => {
  it('builds @bconnect/mcp-core first and builds no server if that fails', () => {
    expect(scripts.build).toMatch(/^npm run build -w @bconnect\/mcp-core && /);
  });

  it('then builds every server and the template, stopping at the first failure', () => {
    expect(scripts.build).toContain('for d in bconnect-*-mcp bconnect-server-template; do (cd "$d" && npm run build) || exit 1; done');
  });
});
