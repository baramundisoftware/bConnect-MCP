/**
 * Tool names follow the naming convention (docs/TOOL_NAMING.md, #342).
 *
 * Every tool every server lists, in every release, is checked:
 * - snake_case `<verb>_<object>[_by_<parent>]`, the verb from the convention's list;
 * - a list never uses `_for_` or `_in_` (a list restricted to a parent ends in `_by_<parent>`);
 * - a get/update/delete tool names its own object's ID `id`; a tool whose object has no ID of its
 *   own takes the owner's ID and is listed in OWNER_ID with the reason.
 * And every renamed tool and argument (each server's src/replaced-tools.ts) answers with its new
 * name, is not listed, and sends nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SERVERS, connect, createRecorder, guardEnv, type ConnectedServer } from './lib/exerciser.js';
import { RELEASES } from './lib/spec.js';

/** The convention's verbs (docs/TOOL_NAMING.md); add one to both together. */
const VERBS = ['list', 'get', 'create', 'update', 'delete', 'add', 'replace', 'assign', 'link', 'unlink', 'start', 'stop',
  'restart', 'resume', 'cancel', 'run', 'simulate', 'trigger', 'refresh', 'withdraw'];

/** Tools whose object belongs to another one and has no ID of its own: they take the owner's ID. */
const OWNER_ID: Readonly<Record<string, string>> = {
  get_bitlocker_secrets: 'the BitLocker secrets of an endpoint',
  update_bitlocker_pin: 'the BitLocker PIN of an endpoint',
  get_local_admin_accounts: 'the local admin accounts (LAPS) of an endpoint',
  update_local_admin_credentials: 'the local admin credentials (LAPS) of an endpoint',
  get_access_rights: 'the access rights of any bMS object',
  get_entra_id_data: 'the Entra ID data of a device, by Entra ID device ID or bMS endpoint ID',
};

interface Listed { server: string; release: string; name: string; required: string[]; properties: string[] }
interface Renames { server: string; tools: Record<string, { tool: string; variant: string }>; args: Record<string, Record<string, string>> }

/** A plain rename (#342): the old name maps to a tool, not to a variant of a merged tool (#174, tested in *-merged-tools.test.ts). */
const plain = (tools: Renames['tools']): Array<[string, string]> => Object.entries(tools).filter(([, r]) => r.variant === r.tool).map(([old, r]) => [old, r.tool]);

const listed: Listed[] = [];
const renames: Renames[] = [];
const refusals: Array<{ server: string; kind: 'tool' | 'argument'; old: string; text: string; code?: number; sent: number }> = [];
const recorder = createRecorder();
const saved = { ...process.env };

beforeAll(async () => {
  recorder.listen();
  for (const server of SERVERS) {
    const file = join(ROOT, server, 'src', 'replaced-tools.ts');
    const table = existsSync(file) ? await import(pathToFileURL(file).href) : {};
    const entry: Renames = { server, tools: table.REPLACED_TOOLS ?? {}, args: table.RENAMED_ARGUMENTS ?? {} };
    renames.push(entry);
    for (const release of RELEASES) {
      Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
      let conn: ConnectedServer;
      try {
        conn = await connect(server);
      } catch {
        continue; // a server with no API in this release (compliance, UDG on 25R2) stops at startup
      }
      for (const t of conn.tools) {
        listed.push({ server, release, name: t.name, required: (t.inputSchema.required ?? []) as string[], properties: Object.keys(t.inputSchema.properties ?? {}) });
      }
      if (release === '26R2') {
        for (const [old] of plain(entry.tools)) {
          recorder.take();
          const r = await conn.call(old, { id: '00000000-0000-4000-8000-000000000001' });
          refusals.push({ server, kind: 'tool', old, text: r.text, code: r.code, sent: recorder.take().length });
        }
        for (const [tool, map] of Object.entries(entry.args)) {
          for (const old of Object.keys(map)) {
            recorder.take();
            const r = await conn.call(tool, { [old]: '00000000-0000-4000-8000-000000000001' });
            refusals.push({ server, kind: 'argument', old: `${tool}(${old})`, text: r.text, code: r.code, sent: recorder.take().length });
          }
        }
      }
      await conn.close();
    }
  }
}, 300_000);
afterAll(() => { recorder.close(); process.env = saved; });

const names = () => [...new Set(listed.map((t) => t.name))].sort();

