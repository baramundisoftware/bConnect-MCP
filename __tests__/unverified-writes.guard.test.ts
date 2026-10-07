/**
 * Write tools say they're unverified until checked live (REQ-XC-003 AC 5).
 *
 * A write tool counts as done only with a recorded live verification. Until
 * then its description ends with UNVERIFIED_WRITE_NOTE. Write tools are found
 * from the traffic, not a hand list: a tool that sends anything but GET when
 * called with valid arguments is a write tool. The record of live checks is
 * LIVE_VERIFIED_WRITE_TOOLS in the core (and the table in Tasks.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_VERIFIED_WRITE_TOOLS, UNVERIFIED_WRITE_NOTE } from '../packages/mcp-core/src/unverified-writes.js';
import { RELEASES } from './lib/spec.js';
import { SERVERS, callsOf, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';
import { describeVariant, variantOf } from './lib/variants.js';

/** The note a merged write tool ends with when only some of its routes are unverified (REQ-SRV-029). */
const PARTIAL = UNVERIFIED_WRITE_NOTE.replace(/\.$/, '') + ' for: ';

/** Whether a route is marked: the whole tool carries the note, or the merged tool names this route. */
function marked(description: string, key: string): boolean {
  if (description.endsWith(UNVERIFIED_WRITE_NOTE)) {return true;}
  const { tool, select } = variantOf(key);
  const at = description.lastIndexOf(PARTIAL);
  return tool !== key && at >= 0 && description.slice(at + PARTIAL.length).replace(/\.$/, '').split('; ').includes(describeVariant(select));
}

const recorder = createRecorder();
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

/** Write tools found in either release: a release lists only the tools whose routes it has (#159). */
const writeToolsOfAnyRelease = new Set<string>();

describe.each(RELEASES)('bMS %s', (release) => {
  const found: Array<{ server: string; tool: string; writes: boolean; described: boolean }> = [];

  beforeAll(async () => {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    for (const server of SERVERS) {
      const conn = await connect(server);
      // Per route: a merged tool once per variant of the release, recorded by its key.
      for (const route of await callsOf(server, conn.tools, release)) {
        const description = String((conn.tools.find((t) => t.name === route.name) as { description?: string }).description ?? '');
        recorder.take();
        await conn.call(route.name, { ...requiredArguments(route.inputSchema), ...route.select });
        const writes = recorder.take().some((r) => r.method !== 'GET');
        found.push({ server, tool: route.key, writes, described: marked(description, route.key) });
        if (writes) {writeToolsOfAnyRelease.add(route.key);}
      }
      await conn.close();
    }
  }, 300_000);

  it('finds write tools', () => {
    expect(found.filter((f) => f.writes).length).toBeGreaterThan(50);
  });

  it('marks every write tool without a recorded live check', () => {
    const missing = found.filter((f) => f.writes && !LIVE_VERIFIED_WRITE_TOOLS.has(f.tool) && !f.described)
      .map((f) => `${f.server} ${f.tool}`);
    expect(missing).toEqual([]);
  });

  it('marks no read tool and no verified write tool', () => {
    const wrong = found.filter((f) => f.described && (!f.writes || LIVE_VERIFIED_WRITE_TOOLS.has(f.tool)))
      .map((f) => `${f.server} ${f.tool}`);
    expect(wrong).toEqual([]);
  });

});

describe('both releases', () => {
  it('keeps the live-verified list to existing write tools', () => {
    expect([...LIVE_VERIFIED_WRITE_TOOLS.keys()].filter((t) => !writeToolsOfAnyRelease.has(t))).toEqual([]);
  });
});
