/**
 * Every tool refuses an argument it doesn't declare (REQ-SRV-022, #163).
 *
 * Every tool of every server, for both releases, is called with its required
 * arguments plus one undeclared argument. The call must be refused with an
 * error that names the argument and lists the accepted ones, and no request
 * may reach bConnect. Every advertised input schema says
 * `additionalProperties: false`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELEASES } from './lib/spec.js';
import { SERVERS, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

const UNDECLARED = 'zzUndeclaredArgument';
const recorder = createRecorder();
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

describe.each(RELEASES)('bMS %s', (release) => {
  const found: Array<{ tool: string; open: boolean; refused: boolean; named: boolean; listed: boolean; sent: number }> = [];

  beforeAll(async () => {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    for (const server of SERVERS) {
      const conn = await connect(server);
      for (const tool of conn.tools) {
        const declared = Object.keys(tool.inputSchema.properties ?? {});
        recorder.take();
        const r = await conn.call(tool.name, { ...requiredArguments(tool.inputSchema), [UNDECLARED]: 'x' });
        found.push({
          tool: `${server} ${tool.name}`,
          open: tool.inputSchema.additionalProperties !== false,
          refused: r.isError,
          named: r.text.includes(`Unknown argument for ${tool.name}: ${UNDECLARED}.`),
          listed: declared.length === 0 ? r.text.includes('This tool takes no arguments.') : r.text.includes(`This tool accepts: ${declared.join(', ')}.`),
          sent: recorder.take().length,
        });
      }
      await conn.close();
    }
  }, 300_000);

  it('calls every tool', () => {
    expect(found.length).toBeGreaterThan(200);
  });

  it('refuses every call with an undeclared argument, before any request', () => {
    expect(found.filter((f) => !f.refused || f.sent > 0).map((f) => `${f.tool} (requests: ${f.sent})`)).toEqual([]);
  });

  it('names the undeclared argument and lists the accepted ones', () => {
    expect(found.filter((f) => !f.named || !f.listed).map((f) => f.tool)).toEqual([]);
  });

  it('advertises additionalProperties: false on every input schema', () => {
    expect(found.filter((f) => f.open).map((f) => f.tool)).toEqual([]);
  });
});
