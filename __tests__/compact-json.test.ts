/**
 * Every tool returns compact JSON by default (REQ-SRV-025 AC 1, AC 2; #164).
 *
 * Each tool of the 13 servers is called twice with the same answer from bMS:
 * once with BCONNECT_PRETTY_JSON unset, once with it set to true. A result is
 * an optional lead line ("… updated:") followed by JSON, or prose. Per tool:
 * the lead lines are the same, both JSON parts parse to the same value, the
 * default one is compact and the other one has today's two-space format.
 * Prose and error results don't change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELEASES } from './lib/spec.js';
import { ID, SERVERS, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

/** What bMS answers to every request: nested, so indentation shows. */
const ANSWER = {
  id: ID,
  name: 'Guard',
  nested: { list: [1, 2], flag: true, none: null },
  data: [{ id: ID, value: 'x' }],
  totalItems: 1,
};

const recorder = createRecorder(() => ANSWER);
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

interface Parts { lead?: string; json?: unknown; jsonText?: string; prose?: string }

/** A result text split into an optional lead line and its JSON, or prose when it holds no JSON. */
function parts(text: string): Parts {
  const whole = parse(text);
  if (whole.ok) return { json: whole.value, jsonText: text };
  const newline = text.indexOf('\n');
  if (newline >= 0) {
    const rest = text.slice(newline + 1);
    const tail = parse(rest);
    if (tail.ok) return { lead: text.slice(0, newline), json: tail.value, jsonText: rest };
  }
  return { prose: text };
}

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** The text of a call's first content item, or the whole serialised result for a protocol error. */
const textOf = (result: { text: string; code?: number }): string => {
  if (result.code !== undefined) return result.text;
  const content = JSON.parse(result.text) as Array<{ text?: string }>;
  return content.map((c) => c.text ?? '').join('');
};

describe.each(RELEASES)('bMS %s', (release) => {
  const calls: Array<{ tool: string; isError: boolean; compact: string; pretty: string }> = [];

  beforeAll(async () => {
    for (const server of SERVERS) {
      const conn = await connect(server);
      for (const tool of conn.tools) {
        const args = requiredArguments(tool.inputSchema);
        const run = async (pretty: string) => {
          Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }), { BCONNECT_PRETTY_JSON: pretty });
          return conn.call(tool.name, args);
        };
        const compact = await run('');
        const pretty = await run('true');
        calls.push({ tool: `${server} ${tool.name}`, isError: compact.isError || pretty.isError, compact: textOf(compact), pretty: textOf(pretty) });
      }
      await conn.close();
    }
  }, 300_000);

  const ok = () => calls.filter((c) => !c.isError);
  const withJson = () => ok().filter((c) => parts(c.compact).jsonText !== undefined);

  it('calls tools that return JSON (not vacuous)', () => {
    expect(withJson().length).toBeGreaterThanOrEqual(200);
  });

  it('keeps the data: both forms parse to the same value, after the same lead line', () => {
    const differ = withJson().filter((c) => {
      const a = parts(c.compact);
      const b = parts(c.pretty);
      return a.lead !== b.lead || JSON.stringify(a.json) !== JSON.stringify(b.json);
    }).map((c) => c.tool);
    expect(differ).toEqual([]);
  });

  it('returns compact JSON by default', () => {
    const indented = withJson().filter((c) => {
      const { json, jsonText } = parts(c.compact);
      return jsonText !== JSON.stringify(json);
    }).map((c) => c.tool);
    expect(indented).toEqual([]);
  });

  it('returns today\'s two-space format with BCONNECT_PRETTY_JSON=true', () => {
    const other = withJson().filter((c) => {
      const { json, jsonText } = parts(c.pretty);
      return jsonText !== JSON.stringify(json, null, 2);
    }).map((c) => c.tool);
    expect(other).toEqual([]);
  });

  it('leaves prose and error results unchanged', () => {
    const changed = calls.filter((c) => (c.isError || parts(c.compact).prose !== undefined) && c.compact !== c.pretty)
      .map((c) => c.tool);
    expect(changed).toEqual([]);
  });
});