describe('tool names', () => {
  it('sees every server\'s tools (not vacuous)', () => {
    expect(new Set(listed.map((t) => t.server)).size).toBe(SERVERS.length);
    expect(names().length).toBeGreaterThan(200);
  });

  it('are snake_case and start with a verb of the convention', () => {
    expect(names().filter((n) => !/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n) || !VERBS.includes(n.split('_')[0]))).toEqual([]);
  });

  it('a list restricted to a parent uses _by_, never _for_ or _in_', () => {
    expect(names().filter((n) => n.startsWith('list_') && /_(for|in)_/.test(n))).toEqual([]);
  });

  it('a get/update/delete tool names its own object\'s ID `id`, or is an owner-ID tool with a reason', () => {
    const wrong = listed.filter((t) => /^(get|update|delete)_/.test(t.name) && !t.required.includes('id')
      && t.required.some((a) => /Id$/.test(a)) && !Object.hasOwn(OWNER_ID, t.name));
    expect([...new Set(wrong.map((t) => `${t.server} ${t.name}(${t.required.join(', ')})`))]).toEqual([]);
  });

  it('every owner-ID exception exists and has a reason (not stale)', () => {
    expect(Object.keys(OWNER_ID).filter((n) => !names().includes(n))).toEqual([]);
    for (const reason of Object.values(OWNER_ID)) {expect(reason.length).toBeGreaterThan(15);}
  });
});

describe('renamed tools and arguments (#342)', () => {
  it('the v26.2.0 batch is recorded: 7 tools, 9 arguments', () => {
    expect(renames.flatMap((r) => plain(r.tools).map(([old]) => old)).sort()).toEqual([
      'list_assets_in_asset_stock', 'list_detected_rule_violations_for_endpoint', 'list_detected_vulnerabilities_for_endpoint',
      'list_endpoint_job_instances', 'list_installed_software_by_dynamic_group', 'msw_cleanup', 'patch_local_admin_user_credentials',
    ]);
    expect(renames.flatMap((r) => Object.values(r.args).flatMap((m) => Object.keys(m))).length).toBe(9);
  });

  it('an old tool name is not listed by its server, and its replacement is', () => {
    for (const { server, tools } of renames) {
      const own = new Set(listed.filter((t) => t.server === server).map((t) => t.name));
      for (const [old, { tool }] of Object.entries(tools)) {
        expect(own.has(old), `${server} ${old}`).toBe(false);
        expect(own.has(tool), `${server} ${tool}`).toBe(true);
      }
    }
  });

  it('an old tool name answers MethodNotFound, naming its replacement, and sends nothing', () => {
    expect(refusals.filter((r) => r.kind === 'tool').length).toBe(7);
    const wrong = refusals.filter((r) => r.kind === 'tool').filter((r) => {
      const now = renames.find((x) => x.server === r.server)!.tools[r.old].tool;
      // A plain rename has no selector, so nothing follows the new name.
      return r.code !== -32601 || r.text !== `MCP error -32601: ${r.old} was replaced by ${now}: call ${now}.` || r.sent !== 0;
    });
    expect(wrong.map((r) => `${r.old}: ${r.code} ${r.text}`)).toEqual([]);
  });

  it('an old argument name answers InvalidParams, naming the new one, and sends nothing', () => {
    const args = refusals.filter((r) => r.kind === 'argument');
    expect(args.length).toBe(9);
    const wrong = args.filter((r) => {
      const [, tool, old] = r.old.match(/^(.+)\((.+)\)$/)!;
      const now = renames.find((x) => x.server === r.server)!.args[tool][old];
      return r.code !== -32602 || !r.text.includes(`${tool} takes ${now} instead of ${old}: call it with ${now}.`) || r.sent !== 0;
    });
    expect(wrong.map((r) => `${r.old}: ${r.code} ${r.text}`)).toEqual([]);
  });

  it('an old argument name is no longer declared; the new one is', () => {
    for (const { args } of renames) {
      for (const [tool, map] of Object.entries(args)) {
        const t = listed.find((x) => x.name === tool && x.release === '26R2')!;
        for (const [old, now] of Object.entries(map)) {
          expect(t.properties, `${tool} ${old}`).not.toContain(old);
          expect(t.properties, `${tool} ${now}`).toContain(now);
        }
      }
    }
  });
});
