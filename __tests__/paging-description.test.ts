/**
 * Every paging argument uses the one shared description (#169 AC 2).
 *
 * A tool that writes its own Page or PageSize text can drift (one said pages
 * start at 1). Each Page property must equal PAGE_PROPERTY, each PageSize
 * property must come from pageSizeProperty(), in every server and release.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGE_PROPERTY, pageSizeProperty } from '../packages/mcp-core/src/paging.js';
import { RELEASES } from './lib/spec.js';
import { SERVERS, connect, guardEnv } from './lib/exerciser.js';

const saved = { ...process.env };
afterAll(() => { process.env = saved; });

const isSharedPageSize = (p: { type?: string; description?: string }): boolean => {
  const size = /\(default (\d+), max 1000\)/.exec(p.description ?? '')?.[1];
  return size !== undefined && JSON.stringify(p) === JSON.stringify(pageSizeProperty(Number(size)));
};

describe.each(RELEASES)('bMS %s', (release) => {
  const found: Array<{ where: string; name: string; property: { type?: string; description?: string } }> = [];

  beforeAll(async () => {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    for (const server of SERVERS) {
      const conn = await connect(server);
      for (const tool of conn.tools) {
        for (const [name, property] of Object.entries(tool.inputSchema.properties ?? {})) {
          if (/^page(size)?$/i.test(name)) {
            found.push({ where: `${server} ${tool.name}`, name, property });
          }
        }
      }
      await conn.close();
    }
  }, 120_000);

  it('finds paging arguments', () => {
    expect(found.length).toBeGreaterThan(100);
  });

  it('describes every Page with PAGE_PROPERTY', () => {
    expect(found.filter((f) => /^page$/i.test(f.name) && JSON.stringify(f.property) !== JSON.stringify(PAGE_PROPERTY))
      .map((f) => `${f.where} ${f.name}`)).toEqual([]);
  });

  it('describes every PageSize with pageSizeProperty()', () => {
    expect(found.filter((f) => /^pagesize$/i.test(f.name) && !isSharedPageSize(f.property))
      .map((f) => `${f.where} ${f.name}`)).toEqual([]);
  });
});
