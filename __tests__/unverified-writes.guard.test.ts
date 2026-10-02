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
import { SERVERS, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

const recorder = createRecorder();
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

describe.each(RELEASES)('bMS %s', (release) => {
  const found: Array<{ server: string; tool: string; writes: boolean; described: boolean }> = [];

  beforeAll(async () => {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    for (const server of SERVERS) {
      const conn = await connect(server);
      for (const tool of conn.tools) {
        recorder.take();
        await conn.call(tool.name, requiredArguments(tool.inputSchema));
        const writes = recorder.take().some((r) => r.method !== 'GET');
        found.push({ server, tool: tool.name, writes, described: (tool.description ?? '').endsWith(UNVERIFIED_WRITE_NOTE) });
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

  it('keeps the live-verified list to existing write tools', () => {
    const writeTools = new Set(found.filter((f) => f.writes).map((f) => f.tool));
    expect([...LIVE_VERIFIED_WRITE_TOOLS.keys()].filter((t) => !writeTools.has(t))).toEqual([]);
  });
});
